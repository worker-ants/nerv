// REST 표면 전량 — 프로젝트·멤버·토큰 · Task · 세션 steer · 받은 요청 · 커버리지 · 알림
//
// 실제 HTTP 로 돈다. 서비스 단위 테스트가 이미 판정을 지키고 있으므로 여기서 확인할 것은
// **번역**이다(REQ-CB-003): 경로·역할 가드·에러 코드가 화면이 기대하는 모양으로 나오는가.
// 화면(E08)이 이 계약 위에 올라가므로, 여기가 어긋나면 화면은 조용히 빈 상태를 렌더한다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let adminToken: string;
let viewerToken: string;
let projectId: string;
let orgId: string;
let adminId: string;
let viewerId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_rest');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = app.get(AuthService);
  adminToken = (
    await auth.issueToken({
      projectId,
      userId: adminId,
      name: 'admin-pat',
      scopes: [
        'spec:read',
        'spec:draft',
        'spec:meta',
        'task:claim',
        'task:update',
        'review:resolve',
      ],
    })
  ).token;
  viewerToken = (
    await auth.issueToken({
      projectId,
      userId: viewerId,
      name: 'viewer-pat',
      scopes: ['spec:read'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM activity');
  await pool.query('DELETE FROM task_dependency');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM event');
});

interface Res {
  status: number;
  body: Record<string, unknown> | Record<string, unknown>[];
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { token?: string; payload?: unknown } = {},
): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  headers['authorization'] = `Bearer ${options.token ?? adminToken}`;
  const res = await app.inject({
    method,
    url,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
  return {
    status: res.statusCode,
    body: res.body === '' ? {} : (res.json() as Record<string, unknown>),
  };
}

describe('테넌시 표면 (EP-AUTH-01 · EP-ORG-01 · EP-PRJ-01·03)', () => {
  it('me 는 프로필과 멤버십·역할을 함께 준다 — 셸의 첫 질문에 한 번에 답한다', async () => {
    const res = await call('GET', '/api/v1/me');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['email']).toBe('admin@example.com');
    expect((body['memberships'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('프로젝트 목록에 활성 세션·승인 대기 카운트가 실린다 (S1 카드의 데이터 소스)', async () => {
    const res = await call('GET', '/api/v1/orgs/nerv/projects');
    const items = res.body as Record<string, unknown>[];
    expect(items[0]?.['slug']).toBe('clemvion');
    expect(items[0]).toHaveProperty('active_sessions');
    expect(items[0]).toHaveProperty('pending_approvals');
  });

  it('프로젝트 상세는 게이트 정책을 싣는다 (S8 게이트 탭)', async () => {
    const res = await call('GET', '/api/v1/projects/clemvion');
    expect(res.status).toBe(200);
    expect(res.body as Record<string, unknown>).toHaveProperty('gate_policy');
  });

  it('게이트 정책 편집은 admin 만 — API 와 UI 양쪽에서 막는다는 규칙의 API 쪽 절반', async () => {
    const policy = { spec_gate: { tier_boundaries: [2, 4, 7] } };

    const denied = await call('PATCH', '/api/v1/projects/clemvion', {
      token: viewerToken,
      payload: { gate_policy: policy },
    });
    expect(denied.status).toBe(403);
    expect((denied.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.FORBIDDEN);

    const allowed = await call('PATCH', '/api/v1/projects/clemvion', {
      payload: { gate_policy: policy },
    });
    expect(allowed.status).toBe(200);
    const saved = (allowed.body as Record<string, unknown>)['gate_policy'] as Record<
      string,
      unknown
    >;
    expect((saved['spec_gate'] as Record<string, unknown>)['tier_boundaries']).toEqual([2, 4, 7]);
  });

  it('알 수 없는 정책 키는 거부한다 — 오타를 삼키면 게이트가 꺼진 줄 모르게 된다 (§2.1a)', async () => {
    const res = await call('PATCH', '/api/v1/projects/clemvion', {
      payload: { gate_policy: { spec_gate: { tier_boundries: [1, 2, 3] } } },
    });
    // NERV_PRECONDITION 은 상황에 따라 400/409 로 사상된다(api.md §1.4) — 코드로 확인한다
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.PRECONDITION);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'invalid_policy',
    });
  });

  it('토큰 목록에 원문이 없다 — 발급 응답에서 한 번 보여준 뒤로는 어디에도 남지 않는다', async () => {
    const res = await call('GET', '/api/v1/me/tokens');
    const tokens = res.body as Record<string, unknown>[];
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(Object.keys(token)).not.toContain('token');
      expect(Object.keys(token)).not.toContain('token_hash');
      expect(token['prefix']).toMatch(/^nerv_/);
    }
  });

  it('PAT 로는 PAT 를 발급할 수 없다 — 스코프 상속의 사슬은 사람에서 시작한다 (D-08)', async () => {
    const res = await call('POST', '/api/v1/me/tokens', {
      payload: { project: 'clemvion', name: 'child', scopes: ['spec:read'] },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);
  });
});

describe('Task 표면 (EP-TASK-01·03·04·05·09)', () => {
  it('생성은 언제나 backlog 이고, 4요소가 차면 서버가 ready 로 승격한다 (FR-05)', async () => {
    const created = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: { title: '위젯 임베드', priority: 'P1' },
    });
    expect(created.status).toBe(201);
    const key = (created.body as Record<string, unknown>)['key'] as string;
    expect((created.body as Record<string, unknown>)['status']).toBe('backlog');

    // 3요소만 — 아직 ready 가 아니다
    const partial = await call('PATCH', `/api/v1/projects/clemvion/tasks/${key}`, {
      payload: { goal_md: '목표', output_format_md: 'PR', tools_sources_md: '도구' },
    });
    expect((partial.body as Record<string, unknown>)['status']).toBe('backlog');

    const complete = await call('PATCH', `/api/v1/projects/clemvion/tasks/${key}`, {
      payload: { boundaries_md: '경계' },
    });
    expect((complete.body as Record<string, unknown>)['status']).toBe('ready');
  });

  it('의존이 남아 있으면 4요소가 차도 ready 가 아니다', async () => {
    const blocker = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: { title: '선행' },
    });
    const blocked = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: {
        title: '후행',
        goal_md: '목표',
        output_format_md: 'PR',
        tools_sources_md: '도구',
        boundaries_md: '경계',
      },
    });
    const key = (blocked.body as Record<string, unknown>)['key'] as string;
    const res = await call('PATCH', `/api/v1/projects/clemvion/tasks/${key}`, {
      payload: { depends_on: [(blocker.body as Record<string, unknown>)['key']] },
    });
    expect((res.body as Record<string, unknown>)['status']).toBe('backlog');
  });

  it('보드 목록은 위임 명세 완결 여부를 행마다 표시한다 (S4 칼럼)', async () => {
    await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: '미완' } });
    const res = await call('GET', '/api/v1/projects/clemvion/tasks?status=backlog');
    // 목록은 커서 봉투다(§1.6) — `{ items, next_cursor }`
    const page = res.body as { items: Record<string, unknown>[]; next_cursor: string | null };
    expect(page.items[0]?.['delegation_complete']).toBe(false);
    expect(page).toHaveProperty('next_cursor');
  });

  it('done 레인은 창 밖의 것을 기본으로 감추고, 토글이 그 창을 연다 (screens.md §2.5)', async () => {
    // 끝난 일은 시간이 지나면 배경이 된다. clemvion 실측에서 done 이 419/487(86%)이었고
    // 보드가 전량을 한 응답으로 받아 229 KB 였다(2026-08-23).
    // done 은 위임 명세 4요소와 spec_impact 를 요구한다(`task_delegation_spec_ck` ·
    // `task_done_spec_impact_ck`) — 상태만 바꿔 넣을 수 없다. 만들 때부터 채운다.
    const made = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: {
        title: '오래된 완료',
        goal_md: '목표',
        output_format_md: 'PR',
        tools_sources_md: '도구',
        boundaries_md: '경계',
      },
    });
    const key = (made.body as Record<string, unknown>)['key'] as string;
    await pool.query(
      `UPDATE task SET status = 'done', done_at = now() - interval '30 days',
              spec_impact = '{"none": true}'::jsonb
        WHERE key = $1`,
      [key],
    );

    const closed = await call('GET', '/api/v1/projects/clemvion/tasks?status=done');
    const open = await call(
      'GET',
      '/api/v1/projects/clemvion/tasks?status=done&include_archived=true',
    );
    const keys = (r: typeof closed): unknown[] =>
      (r.body as { items: Record<string, unknown>[] }).items.map((x) => x['key']);
    expect(keys(closed)).not.toContain(key);
    expect(keys(open)).toContain(key);
  });

  it('done 은 언제나 done_at 을 갖는다 — 창 계산이 기댈 수 있는 근거다', async () => {
    // 창은 `done_at` 으로 잰다. 그 값이 없을 수 있다면 판정이 NULL 이 되어 행이 조용히
    // 사라지는데, 그 일이 없는 이유는 코드가 아니라 **제약**이다(`task_done_at_ck`).
    // 근거가 DB 에 있으므로 검사도 DB 에 대고 한다.
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'task'::regclass AND conname = 'task_done_at_ck'`,
    );
    expect(rows[0]?.def).toContain('done_at IS NOT NULL');
  });

  it('커서로 전량을 정확히 한 번씩 훑는다 (§1.6)', async () => {
    // 오프셋이 아니라 커서인 이유가 이것이다 — 경계에서 건너뛰거나 두 번 나오면 안 된다.
    for (let i = 0; i < 7; i += 1) {
      await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: `커서 ${i}` } });
    }
    const seen: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const q = `/api/v1/projects/clemvion/tasks?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const res: Awaited<ReturnType<typeof call>> = await call('GET', q);
      const body = res.body as { items: Record<string, unknown>[]; next_cursor: string | null };
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((x) => x['key']));
      cursor = body.next_cursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull(); // 끝까지 갔다
    expect(new Set(seen).size).toBe(seen.length); // 두 번 나온 것이 없다

    const all = await call('GET', '/api/v1/projects/clemvion/tasks?limit=100');
    expect(seen.length).toBe((all.body as { items: unknown[] }).items.length); // 빠진 것도 없다
  });

  it('limit 은 상한을 넘지 않는다 — 사람이 큰 값을 줘도 그렇다 (§1.6)', async () => {
    const res = await call('GET', '/api/v1/projects/clemvion/tasks?limit=9999');
    expect((res.body as { items: unknown[] }).items.length).toBeLessThanOrEqual(100);
  });

  it('done 전이는 게이트를 통과해야 한다 — REST 도 같은 판정을 쓴다 (D-05)', async () => {
    const created = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: {
        title: '완료 대상',
        goal_md: '목표',
        output_format_md: 'PR',
        tools_sources_md: '도구',
        boundaries_md: '경계',
      },
    });
    const taskId = (created.body as Record<string, unknown>)['task_id'] as string;

    const denied = await call('POST', `/api/v1/projects/clemvion/tasks/${taskId}/transition`, {
      payload: { status: 'done' },
    });
    expect(denied.status).toBe(409);
    expect((denied.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'done_gate',
    });

    const ok = await call('POST', `/api/v1/projects/clemvion/tasks/${taskId}/transition`, {
      payload: {
        status: 'done',
        spec_impact: { none: true },
        evidence: [{ kind: 'pr', locator: 'https://pr/1' }],
      },
    });
    expect(ok.status).toBe(201);
    expect((ok.body as Record<string, unknown>)['status']).toBe('done');
  });
});

