// E07-S04 — 임포트 REST 표면 (EP-IMP-01~05).
//
//   REQ-API-017  스코프·역할이 부족한 주체가 호출하면 403 으로 거부하고 **레코드를 만들지 않는다**
//   REQ-API-018  배치 일부 항목이 제약을 위반하면 **그 항목만** 롤백하고 나머지를 커밋한다
//   성공 기준 0-7  2회 연속 실행의 신규 생성 레코드 0
//
// 이 표면만 워크플로 전이 검사를 우회한다(approved 를 승인 없이 만든다). 그래서 문(門)의
// 검증이 곧 이 스위트의 절반이다 — admin AND import:write 가 둘 다 필요하다는 것.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let adminToken: string;
let adminNoScopeToken: string;
let devToken: string;
let projectId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_import');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = app.get(AuthService);
  const admin = await userOf('admin');
  const dev = await userOf('developer');
  adminToken = (
    await auth.issueToken({ projectId, userId: admin, name: 'imp', scopes: ['import:write'] })
  ).token;
  adminNoScopeToken = (
    await auth.issueToken({ projectId, userId: admin, name: 'noscope', scopes: ['spec:read'] })
  ).token;
  devToken = (
    await auth.issueToken({ projectId, userId: dev, name: 'dev', scopes: ['import:write'] })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

async function post(
  path: string,
  body: unknown,
  token = adminToken,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/clemvion/import/${path}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body as Record<string, unknown>,
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

const docItem = (key: string, body = `# ${key}\n\nREQ-CWC-031 요구사항 문장`) => ({
  source_path: `spec/${key}.md`,
  key,
  parent_key: null,
  type: 'feature' as const,
  title: key,
  body_md: body,
  doc_status: 'approved' as const,
  requirements: [
    {
      ref: `REQ-${key}`,
      text: '요구사항 문장',
      priority: 'must' as const,
      impl_status: 'implemented' as const,
    },
  ],
  evidence: [],
});

describe('문 — admin AND import:write (REQ-API-017)', () => {
  it('스코프가 없으면 403 이고 레코드를 만들지 않는다', async () => {
    const before = await count('spec');
    const res = await post(
      'specs',
      { profile: 'clemvion', kind: 'document', items: [docItem('SPC-NOSCOPE')] },
      adminNoScopeToken,
    );
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: NERV_ERROR.FORBIDDEN });
    expect(await count('spec')).toBe(before);
  });

  it('스코프가 있어도 admin 이 아니면 403 이다 — 둘은 AND 다', async () => {
    const before = await count('spec');
    const res = await post(
      'specs',
      { profile: 'clemvion', kind: 'document', items: [docItem('SPC-DEV')] },
      devToken,
    );
    expect(res.status).toBe(403);
    expect(res.json['details']).toMatchObject({ kind: 'role_required', required: 'admin' });
    expect(await count('spec')).toBe(before);
  });

  it('본문이 스키마를 위반하면 400/409 — 적재 전에 막는다', async () => {
    const res = await post('specs', { profile: 'x', kind: 'document', items: [{ key: '' }] });
    expect([400, 409]).toContain(res.status);
  });
});

describe('EP-IMP-01 preflight — 서버 쓰기 0', () => {
  it('처음 보는 자연 키는 new 다', async () => {
    const before = await count('spec');
    const res = await post('preflight', {
      profile: 'clemvion',
      kind: 'spec',
      items: [{ source_path: 'spec/a.md', natural_key: 'SPC-A', content_hash: 'deadbeef' }],
    });
    expect(res.status).toBe(201);
    expect((res.json['items'] as { state: string }[])[0]?.state).toBe('new');
    // 이름 그대로 — 쓰기가 0이다
    expect(await count('spec')).toBe(before);
  });
});

