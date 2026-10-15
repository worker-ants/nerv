// E15-S01 · E15-S02 — 커버리지 드릴다운과 구현 상태의 출처 (2026-10-15 · 사람 결정 ④)
//
//   REQ-API-312  요구사항의 구현 상태와 함께 그 값의 출처(`impl_status_source`)를 준다 — 임포트가 새 요구사항을 만들면
//                `import`, 파생이 값을 다시 쓰면 `derived`. 작업이 없는 요구사항의 임포트 값은 덮지 않는다.
//                커버리지는 임포트 값으로 남은 수(`imported_values`)와 파생한 비율(`derived_ratio`)을 함께 준다(2-8)
//   REQ-API-313  요구사항 행은 커버리지와 같은 술어로 증적 결손 · 빈 약속을 표시하고, 상세는 그 요구사항의 발견(열린 것 ·
//                처분된 것)과 최근 리뷰 라운드 · 검증 작업을 만들 기준(최신 승인본)을 준다
//
// 표면(REST)으로 들어간다 — 임포트 · 작업 생성 · 증적 등록이 사람이 쓰는 문이고, 출처를 쓰는 자리가 그 문 뒤에 있다.

import { newId } from '@nerv/schema';
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
let token: string;
let projectId: string;
let adminId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_coverage');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId: adminId,
      name: 'coverage',
      scopes: ['import:write', 'spec:read', 'spec:evidence', 'task:update'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.inject({
    method,
    url: `/api/v1/projects/clemvion/${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

/** 문서 하나를 임포트한다 — 요구사항마다 문서가 적은 구현 상태를 싣는다 */
async function importSpec(
  key: string,
  requirements: { ref: string; impl_status: string }[],
): Promise<void> {
  const res = await call('POST', 'import/specs', {
    profile: 'clemvion',
    kind: 'document',
    items: [
      {
        source_path: `spec/${key}.md`,
        key,
        parent_key: null,
        type: 'feature',
        title: key,
        body_md: `# ${key}\n\n${requirements.map((r) => `- ${r.ref} WHEN 조건이면 THE SYSTEM SHALL 동작한다`).join('\n')}`,
        doc_status: 'approved',
        requirements: requirements.map((r) => ({
          ref: r.ref,
          text: 'WHEN 조건이면 THE SYSTEM SHALL 동작한다',
          priority: 'must',
          impl_status: r.impl_status,
        })),
        evidence: [],
      },
    ],
  });
  expect(res.status).toBe(201);
  expect((res.json['items'] as { status: string }[])[0]?.status).toBe('ok');
}

async function rowsOf(specKey: string): Promise<Record<string, unknown>[]> {
  const res = await call('GET', `requirements?spec=${specKey}`);
  expect(res.status).toBe(200);
  return res.json as unknown as Record<string, unknown>[];
}

async function sourceOf(ref: string): Promise<{ status: string; source: string }> {
  const { rows } = await pool.query<{ status: string; source: string }>(
    `SELECT impl_status::text AS status, impl_status_source::text AS source
       FROM requirement WHERE project_id = $1 AND ref = $2`,
    [projectId, ref],
  );
  return rows[0] ?? { status: '', source: '' };
}