describe('세션 steer (EP-SES-04)', () => {
  it('stop 은 전달을 기다리지 않고 즉시 클레임을 회수한다', async () => {
    const sessionId = newId();
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업','in_progress','목표','PR','도구','경계')`,
      [taskId, projectId, `TSK-${taskId.slice(0, 4)}`],
    );
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state, external_session_id)
       VALUES ($1,$2,$3,'claude-code','mac-07','active','S-b7e9')`,
      [sessionId, projectId, adminId],
    );
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, taskId, sessionId, adminId],
    );

    const res = await call('POST', `/api/v1/projects/clemvion/sessions/${sessionId}/steer`, {
      payload: { kind: 'stop', message: '중단하세요' },
    });
    // PAT 는 사람이 아니다 — steer 는 사람 전용이라 여기서 막힌다
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);

    // 서비스 경로로 사람이 눌렀을 때의 결과를 확인한다
    const { SessionService } = await import('../../src/modules/session/session.service.js');
    const stopped = await app
      .get(SessionService)
      .steer({ projectId, sessionId, kind: 'stop', message: '중단', userId: adminId });
    expect(stopped.reclaimed).toBe(1);

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]?.status).toBe('ready');
  });

  it('타임라인은 seq 순이고 사람의 개입이 같은 줄에 섞인다', async () => {
    const sessionId = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'codex','linux-ci-01','active')`,
      [sessionId, projectId, adminId],
    );
    const { SessionService } = await import('../../src/modules/session/session.service.js');
    const sessions = app.get(SessionService);
    await sessions.appendActivity({
      sessionId,
      projectId,
      seq: 1n,
      type: 'action',
      title: '파일 수정',
    });
    await sessions.steer({
      projectId,
      sessionId,
      kind: 'steer',
      message: '이쪽으로',
      userId: adminId,
    });

    const res = await call('GET', `/api/v1/projects/clemvion/sessions/${sessionId}/activities`);
    const items = res.body as Record<string, unknown>[];
    expect(items.map((i) => i['type'])).toEqual(['action', 'elicitation']);

    // 지시는 한 번만 전달된다 — 두 번 주면 에이전트가 같은 지시를 두 번 따른다
    expect(await sessions.takePendingInstructions(sessionId)).toHaveLength(1);
    expect(await sessions.takePendingInstructions(sessionId)).toHaveLength(0);
  });
});