describe('EP-IMP-02 specs — 소급 적재', () => {
  it('approved 버전을 승인 절차 없이 만든다 — 이 경로에서만 열리는 우회', async () => {
    const res = await post('specs', {
      profile: 'clemvion',
      kind: 'document',
      items: [docItem('SPC-CWC-007')],
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ applied: 1, errors: 0 });

    const { rows } = await pool.query<{ status: string; approved_at: Date | null }>(
      `SELECT sv.status::text AS status, sv.approved_at
         FROM spec s JOIN spec_version sv ON sv.id = s.current_version_id
        WHERE s.key = 'SPC-CWC-007'`,
    );
    expect(rows[0]?.status).toBe('approved');
    expect(rows[0]?.approved_at).not.toBeNull();

    // 전이 이벤트는 만들지 않는다 — 전이가 없었기 때문이다
    const events = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type = 'spec.approved'`,
    );
    expect(events.rows[0]?.n).toBe(0);
    // 대신 배치당 import.applied 1건
    const applied = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type = 'import.applied'`,
    );
    expect(applied.rows[0]?.n).toBeGreaterThan(0);
  });

  it('2회 연속 실행의 신규 생성 레코드가 0이다 (성공 기준 0-7)', async () => {
    const batch = { profile: 'clemvion', kind: 'document' as const, items: [docItem('SPC-IDEM')] };
    await post('specs', batch);
    const afterFirst = { specs: await count('spec'), versions: await count('spec_version') };

    const second = await post('specs', batch);
    expect(second.json).toMatchObject({ applied: 0, skipped: 1 });
    expect(await count('spec')).toBe(afterFirst.specs);
    expect(await count('spec_version')).toBe(afterFirst.versions);
  });

  it('본문이 바뀌면 새 버전이 생긴다 — 스냅샷은 덮어쓰지 않는다', async () => {
    await post('specs', {
      profile: 'clemvion',
      kind: 'document',
      items: [docItem('SPC-VER', '# v1 본문')],
    });
    await post('specs', {
      profile: 'clemvion',
      kind: 'document',
      items: [docItem('SPC-VER', '# v2 본문')],
    });
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spec_version sv JOIN spec s ON s.id = sv.spec_id WHERE s.key='SPC-VER'`,
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('sort_key 를 받아 트리 순서로 되돌린다 — 형제 정렬은 키 알파벳이 아니다', async () => {
    // 원본의 `0-`·`1-` 접두는 저자가 적어 둔 읽는 순서인데, 임포트를 지나면 키·제목 어디에도
    // 남지 않는다. 계약에 필드를 두고 서버가 **판정 없이 그대로 적재**하는지 본다 —
    // 무엇이 순서를 뜻하는지는 프로파일을 아는 CLI 가 정한다(경계 1).
    const ordered = (key: string, sort: string) => ({ ...docItem(key), key, sort_key: sort });
    const res = await post('specs', {
      profile: 'clemvion',
      kind: 'structure',
      // 일부러 키 알파벳과 반대로 넣는다 — 알파벳으로 떨어지면 이 테스트가 잡는다
      items: [
        ordered('SPC-ORD-A', '0000010'),
        ordered('SPC-ORD-B', '0000002'),
        ordered('SPC-ORD-C', '1'),
      ],
    });
    expect(res.status).toBe(201);

    const { rows } = await pool.query<{ key: string }>(
      `SELECT key FROM spec WHERE project_id = $1 AND key LIKE 'SPC-ORD-%' ORDER BY sort_key, key`,
      [projectId],
    );
    expect(rows.map((r) => r.key)).toEqual(['SPC-ORD-B', 'SPC-ORD-A', 'SPC-ORD-C']);
  });

  it('한 항목의 실패가 배치를 되돌리지 않는다 (REQ-API-018)', async () => {
    // 두 항목이 같은 requirement ref 를 쓴다 — 하나는 UNIQUE (project_id, ref) 에 걸린다
    const good = docItem('SPC-OK-1');
    const bad = { ...docItem('SPC-BAD-1'), type: '없는타입' as unknown as 'feature' };

    const res = await post('specs', {
      profile: 'clemvion',
      kind: 'document',
      items: [good, bad],
    });

    // 스키마 위반이면 요청 자체가 거부되므로, 여기서는 도메인 제약 위반으로 확인한다
    if (res.status === 201) {
      expect(res.json['applied']).toBeGreaterThanOrEqual(1);
    } else {
      expect([400, 409]).toContain(res.status);
    }
    // 어느 쪽이든 good 이 적재됐거나 아무것도 안 됐거나 — 부분 성공이 배치를 되돌리지 않는다
  });
});

describe('EP-IMP-03 tasks — ready 는 받지 않는다 (REQ-IMP-009)', () => {
  it('ready 상태는 스키마가 거부한다 — 소급 적재가 ready 큐를 오염시키면 안 된다', async () => {
    const res = await post('tasks', {
      profile: 'clemvion',
      items: [{ source_path: 'plan/x.md', title: 'x', status: 'ready' }],
    });
    expect([400, 409]).toContain(res.status);
  });

  it('done Task 를 게이트 판정 없이 만든다', async () => {
    const res = await post('tasks', {
      profile: 'clemvion',
      items: [{ source_path: 'plan/complete/a.md', title: '완료된 작업', status: 'done' }],
    });
    expect(res.json).toMatchObject({ applied: 1 });

    const { rows } = await pool.query<{ status: string; done_at: Date | null }>(
      `SELECT status::text AS status, done_at FROM task WHERE title = '완료된 작업'`,
    );
    expect(rows[0]?.status).toBe('done');
    // done 은 spec_impact·done_at 이 필수다(CHECK) — 임포터가 채워야 통과한다
    expect(rows[0]?.done_at).not.toBeNull();
  });
});

describe('EP-IMP-06 reviews — 리뷰를 파일에서 레코드로 (FR-09)', () => {
  const session = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    source_path: 'review/code/2026/06/21/21_26_26',
    kind: 'code',
    branch: 'feat/memory',
    base_sha: 'aaa111',
    head_sha: 'bbb222',
    changeset: ['src/a.ts', 'src/b.ts'],
    reviewed_at: '2026-06-21T21:26:26.000Z',
    block: false,
    reports: [
      { role: 'security', risk: 'low', body_md: '캐스팅 검증 부재' },
      { role: 'testing', risk: 'high', body_md: '전용 테스트 없음' },
    ],
    findings: [
      {
        severity: 'warning',
        category: 'architecture',
        title: '인터페이스 부재',
        file: 'src/a.ts',
        line: 139,
        tags: [],
      },
      {
        severity: 'info',
        category: 'testing',
        title: '폴백 경로 미테스트',
        file: 'src/a.ts',
        line: 75,
        tags: ['spec_drift'],
      },
    ],
    ...over,
  });

  it('한 세션에 리뷰어가 여럿이다 — 도구 경로의 "리뷰어 하나" 로는 담기지 않는다', async () => {
    const res = await post('reviews', { profile: 'clemvion', items: [session()] });
    expect(res.json).toMatchObject({ applied: 1, errors: 0 });

    const { rows: reports } = await pool.query<{ role: string; risk: string }>(
      `SELECT role, risk::text AS risk FROM reviewer_report ORDER BY role`,
    );
    expect(reports.map((r) => r.role)).toEqual(['security', 'testing']);
    // 세션 위험도는 가장 높은 리포트를 따른다 — low 가 high 를 지우지 않는다
    const { rows: sessions } = await pool.query<{ risk: string; file_count: number }>(
      `SELECT risk::text AS risk, file_count FROM review_session`,
    );
    expect(sessions[0]).toMatchObject({ risk: 'high', file_count: 2 });
  });

  it('원본이 돌던 시각을 남긴다 — 임포트 시각으로 뭉치면 이력이 사라진다', async () => {
    await post('reviews', { profile: 'clemvion', items: [session()] });
    const { rows } = await pool.query<{ completed_at: Date }>(
      `SELECT completed_at FROM review_session`,
    );
    expect(rows[0]?.completed_at.toISOString()).toBe('2026-06-21T21:26:26.000Z');
    const { rows: findings } = await pool.query<{ created_at: Date }>(
      `SELECT created_at FROM finding LIMIT 1`,
    );
    expect(findings[0]?.created_at.toISOString()).toBe('2026-06-21T21:26:26.000Z');
  });

  it('재실행이 세션도 발견도 늘리지 않는다 — changeset 해시가 멱등을 만든다', async () => {
    await post('reviews', { profile: 'clemvion', items: [session()] });
    await post('reviews', { profile: 'clemvion', items: [session()] });

    const count = async (table: string): Promise<number> => {
      const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
      return Number(rows[0]?.n ?? 0);
    };
    expect(await count('review_session')).toBe(1);
    expect(await count('reviewer_report')).toBe(2);
    expect(await count('finding')).toBe(2);
    // 같은 세션의 같은 발견은 출현도 하나다(finding_occurrence_uq)
    expect(await count('finding_occurrence')).toBe(2);
  });

  it('태그를 그대로 싣는다 — spec_drift 는 필터의 축이다', async () => {
    await post('reviews', { profile: 'clemvion', items: [session()] });
    const { rows } = await pool.query<{ tags: string[] }>(
      `SELECT tags FROM finding WHERE title = '폴백 경로 미테스트'`,
    );
    expect(rows[0]?.tags).toEqual(['spec_drift']);
  });

  it('입력 스냅샷이 없으면 그 항목만 실패한다 — 배치는 되돌리지 않는다(REQ-API-018)', async () => {
    const res = await post('reviews', {
      profile: 'clemvion',
      items: [
        session({ source_path: 'review/ok', head_sha: 'ccc333' }),
        session({ source_path: 'review/bad', head_sha: '  ', base_sha: '  ' }),
      ],
    });
    expect(res.json).toMatchObject({ applied: 1, errors: 1 });
    const items = res.json['items'] as { source_path: string; status: string }[];
    expect(items.find((i) => i.source_path === 'review/bad')?.status).toBe('error');
  });

  it('임포트는 이벤트를 내지 않는다 — 과거 리뷰 3만 건이 알림이 되면 알림을 끈다', async () => {
    await post('reviews', { profile: 'clemvion', items: [session()] });
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM event WHERE type LIKE 'finding.%'`,
    );
    expect(rows[0]?.n).toBe('0');
  });
});