describe('구현 상태의 출처 (REQ-API-312 · 사람 결정 ④)', () => {
  it('임포트가 만든 요구사항은 출처가 import 다 — 목록 · 상세 · 문서 읽기가 같은 값을 준다', async () => {
    await importSpec('SPC-SRC-A', [
      { ref: 'REQ-SRCA-001', impl_status: 'implemented' },
      { ref: 'REQ-SRCA-002', impl_status: 'unimplemented' },
    ]);
    const rows = await rowsOf('SPC-SRC-A');
    expect(rows.map((r) => [r['ref'], r['impl_status'], r['impl_status_source']])).toEqual([
      ['REQ-SRCA-001', 'implemented', 'import'],
      ['REQ-SRCA-002', 'unimplemented', 'import'],
    ]);
    const detail = await call('GET', 'requirements/REQ-SRCA-001');
    expect(detail.json['impl_status_source']).toBe('import');
    // `nerv_spec_get` 과 같은 서비스다(D-05) — 문서를 읽은 에이전트도 그 값이 임포트 값인 줄 안다
    const spec = await call('GET', 'specs/SPC-SRC-A');
    const requirements = spec.json['requirements'] as Record<string, unknown>[];
    expect(requirements.map((r) => r['impl_status_source'])).toEqual(['import', 'import']);
  });

  it('작업이 없으면 증적이 등록돼도 임포트 값을 unimplemented 로 덮지 않는다 — 출처도 그대로다', async () => {
    await importSpec('SPC-SRC-B', [{ ref: 'REQ-SRCB-001', impl_status: 'implemented' }]);
    const added = await call('POST', 'requirements/REQ-SRCB-001/evidence', {
      kind: 'code_path',
      locator: 'src/widget.ts',
    });
    expect(added.status).toBe(201);
    expect(await sourceOf('REQ-SRCB-001')).toEqual({ status: 'implemented', source: 'import' });
  });

  it('작업이 생겨 파생이 값을 다시 쓰면 출처가 derived 가 된다 — 다시 임포트해도 import 로 돌아가지 않는다', async () => {
    await importSpec('SPC-SRC-C', [{ ref: 'REQ-SRCC-001', impl_status: 'implemented' }]);
    const created = await call('POST', 'tasks', {
      title: '검증',
      source_requirement_id: 'REQ-SRCC-001',
    });
    expect(created.status).toBe(201);
    // 작업을 만드는 것만으로는 파생하지 않는다 — 아직 임포트 값이고 출처도 그렇다고 말한다
    expect(await sourceOf('REQ-SRCC-001')).toEqual({ status: 'implemented', source: 'import' });
    // 증적 등록이 다시 파생한다 — backlog 작업 하나뿐이라 규칙표는 unimplemented 다
    await call('POST', 'requirements/REQ-SRCC-001/evidence', {
      kind: 'code_path',
      locator: 'src/verify.ts',
    });
    expect(await sourceOf('REQ-SRCC-001')).toEqual({ status: 'unimplemented', source: 'derived' });
    // 같은 문서를 다시 임포트한다(본문을 바꿔 새 버전) — 이미 있는 행의 구현 상태와 출처는 건드리지 않는다
    const again = await call('POST', 'import/specs', {
      profile: 'clemvion',
      kind: 'document',
      items: [
        {
          source_path: 'spec/SPC-SRC-C.md',
          key: 'SPC-SRC-C',
          parent_key: null,
          type: 'feature',
          title: 'SPC-SRC-C',
          body_md:
            '# SPC-SRC-C\n\n- REQ-SRCC-001 WHEN 조건이면 THE SYSTEM SHALL 동작한다\n\n고친 본문',
          doc_status: 'approved',
          requirements: [
            {
              ref: 'REQ-SRCC-001',
              text: 'WHEN 조건이면 THE SYSTEM SHALL 동작한다',
              priority: 'must',
              impl_status: 'implemented',
            },
          ],
          evidence: [],
        },
      ],
    });
    expect((again.json['items'] as { status: string }[])[0]?.status).toBe('ok');
    expect(await sourceOf('REQ-SRCC-001')).toEqual({ status: 'unimplemented', source: 'derived' });
  });

  it('NERV 에서 생긴 요구사항의 처음 값은 derived 다 — 누가 손으로 찍은 값이 아니다', async () => {
    const { rows } = await pool.query<{ source: string }>(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md,
                                introduced_in_version_id, current_version_id)
       SELECT $1, $2, s.id, 'REQ-SRCA-099', '문장', s.current_version_id, s.current_version_id
         FROM spec s WHERE s.project_id = $2 AND s.key = 'SPC-SRC-A'
       RETURNING impl_status_source::text AS source`,
      [newId(), projectId],
    );
    expect(rows[0]?.source).toBe('derived');
    await pool.query(`DELETE FROM requirement WHERE ref = 'REQ-SRCA-099'`);
  });

  it('커버리지는 임포트 값으로 남은 수와 파생한 비율을 함께 준다 — 스펙 · 영역 · 전체가 같은 수를 센다(2-8)', async () => {
    const coverage = await call('GET', 'coverage');
    const totals = coverage.json['totals'] as Record<string, number | null>;
    // SRC-A 둘 · SRC-B 하나가 임포트 값이고 SRC-C 하나는 파생했다
    expect(totals['total']).toBe(4);
    expect(totals['imported_values']).toBe(3);
    expect(totals['derived_ratio']).toBeCloseTo(1 / 4);
    const specs = coverage.json['specs'] as Record<string, unknown>[];
    expect(specs.find((s) => s['key'] === 'SPC-SRC-A')?.['imported_values']).toBe(2);
    expect(specs.find((s) => s['key'] === 'SPC-SRC-C')?.['imported_values']).toBe(0);
    const areas = coverage.json['areas'] as Record<string, unknown>[];
    expect(areas.reduce((n, a) => n + Number(a['imported_values'] ?? 0), 0)).toBe(3);
  });
});

describe('드릴다운의 재료 (REQ-API-313)', () => {
  it('행의 증적 결손 · 빈 약속 표시는 커버리지가 센 것과 같다', async () => {
    await importSpec('SPC-GAP', [
      { ref: 'REQ-GAP-001', impl_status: 'implemented' },
      { ref: 'REQ-GAP-002', impl_status: 'unimplemented' },
      { ref: 'REQ-GAP-003', impl_status: 'in_progress' },
    ]);
    const rows = await rowsOf('SPC-GAP');
    const flags = Object.fromEntries(
      rows.map((r) => [r['ref'], [r['evidence_missing'], r['empty_promise']]]),
    );
    expect(flags).toEqual({
      'REQ-GAP-001': [true, false],
      'REQ-GAP-002': [false, true],
      'REQ-GAP-003': [false, false],
    });
    const coverage = await call('GET', 'coverage?spec=SPC-GAP');
    const totals = coverage.json['totals'] as Record<string, number>;
    expect(totals['evidence_missing']).toBe(rows.filter((r) => r['evidence_missing']).length);
    expect(totals['empty_promises']).toBe(rows.filter((r) => r['empty_promise']).length);
    // 서명된 test 증적이 없다 — 검증 작업을 만들 줄이다
    expect(rows.every((r) => r['verification_evidence'] === false)).toBe(true);
  });

  it('상세는 그 요구사항의 발견(열린 것 · 처분된 것)과 최근 리뷰 라운드와 최신 승인본을 준다', async () => {
    await importSpec('SPC-FND', [{ ref: 'REQ-FND-001', impl_status: 'in_progress' }]);
    const created = await call('POST', 'tasks', {
      title: '위젯',
      source_requirement_id: 'REQ-FND-001',
    });
    const taskId = String(created.json['task_id']);
    const { rows: req } = await pool.query<{ id: string }>(
      `SELECT id FROM requirement WHERE project_id = $1 AND ref = 'REQ-FND-001'`,
      [projectId],
    );
    const reqId = req[0]?.id ?? '';
    // 라운드 둘 — 하나는 그 작업의 것, 하나는 작업 없이 그 요구사항의 발견이 나온 것. 셋째는 상관없는 라운드다
    const round = async (
      task: string | null,
      branch: string,
      hoursAgo: number,
    ): Promise<string> => {
      const id = newId();
      await pool.query(
        `INSERT INTO review_session (id, project_id, kind, "trigger", task_id, branch, head_sha, base_sha,
                                     changeset_hash, state, risk, started_at, completed_at)
         VALUES ($1,$2,'code','auto',$3,$4,'9a41c2f0e1','3d90f1aabb',decode(md5($6),'hex'),
                 'complete','high', now() - make_interval(hours => $5), now() - make_interval(hours => $5))`,
        [id, projectId, task, branch, hoursAgo, `round-${id}`],
      );
      return id;
    };
    const own = await round(taskId, 'feature/widget', 1);
    const other = await round(null, 'feat/consistency', 2);
    const unrelated = await round(null, 'feat/unrelated', 0);
    const finding = async (
      session: string,
      severity: string,
      status: string,
      title: string,
      requirementId: string | null,
    ): Promise<void> => {
      const id = newId();
      await pool.query(
        `INSERT INTO finding (id, project_id, fingerprint, severity, category, title, requirement_id, status,
                              first_session_id, last_session_id)
         VALUES ($1,$2,decode(md5($8),'hex'),$3::finding_severity,'security',$4,$5,$6::finding_status,$7,$7)`,
        [id, projectId, severity, title, requirementId, status, session, `finding-${id}`],
      );
      await pool.query(
        `INSERT INTO finding_occurrence (id, finding_id, review_session_id, round_no, display_no, raw_severity)
         VALUES ($1,$2,$3,1,1,$4::finding_severity)`,
        [newId(), id, session, severity],
      );
    };
    await finding(own, 'critical', 'open', '토큰이 평문이다', reqId);
    await finding(other, 'warning', 'fixed', '재시도 횟수가 없다', reqId);
    await finding(unrelated, 'info', 'open', '상관없는 지적', null);

    const detail = await call('GET', 'requirements/REQ-FND-001');
    expect(detail.status).toBe(200);
    const findings = detail.json['findings'] as Record<string, unknown>[];
    // 열린 것이 먼저다 · 처분된 것도 준다 · 다른 요구사항의 것은 없다
    expect(findings.map((f) => [f['title'], f['status'], f['severity']])).toEqual([
      ['토큰이 평문이다', 'open', 'critical'],
      ['재시도 횟수가 없다', 'fixed', 'warning'],
    ]);
    const reviews = detail.json['reviews'] as Record<string, unknown>[];
    // 최근 것이 먼저 — 작업의 라운드와 발견이 나온 라운드. 상관없는 라운드는 없다
    expect(reviews.map((r) => r['id'])).toEqual([own, other]);
    expect(reviews[0]).toMatchObject({
      branch: 'feature/widget',
      finding_count: 1,
      open_critical: 1,
    });
    expect(reviews[1]).toMatchObject({ finding_count: 1, open_critical: 0 });
    // 검증 작업을 만들 기준 — 임포트가 승인본으로 넣은 버전이다
    expect(detail.json['approved_version']).toMatchObject({ version_no: 1 });
    expect(detail.json['verification_evidence']).toBe(false);
    expect(detail.json['spec_title']).toBe('SPC-FND');
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  adminId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'admin@example.com','관리자','active')`,
    [adminId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
    [newId(), orgId, projectId, adminId],
  );
}