describe('리뷰 처분 REST — 웹이 보내는 값이 그대로 저장된다 (EP-REV-02)', () => {
  it('`spec_change` 가 `dismissed` 로 접히지 않고 근거 버전이 남는다', async () => {
    // 웹 리뷰 센터의 처분 대화상자가 실제로 보내는 모양이다. 예전에는 REST 컨트롤러가
    // 3값짜리 번역표를 따로 들고 있어서 이 값이 `dismissed` 로 접히고 `spec_version_id`
    // 는 통째로 버려졌다 — 감사에는 "오탐으로 기각" 이 남았다(REQ-API-060).
    const reviewSessionId = newId();
    const findingId = newId();
    const fingerprint = findingId.replaceAll('-', '').slice(0, 32);
    await pool.query(
      `INSERT INTO review_session (id, project_id, branch, base_sha, head_sha, changeset_hash,
                                   kind, trigger)
       VALUES ($1,$2,'feat/x','base','head',decode($3,'hex'),'code','manual')`,
      [reviewSessionId, projectId, fingerprint],
    );
    await pool.query(
      `INSERT INTO finding (id, project_id, fingerprint, category, severity, status, title,
                            first_session_id, last_session_id)
       VALUES ($1,$2,decode($3,'hex'),'spec_drift','warning','open','문서와 다르다',$4,$4)`,
      [findingId, projectId, fingerprint, reviewSessionId],
    );
    const specVersionId = await seedSpecVersion();

    const res = await call('POST', `/api/v1/projects/clemvion/findings/${findingId}/resolve`, {
      payload: {
        resolution: 'spec_change',
        rationale: '스펙을 고쳐 해결했다',
        spec_version_id: specVersionId,
      },
    });
    expect(res.status).toBe(201);

    const { rows } = await pool.query<{ kind: string; status: string; version: string | null }>(
      `SELECT r.kind::text AS kind, f.status::text AS status, r.spec_version_id AS version
         FROM resolution r JOIN finding f ON f.id = r.finding_id
        WHERE r.finding_id = $1`,
      [findingId],
    );
    expect(rows[0]?.kind).toBe('spec_change');
    expect(rows[0]?.status).toBe('fixed');
    expect(rows[0]?.version).toBe(specVersionId);
  });

  it('계약 밖의 값은 기각으로 읽지 않는다 — 입력 오류다', async () => {
    const res = await call('POST', `/api/v1/projects/clemvion/findings/${newId()}/resolve`, {
      payload: { resolution: 'maybe', rationale: '?' },
    });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'invalid_input',
      field: 'resolution',
    });
  });
});