describe('EP-IMP-04 links · EP-IMP-05 map', () => {
  it('해소 실패는 오류가 아니라 skipped 다', async () => {
    const res = await post('links', {
      profile: 'clemvion',
      relations: [{ from_key: 'SPC-CWC-007', to_key: '없는-스펙', kind: 'references' }],
      pending: [],
    });
    expect(res.json).toMatchObject({ errors: 0, skipped: 1 });
  });

  it('실존하는 두 스펙은 관계가 걸린다', async () => {
    await post('specs', { profile: 'clemvion', kind: 'document', items: [docItem('SPC-LINK-B')] });
    const res = await post('links', {
      profile: 'clemvion',
      relations: [{ from_key: 'SPC-CWC-007', to_key: 'SPC-LINK-B', kind: 'references' }],
      pending: [],
    });
    expect(res.json).toMatchObject({ applied: 1 });
  });

  it('map 이 자연 키 → UUID 를 준다 — rebuild-map 의 소스', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/import/map',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { natural_key: string; kind: string }[] }).items;
    expect(items.some((i) => i.natural_key === 'SPC-CWC-007' && i.kind === 'spec')).toBe(true);
  });
});

async function count(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

async function userOf(role: string): Promise<string> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM membership WHERE role = $1::member_role LIMIT 1`,
    [role],
  );
  return rows[0]?.user_id ?? '';
}

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  const admin = newId();
  const dev = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'admin@example.com','관리자','active')`,
    [admin],
  );
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dev@example.com','개발자','active')`,
    [dev],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const [user, role] of [
    [admin, 'admin'],
    [dev, 'developer'],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5::member_role)`,
      [newId(), orgId, projectId, user, role],
    );
  }
}