describe('세션 보드 상태 필터 (EP-SES-01) — 값은 조립되지 않는다', () => {
  /** 다른 프로젝트의 세션 하나 — WHERE 절이 무너지면 이 행이 응답에 새어 나온다 */
  async function seedOtherProjectSession(): Promise<string> {
    const otherProjectId = newId();
    const otherSessionId = newId();
    // UUIDv7 은 앞자리가 시각이라 같은 실행에서 겹친다 — 유니크 축은 뒷자리에서 만든다
    const suffix = otherProjectId.slice(-6);
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,'다른 프로젝트')`,
      [otherProjectId, orgId, `other-${suffix}`, `O${suffix.toUpperCase()}`],
    );
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','secret-host','active')`,
      [otherSessionId, otherProjectId, adminId],
    );
    return otherSessionId;
  }

  it('인젝션 시도는 WHERE 절을 재작성하지 못하고 거절된다 — 남의 프로젝트 세션이 새지 않는다', async () => {
    const leaked = await seedOtherProjectSession();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','mac-01','active')`,
      [newId(), projectId, adminId],
    );

    // 예전에는 이 값이 `ARRAY['…']::session_state[]` 안에 그대로 이어 붙어
    // `s.project_id = $1` 술어를 `OR 1=1` 로 무력화할 수 있었다.
    const payload = "active']::session_state[]) OR 1=1 --";
    const res = await call(
      'GET',
      `/api/v1/projects/clemvion/sessions?state=${encodeURIComponent(payload)}`,
    );

    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body['code']).toBe(NERV_ERROR.PRECONDITION);
    expect(body['details']).toMatchObject({ kind: 'invalid_input', field: 'state' });
    // 응답 어디에도 다른 프로젝트의 세션이 없다
    expect(JSON.stringify(res.body)).not.toContain(leaked);
    expect(JSON.stringify(res.body)).not.toContain('secret-host');
  });

  it('모르는 상태값은 거절한다 — 조용히 무시하면 필터가 거짓말을 한다', async () => {
    const res = await call('GET', '/api/v1/projects/clemvion/sessions?state=active,uploading');
    expect(res.status).toBe(400);
    const details = (res.body as Record<string, unknown>)['details'] as Record<string, unknown>;
    expect(details['unknown']).toEqual(['uploading']);
    expect(details['allowed']).toContain('active');
  });

  it('어휘 안의 값은 그 상태만 남긴다 — 필터 자체는 그대로 동작한다', async () => {
    await seedOtherProjectSession();
    const activeId = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','mac-02','active')`,
      [activeId, projectId, adminId],
    );
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'codex','mac-03','complete')`,
      [newId(), projectId, adminId],
    );

    const res = await call('GET', '/api/v1/projects/clemvion/sessions?state=active');
    expect(res.status).toBe(200);
    const items = (res.body as Record<string, unknown>)['items'] as Record<string, unknown>[];
    expect(items.every((i) => i['state'] === 'active')).toBe(true);
    expect(items.map((i) => i['id'])).toContain(activeId);
    // 프로젝트 경계도 그대로다
    expect(items.every((i) => i['hostname'] !== 'secret-host')).toBe(true);
  });
});

describe('문서에 없는 승인·거절 REST 는 없다 (api.md §2.2)', () => {
  it('POST /specs/approve · /specs/reject 는 존재하지 않는다 — 전이는 EP-APR-03 한 경로다', async () => {
    for (const path of ['specs/approve', 'specs/reject']) {
      const res = await call('POST', `/api/v1/projects/clemvion/${path}`, {
        payload: { spec_version_id: newId() },
      });
      // 결재를 거치지 않는 확정 경로였다 — 지금은 라우트 자체가 없다
      expect(res.status).toBe(404);
    }
  });
});

describe('라우트 권한 집행 (§2 전표의 권한 열)', () => {
  // viewer 는 역할도 스코프도 읽기뿐이다(ROLE_SCOPES.viewer = ['spec:read']).
  // 예전에는 이 토큰으로 아래가 **전부 통과했다** — 판정 함수는 있었고 부르는 곳이 없었다.
  it('viewer 토큰은 Task 를 만들지 못한다 (EP-TASK-03 planner·developer·admin·qa)', async () => {
    const res = await call('POST', '/api/v1/projects/clemvion/tasks', {
      token: viewerToken,
      payload: { title: '몰래 만든 작업', goal_md: '목표' },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.FORBIDDEN);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'role_required',
    });
  });

  it('viewer 토큰은 클레임·전이를 하지 못한다 (EP-TASK-06·09)', async () => {
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업','ready','목표','PR','도구','경계')`,
      [taskId, projectId, `TSK-${taskId.slice(-6)}`],
    );

    const claimed = await call('POST', `/api/v1/projects/clemvion/tasks/${taskId}/claim`, {
      token: viewerToken,
      payload: { scope: { spec_ids: [], file_globs: [] } },
    });
    expect(claimed.status).toBe(403);
    expect((claimed.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'missing_scope',
    });

    const moved = await call('POST', `/api/v1/projects/clemvion/tasks/${taskId}/transition`, {
      token: viewerToken,
      payload: { status: 'done' },
    });
    expect(moved.status).toBe(403);

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]?.status).toBe('ready');
  });

  it('viewer 토큰은 초안을 저장하지 못한다 (EP-SPEC-08 `spec:draft`)', async () => {
    const res = await call('PUT', '/api/v1/projects/clemvion/specs/SPC-GUARD/draft', {
      token: viewerToken,
      payload: { body_markdown: '# 덮어쓰기' },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'missing_scope',
      required: ['spec:draft'],
    });
  });

  it('읽기는 그대로 열려 있다 — 막은 것은 쓰기다', async () => {
    const res = await call('GET', '/api/v1/projects/clemvion/tasks', { token: viewerToken });
    expect(res.status).toBe(200);
  });
});

describe('세션 지시는 소유자·admin 만 (EP-SES-04)', () => {
  it('남의 세션은 멈추지 못한다 — stop 은 남의 클레임을 회수하는 일이다', async () => {
    const sessionId = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','mac-09','active')`,
      [sessionId, projectId, adminId],
    );
    const { SessionService } = await import('../../src/modules/session/session.service.js');
    const sessions = app.get(SessionService);

    await expect(
      sessions.steer({ projectId, sessionId, kind: 'stop', message: '중단', userId: viewerId }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'not_owner' } });

    // admin 은 된다(전표의 "세션 소유자·admin")
    const ok = await sessions.steer({
      projectId,
      sessionId,
      kind: 'steer',
      message: '이쪽으로',
      userId: viewerId,
      isAdmin: true,
    });
    expect(ok.ok).toBe(true);
  });
});

describe('받은 요청·알림·커버리지 표면', () => {
  it('전역 받은 요청은 프로젝트를 가로지르고 대기 시간을 싣는다 (EP-APR-01)', async () => {
    const { ApprovalService } = await import('../../src/modules/approval/approval.service.js');
    const specVersionId = await seedSpecVersion();
    await app.get(ApprovalService).request({
      projectId,
      subjectType: 'spec_version',
      subjectId: specVersionId,
      requestedByUserId: viewerId,
      assigneeUserId: adminId,
    });

    // PAT 는 사람이 아니다 — 전역 받은 요청은 세션 쿠키(사람)만 본다(D-08 · auth-session.spec.ts)
    const denied = await call('GET', '/api/v1/approvals');
    expect(denied.status).toBe(403);

    const { ApprovalService: Service } =
      await import('../../src/modules/approval/approval.service.js');
    const items = await app.get(Service).inboxGlobal({ userId: adminId });
    expect(items).toHaveLength(1);
    expect(items[0]?.['project_slug']).toBe('clemvion');
    expect(items[0]).toHaveProperty('waiting_seconds');
    expect(items[0]?.['self_requested']).toBe(false);
  });

  it('커버리지는 빈 약속과 증적 결손을 센다 (clemvion R-5 의 자동 검출)', async () => {
    const specVersionId = await seedSpecVersion();
    const { rows } = await pool.query<{ spec_id: string }>(
      `SELECT spec_id FROM spec_version WHERE id = $1`,
      [specVersionId],
    );
    const specId = rows[0]?.spec_id ?? '';
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority, impl_status,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-COV-1','문장','must','unimplemented',$4,$4),
              ($5,$2,$3,'REQ-COV-2','문장','must','implemented',$4,$4)`,
      [newId(), projectId, specId, specVersionId, newId()],
    );

    const res = await call('GET', '/api/v1/projects/clemvion/coverage');
    const totals = (res.body as Record<string, unknown>)['totals'] as Record<string, number>;
    expect(totals['total']).toBe(2);
    expect(totals['empty_promises']).toBe(1); // 책임지는 Task 가 없는 미구현
    expect(totals['evidence_missing']).toBe(1); // implemented 인데 증적 없음
  });

  it('알림은 남의 것을 읽음 처리할 수 없다', async () => {
    const notificationId = newId();
    // 알림은 event 참조다 — 먼저 사건이 있어야 알림이 있다(D-10)
    await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: '알림용' } });
    await pool.query(
      `INSERT INTO notification (id, user_id, project_id, event_id, importance, state)
       SELECT $1, $2, $3, e.id, 'immediate', 'unread' FROM event e WHERE e.project_id = $3 LIMIT 1`,
      [notificationId, viewerId, projectId],
    );
    await call('POST', `/api/v1/me/notifications/${notificationId}/read`);
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state::text AS state FROM notification WHERE id = $1`,
      [notificationId],
    );
    expect(rows[0]?.state).toBe('unread');
  });

  it('이벤트 피드는 사람/에이전트를 구분해 싣는다 (FR-16 · D-08)', async () => {
    await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: '이벤트용' } });
    const res = await call('GET', '/api/v1/projects/clemvion/events');
    const items = res.body as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('is_agent');
    expect(items[0]).toHaveProperty('actor_name');
  });
});

async function seedSpecVersion(): Promise<string> {
  const specId = newId();
  const versionId = newId();
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,'스펙')`,
    // 앞자리를 잘라 쓰면 UUIDv7 의 시각 부분이 겹친다 — 예전에는 ON CONFLICT 로 삼켜져
    // "spec 이 안 만들어졌는데 성공한" 상태가 됐다(유니크 인덱스가 그것을 드러냈다)
    [specId, projectId, `SPC-${specId}`],
  );
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
     VALUES ($1,$2,1,'in_review','# 본문', decode('00','hex'), $3)`,
    [versionId, specId, adminId],
  );
  return versionId;
}

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  adminId = newId();
  viewerId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES
       ($1,'admin@example.com','관리자','active'), ($2,'viewer@example.com','뷰어','active')`,
    [adminId, viewerId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
       ($1,$2,$3,$4,'admin'), ($5,$2,$3,$6,'viewer')`,
    [newId(), orgId, projectId, adminId, newId(), viewerId],
  );
}

describe('문서 대조에서 드러난 표면 — 경로가 전표와 같아야 한다', () => {
  it('EP-SPEC-07·08 — 생성과 이어쓰기가 갈라져 있다', async () => {
    const created = await call('POST', '/api/v1/projects/clemvion/specs', {
      payload: { key: 'SPC-PATHS', title: '경로 정합', type: 'feature', body_markdown: '# 본문' },
    });
    expect(created.status).toBe(201);

    // 이어쓰기는 경로에 스펙 키가 있다 — 본문에 spec_id 를 싣지 않는다.
    // `base_hash` 는 **읽은 내용의 지문**이라 생성 응답이 준 것을 그대로 되돌려 준다(§1.4g)
    const updated = await call('PUT', '/api/v1/projects/clemvion/specs/SPC-PATHS/draft', {
      payload: {
        body_markdown: '# 본문\n\n이어서',
        base_version: (created.body as Record<string, unknown>)['spec_version_id'],
        base_hash: (created.body as Record<string, unknown>)['content_hash'],
      },
    });
    expect(updated.status).toBe(200);

    // 지문 없이 부르면 막힌다 — 필수인 것이 이 표면에서도 필수다
    const naked = await call('PUT', '/api/v1/projects/clemvion/specs/SPC-PATHS/draft', {
      payload: { body_markdown: '# 지문 없이' },
    });
    expect(naked.status).toBe(409);
    expect((naked.body as { details?: { kind?: string } }).details?.kind).toBe(
      'base_hash_required',
    );
  });

  it('EP-SPEC-05 — 버전 스냅샷은 같은 번호에 같은 응답이다', async () => {
    const res = await call('GET', '/api/v1/projects/clemvion/specs/SPC-PATHS/versions/1');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>)['version_no']).toBe(1);
  });

  it('EP-ORG-02 — 멤버가 아니면 조직의 존재도 알려주지 않는다', async () => {
    const mine = await call('GET', '/api/v1/orgs/nerv');
    expect(mine.status).toBe(200);
    expect((mine.body as Record<string, unknown>)['member_count']).toBeGreaterThan(0);

    const other = await call('GET', '/api/v1/orgs/nobody');
    expect(other.status).toBe(409);
  });

  it('EP-PRJ-02 — 프로젝트를 만들면 만든 사람이 admin 멤버가 된다', async () => {
    const res = await call('POST', '/api/v1/orgs/nerv/projects', {
      payload: { slug: 'new-proj', key: 'NEW', name: '새 프로젝트' },
    });
    expect(res.status).toBe(201);

    const { rows } = await pool.query<{ role: string }>(
      `SELECT m.role::text AS role FROM membership m JOIN project p ON p.id = m.project_id
        WHERE p.slug = 'new-proj' AND m.user_id = $1`,
      [adminId],
    );
    expect(rows[0]?.role).toBe('admin');
  });

  it('EP-MBR-02 — 없는 사용자는 만들지 않고 거절한다(MVP 초대는 기존 사용자 배정)', async () => {
    const res = await call('POST', '/api/v1/orgs/nerv/members', {
      payload: { email: 'ghost@example.com', role: 'developer' },
    });
    expect(res.status).toBe(409);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'user_not_found',
    });

    const ok = await call('POST', '/api/v1/orgs/nerv/members', {
      payload: { email: 'viewer@example.com', role: 'qa', project: 'new-proj' },
    });
    expect(ok.status).toBe(201);
  });

  it('viewer 는 웹으로 들어와도 메타·아카이브·베이스라인을 못 건드린다 (역할 매트릭스)', async () => {
    await call('POST', '/api/v1/projects/clemvion/specs', {
      payload: { key: 'SPC-RBAC', title: '권한 시험', type: 'feature', body_markdown: '# 본문' },
    });
    // `assertScope` 는 "세션 사용자는 역할 매트릭스가 판정한다"고 적어 두고 그 매트릭스가
    // 없어 `if (!isAgent) return;` 로 통과시켰다. 웹으로 들어오면 viewer 도 스펙을
    // 아카이브하고 베이스라인을 동결할 수 있었다(실측 2026-08-23).
    const denied = [
      ['PATCH', `/api/v1/projects/clemvion/specs/SPC-RBAC`, { title: '바꿔본다' }],
      ['POST', `/api/v1/projects/clemvion/specs/SPC-RBAC/archive`, {}],
      ['POST', '/api/v1/projects/clemvion/baselines', { name: 'b1' }],
    ] as const;
    for (const [method, url, payload] of denied) {
      const res = await call(method, url, { token: viewerToken, payload });
      expect([403, 404]).toContain(res.status); // 403 이 정답, 404 는 라우트 오탈자 방어
      expect(res.status).toBe(403);
      expect((res.body as { details: Record<string, unknown> }).details['kind']).toBe(
        'missing_scope',
      );
    }
  });

  it('권한이 있으면 스코프 문턱은 넘는다 — 조인 것이 아니라 **가른** 것이다', async () => {
    // 전부 막으면 조인 것이 아니라 부순 것이다. 다만 EP-SPEC-15 는 그 다음 문턱이
    // **사람 전용**이라(requireHuman) PAT 는 어차피 못 지난다 — 그래서 "통과했다"가 아니라
    // "**스코프에서 막히지는 않았다**"를 본다. 두 문턱은 다른 것을 지킨다.
    const res = await call('PATCH', '/api/v1/projects/clemvion/specs/SPC-RBAC', {
      payload: { title: 'admin 이 고친 제목' },
    });
    const kind = (res.body as { details?: Record<string, unknown> }).details?.['kind'];
    expect(kind).not.toBe('missing_scope');
    expect(kind).toBe('human_only');
  });

  it('EP-MBR-03 — 멤버십 경로에 프로젝트가 없어도 admin 을 확인한다', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM membership WHERE user_id = $1 AND project_id IS NOT NULL LIMIT 1`,
      [viewerId],
    );
    const membershipId = rows[0]?.id ?? '';

    const denied = await call('PATCH', `/api/v1/memberships/${membershipId}`, {
      token: viewerToken,
      payload: { role: 'admin' },
    });
    expect(denied.status).toBe(403);

    const allowed = await call('PATCH', `/api/v1/memberships/${membershipId}`, {
      payload: { role: 'designer' },
    });
    expect(allowed.status).toBe(200);
  });

  it('EP-TOK-04 — 조직 전체 토큰 표에도 원문은 없다', async () => {
    const res = await call('GET', '/api/v1/orgs/nerv/tokens');
    expect(res.status).toBe(200);
    for (const token of res.body as Record<string, unknown>[]) {
      expect(Object.keys(token)).not.toContain('token');
      expect(token).toHaveProperty('owner');
    }
  });

  it('EP-CMT-03 — 남의 코멘트는 고칠 수 없다', async () => {
    const specVersionId = await seedSpecVersion();
    const { SpecCommentService } = await import('../../src/modules/spec/spec-comment.service.js');
    const comment = await app.get(SpecCommentService).add({
      projectId,
      specVersionId,
      anchor: 'REQ-X-1',
      bodyMd: '원문',
      userId: viewerId,
    });

    const res = await call('PATCH', `/api/v1/projects/clemvion/comments/${comment.comment_id}`, {
      payload: { body_md: '남이 고친 본문' },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({ kind: 'not_author' });
  });

  it('토큰 목록에 마지막 사용 호스트가 실린다 (REQ-WEB-026)', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/specs/tree',
      headers: { authorization: `Bearer ${adminToken}`, 'x-nerv-host': 'mac-07' },
    });
    // last_used 갱신은 요청을 막지 않는 비동기라 잠깐 기다린다
    await new Promise((r) => setTimeout(r, 150));

    const res = await call('GET', '/api/v1/me/tokens');
    const tokens = res.body as Record<string, unknown>[];
    expect(tokens.some((t) => t['last_used_hostname'] === 'mac-07')).toBe(true);
  });
});
