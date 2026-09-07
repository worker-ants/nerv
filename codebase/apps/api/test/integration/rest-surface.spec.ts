// REST 표면 전량 — 프로젝트·멤버·토큰 · Task · 세션 steer · 받은 요청 · 커버리지 · 알림
//
// 실제 HTTP 로 돈다. 서비스 단위 테스트가 이미 판정을 지키고 있으므로 여기서 확인할 것은
// **번역**이다(REQ-CB-003): 경로·역할 가드·에러 코드가 화면이 기대하는 모양으로 나오는가.
// 화면(E08)이 이 계약 위에 올라가므로, 여기가 어긋나면 화면은 조용히 빈 상태를 렌더한다.

import { createHash } from 'node:crypto';
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
let narrowToken: string;
let reviewToken: string;
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
  // 리뷰 제출은 `review:submit` 이 따로 있다 — adminToken 에 얹지 않는다.
  // 얹으면 권한 집행을 보는 다른 검사들이 "어느 축이 통과시켰는가" 를 구별하지 못한다.
  reviewToken = (
    await auth.issueToken({
      projectId,
      userId: adminId,
      name: 'admin-review-pat',
      scopes: ['spec:read', 'review:submit'],
    })
  ).token;
  // **역할은 admin, 권한은 읽기뿐.** 역할만 보던 자리를 잡아내려면 이 조합이 필요하다 —
  // adminToken 은 두 축을 다 갖고 있어서 어느 쪽이 통과시켰는지 구별하지 못한다.
  narrowToken = (
    await auth.issueToken({
      projectId,
      userId: adminId,
      name: 'admin-narrow-pat',
      scopes: ['spec:read'],
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

  it('게이트 정책 편집은 admin 만 — 그리고 admin 이어도 토큰으로는 못 한다 (2026-09-04)', async () => {
    const policy = { spec_gate: { tier_boundaries: [2, 4, 7] } };

    const denied = await call('PATCH', '/api/v1/projects/clemvion', {
      token: viewerToken,
      payload: { gate_policy: policy },
    });
    expect(denied.status).toBe(403);
    expect((denied.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.FORBIDDEN);

    // **역할이 admin 이어도 PAT 는 막힌다.** 게이트 면제(EP-APR-04)가 이미 사람 전용인데
    // 정책 자체를 낮추는 길이 토큰에 열려 있으면 그것이 면제의 우회로가 된다.
    const asAgent = await call('PATCH', '/api/v1/projects/clemvion', {
      payload: { gate_policy: policy },
    });
    expect(asAgent.status).toBe(403);
    expect((asAgent.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);

    // 사람 경로의 성공은 서비스가 지킨다 — 표면은 번역만 한다(D-05).
    const saved = (
      await app.get(AuthService).updateProject({
        projectId,
        roles: ['admin'],
        actor: { userId: adminId, isAgent: false },
        gatePolicy: policy,
      })
    )['gate_policy'] as Record<string, unknown>;
    expect((saved['spec_gate'] as Record<string, unknown>)['tier_boundaries']).toEqual([2, 4, 7]);
  });

  it('알 수 없는 정책 키는 거부한다 — 오타를 삼키면 게이트가 꺼진 줄 모르게 된다 (§2.1a)', async () => {
    // HTTP 자리는 이제 사람 전용이라(위 테스트) 판정을 도메인 서비스에서 본다.
    await expect(
      app.get(AuthService).updateProject({
        projectId,
        roles: ['admin'],
        actor: { userId: adminId, isAgent: false },
        gatePolicy: { spec_gate: { tier_boundries: [1, 2, 3] } },
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'invalid_policy' },
    });
  });

  it('보관·복구도 사람 전용이다 — 프로젝트를 목록에서 지우는 일은 같은 무게다', async () => {
    for (const path of ['archive', 'restore']) {
      const res = await call('POST', `/api/v1/projects/clemvion/${path}`, { payload: {} });
      expect(res.status).toBe(403);
      expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);
    }
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

  it('PAT 로는 PAT 를 발급할 수 없다 — 권한 상속의 사슬은 사람에서 시작한다 (D-08)', async () => {
    const res = await call('POST', '/api/v1/me/tokens', {
      payload: { project: 'clemvion', name: 'child', scopes: ['spec:read'] },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);
  });
});

/**
 * §1.4j — 어휘 밖의 값은 **거절이지 무시가 아니고, 500 도 아니다**(REQ-API-074).
 *
 * 라이브 실측(2026-09-03): 네 자리가 사용자의 오타에 500 을 돌려주고 있었다. 값이 그대로
 * `::enum` 으로 캐스팅되거나 `Number('abc')` 가 NaN 이 되어 SQL 이 22P02 로 죽는 자리다.
 * 500 은 "서버가 잘못했다, 기다렸다 다시" 라는 뜻이라 클라이언트는 고칠 수 없는 요청을
 * 재시도한다. 400 은 "이 목록에서 골라라" 다.
 */
/**
 * 알림 목록의 커서(REQ-API-083).
 *
 * 실측(2026-09-03): 한 사람의 안 읽은 알림 479건 중 **429건에 웹에서 닿을 수 없었다** —
 * 서비스에 상한은 있었는데 컨트롤러도 웹도 `limit` 을 넘기지 않아 언제나 최신 50건이었고,
 * 그 뒤로 가는 길이 없었다. 헤더 배지는 진짜 수를 보이므로 화면이 자기 배지와 어긋났다.
 */
describe('EP-NTF-01 — 알림은 50 에서 끝나지 않는다', () => {
  it('커서로 다음 쪽을 이어 받는다', async () => {
    for (let i = 0; i < 3; i += 1) {
      const eventId = newId();
      await pool.query(
        `INSERT INTO event (id, project_id, occurred_at, type, is_agent, subject_type, subject_id, payload)
         VALUES ($1,$2, now() - ($3 || ' minutes')::interval, 'session.started', false,
                 'agent_session', $4, '{}'::jsonb)`,
        [eventId, projectId, String(i), newId()],
      );
      await pool.query(
        `INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state, created_at)
         VALUES ($1,$2,$3,$4,'immediate','inapp','unread', now() - ($5 || ' minutes')::interval)`,
        [newId(), projectId, adminId, eventId, String(i)],
      );
    }

    const first = await call('GET', '/api/v1/me/notifications?limit=2');
    const firstBody = first.body as { items: Record<string, unknown>[]; next_cursor: string };
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.next_cursor).toEqual(expect.any(String));

    const next = await call(
      'GET',
      `/api/v1/me/notifications?limit=2&before=${encodeURIComponent(firstBody.next_cursor)}`,
    );
    const nextBody = next.body as { items: Record<string, unknown>[] };
    expect(nextBody.items.length).toBeGreaterThan(0);
    // 같은 것을 두 번 주지 않는다 — 커서가 겹치면 사람은 읽은 것을 다시 읽는다
    const firstIds = firstBody.items.map((n) => n['id']);
    expect(nextBody.items.every((n) => !firstIds.includes(n['id']))).toBe(true);
  });
});

describe('오타는 400 이다 (§1.4j · REQ-API-074)', () => {
  it.each([
    ['tasks?status=doing', '/api/v1/projects/clemvion/tasks?status=doing', 'status'],
    [
      'requirements?impl_status=nope',
      '/api/v1/projects/clemvion/requirements?impl_status=nope',
      'impl_status',
    ],
    ['specs/:spec?v=abc', '/api/v1/projects/clemvion/specs/SPC-RBAC?v=abc', 'v'],
    ['events?limit=abc', '/api/v1/projects/clemvion/events?limit=abc', 'limit'],
  ])('%s → 400 이고 허용 목록을 준다', async (_name, url, field) => {
    const res = await call('GET', url);
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body['code']).toBe(NERV_ERROR.PRECONDITION);
    expect(body['details']).toMatchObject({ kind: 'invalid_input', field });
    // 무엇을 보낼 수 있는지 말해 주지 않으면 클라이언트는 같은 요청을 반복한다
    expect((body['details'] as { allowed: string[] }).allowed.length).toBeGreaterThan(0);
  });

  // 조용한 무시는 500 보다 나쁘다 — 사람은 걸러진 화면이라고 믿으면서 걸러지지 않은
  // 목록을 읽는다. 이 자리는 200 을 주면서 필터를 버리고 있었다(라이브 실측).
  it('발견 큐의 어휘 밖 필터는 조용히 버리지 않는다', async () => {
    const res = await call('GET', '/api/v1/projects/clemvion/findings?severity=HIGH');
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'invalid_input',
      field: 'severity',
    });
  });
});

describe('Task 표면 (EP-TASK-01·03·04·05·09)', () => {
  // 보드의 "내 담당" 이 기대는 계약이다. 화면이 상태 하나(`in_progress`)로 좁혀 세던 동안,
  // 담당이 지정된 Task 3건(ready 2 · blocked 1)이 세 사람 모두에게 0으로 보였다(실측).
  it('EP-TASK-01 — 상태 여럿과 담당자를 함께 거를 수 있다', async () => {
    const made = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: { title: '내 담당 집계' },
    });
    expect(made.status).toBe(201);
    const key = (made.body as Record<string, unknown>)['key'] as string;
    // 생성은 언제나 backlog 다 — 4요소가 차야 서버가 ready 로 올린다(같은 절의 다음 테스트)
    const ready = await call('PATCH', `/api/v1/projects/clemvion/tasks/${key}`, {
      payload: {
        goal_md: '목표',
        output_format_md: 'PR',
        tools_sources_md: '도구',
        boundaries_md: '경계',
        assignee_user_id: adminId,
      },
    });
    expect((ready.body as Record<string, unknown>)['status']).toBe('ready');

    // 라벨이 "내 담당" 이면 값도 사람 축이어야 한다 — 상태 하나로 좁히면 둘이 어긋난다
    const mine = await call(
      'GET',
      `/api/v1/projects/clemvion/tasks?status=ready,claimed,in_progress,in_review,blocked&assignee=${adminId}`,
    );
    expect(mine.status).toBe(200);
    const keys = ((mine.body as { items: Record<string, unknown>[] }).items ?? []).map(
      (t) => t['key'],
    );
    expect(keys).toContain(key);

    // 대조군 — 한 상태로만 좁히면 같은 Task 가 사라진다(예전 화면이 세던 방식이다)
    const narrow = await call(
      'GET',
      `/api/v1/projects/clemvion/tasks?status=in_progress&assignee=${adminId}`,
    );
    const narrowKeys = ((narrow.body as { items: Record<string, unknown>[] }).items ?? []).map(
      (t) => t['key'],
    );
    expect(narrowKeys).not.toContain(key);
  });

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
    const stopped = await app.get(SessionService).steer({
      actor: { userId: adminId, isAgent: false },
      projectId,
      sessionId,
      kind: 'stop',
      message: '중단',
      userId: adminId,
    });
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
      actor: { userId: adminId, isAgent: false },
      projectId,
      sessionId,
      kind: 'steer',
      message: '이쪽으로',
      userId: adminId,
    });

    const res = await call('GET', `/api/v1/projects/clemvion/sessions/${sessionId}/activities`);
    // **봉투다**(2026-09-06 · REQ-API-120) — 200건에서 조용히 잘리던 자리라 커서가 붙었다
    const body = res.body as { items: Record<string, unknown>[]; next_cursor: string | null };
    expect(body.items.map((i) => i['type'])).toEqual(['action', 'elicitation']);
    expect(body.next_cursor).toBeNull();

    // 지시는 한 번만 전달된다 — 두 번 주면 에이전트가 같은 지시를 두 번 따른다
    expect(await sessions.takePendingInstructions(sessionId)).toHaveLength(1);
    expect(await sessions.takePendingInstructions(sessionId)).toHaveLength(0);
  });
});

describe('리뷰 제출 REST — 지적 본문이 저장까지 간다 (EP-REV-01 · REQ-API-114)', () => {
  // **표면마다 번역이 따로 있으면 한쪽만 낡는다.** 계약은 `body`·`suggestion` 으로 오고
  // 저장 열은 `body_md`·`suggestion_md` 인데, 그 번역이 MCP 쪽에만 있었고 REST 컨트롤러는
  // 타입만 맞춰 캐스팅했다 — 컴파일도 lint 도 통과했고 **REST 로 올린 리뷰의 지적 본문과
  // 제안은 전부 NULL 로 저장됐다.** 서비스를 직접 부르는 L2 는 이미 `body_md` 를 넘기고
  // 있어 이 자리를 지나쳤다. 그래서 이 검사는 **실제 HTTP 로** 돈다.
  it('body·suggestion 이 detail_md·suggestion_md 로 저장된다', async () => {
    const res = await call('POST', '/api/v1/projects/clemvion/reviews', {
      token: reviewToken,
      payload: {
        branch: 'feat/rest-review',
        base_sha: 'base-rest',
        head_sha: 'head-rest',
        reviewer: { role: 'qa', risk: 'low' },
        findings: [
          {
            severity: 'warning',
            title: '요청 로거가 Authorization 헤더를 통째로 찍는다',
            body: '마스킹 없이 토큰 원문이 로그에 남는다.',
            suggestion: '헤더 화이트리스트를 두고 나머지는 가린다.',
            file: 'apps/api/src/main.ts',
            line: 42,
          },
        ],
      },
    });
    expect(res.status).toBe(201);

    const { rows } = await pool.query<{
      detail_md: string | null;
      suggestion_md: string | null;
      file_path: string | null;
      line_start: number | null;
    }>(
      `SELECT detail_md, suggestion_md, file_path, line_start
         FROM finding
        WHERE project_id = $1 AND title = $2`,
      [projectId, '요청 로거가 Authorization 헤더를 통째로 찍는다'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail_md).toBe('마스킹 없이 토큰 원문이 로그에 남는다.');
    expect(rows[0]?.suggestion_md).toBe('헤더 화이트리스트를 두고 나머지는 가린다.');
    // 같은 매퍼가 옮기는 나머지 필드도 함께 본다 — 한 칸만 고치고 끝내지 않기 위해서다
    expect(rows[0]?.file_path).toBe('apps/api/src/main.ts');
    expect(rows[0]?.line_start).toBe(42);
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
  // viewer 는 역할도 권한도 읽기뿐이다(ROLE_SCOPES.viewer = ['spec:read']).
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

  /**
   * 역할만 보던 세 자리 (2026-09-04 · 실측).
   *
   * `@RequireRole` 만 걸린 라우트는 **토큰의 권한을 보지 않았다.** 그래서 `spec:read` 하나만
   * 체크한 토큰으로도 Task 를 만들고 증적을 올릴 수 있었고, 같은 작업의 MCP 경로
   * (`nerv_task_create` — `task:update`)와 권한이 달랐다. 발급 화면의 체크박스가 토큰의
   * 실제 권한보다 좁았다는 뜻이다.
   */
  it('admin 역할이어도 권한이 없으면 Task 를 만들지 못한다 (EP-TASK-03)', async () => {
    const res = await call('POST', '/api/v1/projects/clemvion/tasks', {
      token: narrowToken,
      payload: { title: '권한 없이 생성' },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'missing_scope',
      required: ['task:update'],
    });
  });

  it('증적 등록에도 권한이 필요하다 — CI 토큰을 증적만으로 좁힐 수 있어야 한다 (EP-REQ-03)', async () => {
    const specVersionId = await seedSpecVersion();
    const { rows } = await pool.query<{ spec_id: string }>(
      `SELECT spec_id FROM spec_version WHERE id = $1`,
      [specVersionId],
    );
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority, impl_status,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-EVD-1','문장','must','implemented',$4,$4)`,
      [newId(), projectId, rows[0]?.spec_id ?? '', specVersionId],
    );

    const denied = await call('POST', '/api/v1/projects/clemvion/requirements/REQ-EVD-1/evidence', {
      token: narrowToken,
      payload: { kind: 'pr', locator: 'https://example.com/pr/1' },
    });
    expect(denied.status).toBe(403);
    expect((denied.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'missing_scope',
      required: ['spec:evidence'],
    });

    const ciToken = (
      await app.get(AuthService).issueToken({
        projectId,
        userId: adminId,
        name: 'ci-evidence-only',
        scopes: ['spec:evidence'],
      })
    ).token;
    const allowed = await call(
      'POST',
      '/api/v1/projects/clemvion/requirements/REQ-EVD-1/evidence',
      { token: ciToken, payload: { kind: 'pr', locator: 'https://example.com/pr/1' } },
    );
    expect(allowed.status).toBeLessThan(300);

    // **전표가 발생 이벤트를 적으면 그것이 계약이다**(REQ-API-115). EP-REQ-03 은 처음부터
    // ★`evidence.added` 를 적었는데 이 경로는 INSERT 만 하고 이벤트를 내지 않았다 — 증적이
    // 실시간으로 화면에 닿지 않았고 감사 축(FR-16)에도 남지 않았다.
    const { rows: evt } = await pool.query<{ subject_type: string; payload: { kind: string } }>(
      `SELECT subject_type, payload FROM event
        WHERE project_id = $1 AND type = 'evidence.added'
        ORDER BY occurred_at DESC LIMIT 1`,
      [projectId],
    );
    expect(evt).toHaveLength(1);
    expect(evt[0]?.subject_type).toBe('requirement');
    expect(evt[0]?.payload?.kind).toBe('pr');

    // 이 스위트는 requirement 를 비우지 않는다 — 남기면 커버리지 테스트가 세는 수가 달라진다
    await pool.query(`DELETE FROM evidence WHERE requirement_id IN
                        (SELECT id FROM requirement WHERE ref = 'REQ-EVD-1')`);
    await pool.query(`DELETE FROM requirement WHERE ref = 'REQ-EVD-1'`);
  });

  /**
   * 2단계 — **Task 가 기준 세트를 물고 간다**(REQ-API-087 · spec-workflow §4.1).
   *
   * 컬럼(`task.baseline_id`)은 2026-08 부터 있었는데 REST·MCP 어느 쪽도 값을 넘기지 않아
   * 실사용 487건이 **전부 NULL** 이었다(실측 2026-09-04). 기준 버전이 "이 문서의 어느 버전"
   * 이라면 기준선은 "주변 문서까지 포함한 어느 세트" 다.
   */
  it('Task 파생이 기준선 이름을 받아 고정한다 (EP-TASK-03)', async () => {
    const specVersionId = await seedSpecVersion();
    await pool.query(`UPDATE spec_version SET status = 'approved' WHERE id = $1`, [specVersionId]);
    const baselineId = newId();
    const { rows: spec } = await pool.query<{ spec_id: string }>(
      `SELECT spec_id FROM spec_version WHERE id = $1`,
      [specVersionId],
    );
    await pool.query(
      `INSERT INTO spec_baseline (id, project_id, name, created_by_user_id) VALUES ($1,$2,'r1',$3)`,
      [baselineId, projectId, adminId],
    );
    await pool.query(
      `INSERT INTO spec_baseline_item (baseline_id, spec_id, spec_version_id) VALUES ($1,$2,$3)`,
      [baselineId, spec[0]?.spec_id, specVersionId],
    );

    const made = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: { title: '기준선 맥락 작업', baseline: 'r1' },
    });
    expect(made.status).toBeLessThan(300);

    const { rows } = await pool.query<{ name: string }>(
      `SELECT b.name FROM task t JOIN spec_baseline b ON b.id = t.baseline_id WHERE t.key = $1`,
      [(made.body as Record<string, unknown>)['key']],
    );
    expect(rows[0]?.name).toBe('r1');

    await pool.query(`DELETE FROM task WHERE baseline_id = $1`, [baselineId]);
    await pool.query(`DELETE FROM spec_baseline_item WHERE baseline_id = $1`, [baselineId]);
    await pool.query(`DELETE FROM spec_baseline WHERE id = $1`, [baselineId]);
  });

  it('없는 기준선 이름으로는 Task 를 만들지 않는다 — 조용히 NULL 이 되지 않는다', async () => {
    const res = await call('POST', '/api/v1/projects/clemvion/tasks', {
      payload: { title: '오타', baseline: 'r9' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'invalid_input',
      field: 'baseline',
      unknown: ['r9'],
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
      sessions.steer({
        actor: { userId: adminId, isAgent: false },
        projectId,
        sessionId,
        kind: 'stop',
        message: '중단',
        userId: viewerId,
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'not_owner' } });

    // admin 은 된다(전표의 "세션 소유자·admin")
    const ok = await sessions.steer({
      actor: { userId: adminId, isAgent: false },
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
    const items = await app
      .get(Service)
      .inboxGlobal({ userId: adminId, actor: { userId: adminId, isAgent: false } });
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

  /**
   * 일괄 읽음(EP-NTF-03 · REQ-WEB-137). 실측 2026-09-04: 안 읽은 알림이 695건이었다 —
   * 한 건씩 지우는 것이 유일한 길이면 그 배지는 **지울 수 없는 숫자**가 되고, 지울 수
   * 없는 배지는 곧 읽지 않는 배지가 된다.
   */
  it('일괄 읽음이 남은 것을 전부 치우고 몇 건인지 말한다', async () => {
    // 앞선 테스트의 상태에 기대지 않는다 — 자기 것을 심고 그 수를 센다
    for (let i = 0; i < 4; i += 1) {
      const eventId = newId();
      await pool.query(
        `INSERT INTO event (id, project_id, occurred_at, type, is_agent, subject_type, subject_id, payload)
         VALUES ($1,$2, now(), 'session.started', false, 'agent_session', $3, '{}'::jsonb)`,
        [eventId, projectId, newId()],
      );
      await pool.query(
        `INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state)
         VALUES ($1,$2,$3,$4,'immediate','inapp','unread')`,
        [newId(), projectId, adminId, eventId],
      );
    }

    const { rows: before } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM notification WHERE user_id = $1 AND state = 'unread'`,
      [adminId],
    );
    const pending = Number(before[0]?.n ?? 0);
    expect(pending).toBeGreaterThanOrEqual(4);

    const res = await call('POST', '/api/v1/me/notifications/read-all', { payload: {} });
    expect(res.status).toBeLessThan(300);
    // **몇 개를 치웠는지 말한다** — 조용히 0 이 되는 목록은 사고처럼 보인다
    expect((res.body as Record<string, unknown>)['marked']).toBe(pending);

    const { rows: after } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM notification WHERE user_id = $1 AND state = 'unread'`,
      [adminId],
    );
    expect(Number(after[0]?.n ?? 0)).toBe(0);
  });

  it('치울 것이 없으면 0 을 말한다 — 없는 일을 했다고 하지 않는다', async () => {
    await call('POST', '/api/v1/me/notifications/read-all', { payload: {} });
    const res = await call('POST', '/api/v1/me/notifications/read-all', { payload: {} });
    expect((res.body as Record<string, unknown>)['marked']).toBe(0);
  });

  it('이벤트 피드는 사람/에이전트를 구분해 싣는다 (FR-16 · D-08)', async () => {
    await call('POST', '/api/v1/projects/clemvion/tasks', { payload: { title: '이벤트용' } });
    const res = await call('GET', '/api/v1/projects/clemvion/events');
    // 전표가 `Page<X>` 라 적던 것이 이제 사실이다(REQ-API-120)
    const { items } = res.body as { items: Record<string, unknown>[]; next_cursor: string | null };
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('is_agent');
    expect(items[0]).toHaveProperty('actor_name');
  });
});

/**
 * **REST 가 전표대로 입력을 받는가**(2026-09-05 · 정합성 감사).
 *
 * 이 describe 가 없어서 넷이 동시에 새고 있었다 — `relations`·하트비트 본문·`state_note`·
 * 검색 필터. 넷 다 **서비스는 받고 MCP 만 넘기고** 있었고, REST 컨트롤러가 본문에서 읽지
 * 않아 조용히 버려졌다. 보낸 쪽은 200 을 받으니 반영됐다고 믿는다.
 *
 * MCP 쪽은 `mcp.spec.ts` 가 이미 보고 있었다. 두 표면 중 **한쪽만 보는 검사는 D-05 가
 * 깨지는 것을 못 본다** — 같은 요청에 두 표면이 다르게 답해도 초록이었다.
 */
describe('REST 가 전표대로 입력을 받는다 (REQ-API-043·081 · EP-SPEC-02)', () => {
  /**
   * **어휘 밖 값은 이름을 부르며 거절된다**(2026-09-05 · REQ-API-112).
   *
   * 이 검사는 원래 "그물이 받는가" 를 봤다 — `db-error.ts` 에 `22P02` 를 더해
   * 어휘 검사가 없는 자리도 500 대신 400 이 되게 한 것(REQ-API-106)이 그 그물이다.
   * 그 뒤 자리마다 `assertVocab` 을 심어(REQ-API-112) **이 경로는 DB 까지 가지 않는다.**
   *
   * 그래서 여기서 세는 것을 바꾼다: 400 인 것은 같고, 이제 **어느 필드가 어긋났는지**
   * 말한다. 그물 자체는 L1(`nerv-exception.filter.spec.ts`)이 세 갈래로 지킨다 —
   * 그물은 2선이고, 이름을 부르는 것이 1선이다.
   */
  it('어휘 밖 값은 400 이고 어느 필드인지 말한다 — 그물이 아니라 검사가 답한다', async () => {
    const res = await call('POST', '/api/v1/orgs/nerv/members', {
      payload: { email: 'viewer@example.com', role: 'superuser', project: 'clemvion' },
    });
    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body['code']).toBe(NERV_ERROR.PRECONDITION);
    const details = body['details'] as Record<string, unknown>;
    expect(details['field']).toBe('role');
    // 무엇을 골라야 하는지 함께 준다 — "잘못된 입력" 만 주면 같은 요청이 다시 온다
    expect(details['allowed']).toBeDefined();
    // **보낸 값은 되돌려준다.** `db-error` 가 값을 숨기는 이유(Postgres 의 detail 에는
    // 남의 행 값이 들어 있다)는 여기 해당하지 않는다 — 이것은 부른 쪽 자신의 입력이고,
    // 무엇을 보냈는지 알아야 어디를 고칠지 안다.
    expect(details['unknown']).toEqual(['superuser']);
  });

  it('초안 저장이 relations 를 나른다 — 예전에는 성공 응답과 함께 버려졌다', async () => {
    const target = await seedSpec('SPC-TARGET');
    const source = await seedSpec('SPC-SOURCE');
    const { rows: hash } = await pool.query<{ content_hash: string }>(
      `SELECT encode(content_hash,'hex') AS content_hash FROM spec_version
        WHERE spec_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [target.specId],
    );

    const res = await call('PUT', `/api/v1/projects/clemvion/specs/SPC-SOURCE/draft`, {
      payload: {
        body_markdown: '# 고친 본문',
        base_hash: source.contentHash,
        change_summary: '관계를 선언한다',
        relations: [{ to: 'SPC-TARGET', kind: 'depends_on', base_hash: hash[0]?.content_hash }],
      },
    });
    expect(res.status).toBe(200);

    const { rows } = await pool.query<{ kind: string; to_spec_id: string }>(
      `SELECT kind::text AS kind, to_spec_id FROM spec_relation
        WHERE from_spec_id = $1 AND kind = 'depends_on'`,
      [source.specId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.to_spec_id).toBe(target.specId);
  });

  it('하트비트가 본문을 읽는다 — progress·stats·lease_seconds', async () => {
    const { claimId, sessionId } = await seedActiveClaim();

    const res = await call('POST', `/api/v1/projects/clemvion/claims/${claimId}/heartbeat`, {
      payload: { progress: '3단계 중 2단계', stats: { added: 42, removed: 7, files: 3 } },
    });
    expect(res.status).toBe(201);

    const { rows: claim } = await pool.query<{ progress_note: string | null }>(
      `SELECT progress_note FROM claim WHERE id = $1`,
      [claimId],
    );
    expect(claim[0]?.progress_note).toBe('3단계 중 2단계');

    // 세션 카드의 +N −M — 실사용 34개가 전부 `+0 −0` 이던 그 자리다
    const { rows: session } = await pool.query<{
      diff_added: number;
      diff_removed: number;
      diff_files: number;
    }>(`SELECT diff_added, diff_removed, diff_files FROM agent_session WHERE id = $1`, [sessionId]);
    expect(session[0]?.diff_added).toBe(42);
    expect(session[0]?.diff_removed).toBe(7);
    expect(session[0]?.diff_files).toBe(3);
  });

  /**
   * **인계와 포기는 다른 일이다**(2026-09-05 · REQ-API-107).
   *
   * 예전에는 `done` 외를 전부 `manual` 로 뭉쳐 저장에서 구별되지 않았고, REST 는
   * 그 위에 "셋 중 하나가 아니면 handoff" 라는 **조용한 변환**까지 얹고 있었다.
   */
  it.each([
    ['handoff', 'handoff'],
    ['abandon', 'abandon'],
    ['done', 'done'],
  ])('내려놓기 사유 %s 가 그대로 저장된다', async (sent, stored) => {
    const { claimId } = await seedActiveClaim();
    const res = await call('POST', `/api/v1/projects/clemvion/claims/${claimId}/release`, {
      payload: { reason: sent },
    });
    expect(res.status).toBe(201);
    const { rows } = await pool.query<{ release_reason: string | null }>(
      `SELECT release_reason::text AS release_reason FROM claim WHERE id = $1`,
      [claimId],
    );
    expect(rows[0]?.release_reason).toBe(stored);
  });

  it('모르는 사유는 조용히 바뀌지 않고 거절된다', async () => {
    const { claimId } = await seedActiveClaim();
    const res = await call('POST', `/api/v1/projects/clemvion/claims/${claimId}/release`, {
      payload: { reason: 'giveup' },
    });
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>)['details']).toMatchObject({ field: 'reason' });
    // 클레임은 그대로 살아 있다 — 거절된 요청이 상태를 바꾸면 안 된다
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM claim WHERE id = $1`,
      [claimId],
    );
    expect(rows[0]?.status).toBe('active');
  });

  it('내려놓기가 state_note 를 저장한다 — 다음 사람이 읽을 유일한 문장이다', async () => {
    const { claimId } = await seedActiveClaim();

    const res = await call('POST', `/api/v1/projects/clemvion/claims/${claimId}/release`, {
      payload: { reason: 'handoff', state_note: '검색 필터까지 했고 requirement_id 가 남았다' },
    });
    expect(res.status).toBe(201);

    const { rows } = await pool.query<{ release_note: string | null }>(
      `SELECT release_note FROM claim WHERE id = $1`,
      [claimId],
    );
    expect(rows[0]?.release_note).toBe('검색 필터까지 했고 requirement_id 가 남았다');
  });

  /**
   * **이 요구사항 주변에서 찾아라**(2026-09-05 · REQ-API-110).
   *
   * 전표는 이 인자를 이름만 적고 뜻을 정하지 않아 배선을 미뤘던 자리다.
   */
  it('requirement_id 는 그 요구사항이 속한 스펙으로 좁힌다 — 키와 UUID 둘 다', async () => {
    const mine = await seedSpec('SPC-REQOWN', { title: '요구사항주변' });
    await seedSpec('SPC-OTHER', { title: '요구사항주변' });
    const { rows: ver } = await pool.query<{ id: string }>(
      `SELECT id FROM spec_version WHERE spec_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [mine.specId],
    );
    const reqId = newId();
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-SCOPE-001','WHEN … THE SYSTEM SHALL …','must',$4,$4)`,
      [reqId, projectId, mine.specId, ver[0]?.id],
    );

    const all = await call('GET', '/api/v1/projects/clemvion/specs/search?q=요구사항주변');
    const allKeys = ((all.body as Record<string, unknown>)['items'] as { key: string }[]).map(
      (i) => i.key,
    );
    expect(allKeys).toEqual(expect.arrayContaining(['SPC-REQOWN', 'SPC-OTHER']));

    for (const ref of ['REQ-SCOPE-001', reqId]) {
      const scoped = await call(
        'GET',
        `/api/v1/projects/clemvion/specs/search?q=요구사항주변&requirement_id=${ref}`,
      );
      const keys = ((scoped.body as Record<string, unknown>)['items'] as { key: string }[]).map(
        (i) => i.key,
      );
      expect(keys).toContain('SPC-REQOWN');
      expect(keys).not.toContain('SPC-OTHER');
    }

    // 없는 요구사항은 **빈 결과가 아니라 거절**이다 — 빈 결과는 오타를 사실로 만든다.
    // 409 인 것은 §1.4 의 기준대로다: 없는 참조는 모양이 아니라 **상태**이고,
    // 같은 요청이 그 요구사항이 생긴 뒤에는 성공한다.
    const missing = await call(
      'GET',
      '/api/v1/projects/clemvion/specs/search?q=요구사항주변&requirement_id=REQ-NOPE-999',
    );
    expect(missing.status).toBe(409);
    expect((missing.body as Record<string, unknown>)['details']).toMatchObject({
      kind: 'not_found',
      field: 'requirement_id',
    });

    await pool.query(`DELETE FROM requirement WHERE id = $1`, [reqId]);
  });

  it('증적 종류의 오타는 400 이다 — 22P02 로 죽던 마지막 자리', async () => {
    const spec = await seedSpec('SPC-EV');
    const { rows: ver } = await pool.query<{ id: string }>(
      `SELECT id FROM spec_version WHERE spec_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [spec.specId],
    );
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-EV-001','WHEN … THE SYSTEM SHALL …','must',$4,$4)`,
      [newId(), projectId, spec.specId, ver[0]?.id],
    );

    // EP-REQ-03 은 역할 AND `spec:evidence` 다 — adminToken 에는 그 권한이 없다(§1.3b)
    const ciToken = (
      await app.get(AuthService).issueToken({
        projectId,
        userId: adminId,
        name: 'ci-evidence-vocab',
        scopes: ['spec:evidence'],
      })
    ).token;

    const bad = await call('POST', '/api/v1/projects/clemvion/requirements/REQ-EV-001/evidence', {
      token: ciToken,
      payload: { kind: 'screenshot', locator: 'x' },
    });
    // `db-error.ts` 가 다루는 SQLSTATE 에 22P02 가 없어 진짜 500 으로 나가던 자리다
    expect(bad.status).toBe(400);
    expect((bad.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.PRECONDITION);
    expect((bad.body as Record<string, unknown>)['details']).toMatchObject({ field: 'kind' });

    const ok = await call('POST', '/api/v1/projects/clemvion/requirements/REQ-EV-001/evidence', {
      token: ciToken,
      payload: { kind: 'user_guide', locator: 'docs/manual/ko/specs.md' },
    });
    // 어휘에 있는 여섯 종은 전부 받는다 — 전표가 넷만 적고 있었다(§2.5 EP-REQ-03)
    expect(ok.status).toBeLessThan(300);

    // 이 스위트는 requirement 를 비우지 않는다 — 남기면 커버리지 테스트가 세는 수가 달라진다
    await pool.query(`DELETE FROM evidence WHERE requirement_id IN
                        (SELECT id FROM requirement WHERE ref = 'REQ-EV-001')`);
    await pool.query(`DELETE FROM requirement WHERE ref = 'REQ-EV-001'`);
  });

  it('검색이 type·status 로 좁힌다 — 어휘 밖 값은 거절이지 무시가 아니다', async () => {
    await seedSpec('SPC-FEAT', { type: 'feature', title: '검색어공통' });
    await seedSpec('SPC-ADR', { type: 'adr', title: '검색어공통' });

    const all = await call('GET', '/api/v1/projects/clemvion/specs/search?q=검색어공통');
    const allKeys = ((all.body as Record<string, unknown>)['items'] as { key: string }[]).map(
      (i) => i.key,
    );
    expect(allKeys).toEqual(expect.arrayContaining(['SPC-FEAT', 'SPC-ADR']));

    const only = await call('GET', '/api/v1/projects/clemvion/specs/search?q=검색어공통&type=adr');
    const keys = ((only.body as Record<string, unknown>)['items'] as { key: string }[]).map(
      (i) => i.key,
    );
    expect(keys).toContain('SPC-ADR');
    expect(keys).not.toContain('SPC-FEAT');

    // 조용히 버리면 호출자는 "그 종류가 없다" 고 결론짓는다 — 그것이 이 감사의 주제다
    const bad = await call('GET', '/api/v1/projects/clemvion/specs/search?q=x&status=nope');
    expect(bad.status).toBe(400);
    expect((bad.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.PRECONDITION);
  });
});

/**
 * **사람 전용 라우트가 하나도 빠지지 않았는가**(2026-09-05 · REQ-API-111).
 *
 * 게이트가 표면에만 있던 동안 실제 위험은 "새 표면이 생겼는데 붙이는 것을 잊는다" 였다.
 * 판정을 도메인으로 옮긴 지금도 **넘기는 것을 잊으면** 같은 구멍이 난다 — 그래서 표면
 * 쪽에서 한 번 더 센다: 아래 목록의 라우트는 전부 에이전트 PAT 에 `HUMAN_ONLY` 로 답해야 한다.
 *
 * 목록에 새 줄을 더하는 것은 사람의 일이지만, **있는 줄이 조용히 열리는 것**은 이 검사가 막는다.
 */
describe('사람 전용 라우트는 토큰을 받지 않는다 (REQ-API-111)', () => {
  // 이 스위트는 **자기 상태를 스스로 세운다** — 앞선 검사가 프로젝트를 보관해 두면
  // 가드가 먼저 400 으로 막아 게이트에 닿지도 못한다(그러면 이 검사는 아무것도 세지 않는다).
  // **한 번만 세운다.** 이 스위트의 호출은 전부 게이트에서 막히므로 아무것도 바꾸지
  // 못한다 — 매번 지웠다 만들면 그 정리가 FK 순서를 어겨 검사보다 먼저 실패한다.
  beforeAll(async () => {
    await seedSpec('SPC-HUMAN');
  });

  // 앞선 검사가 프로젝트를 보관해 두면 가드가 먼저 400 으로 막아 게이트에 닿지 못한다.
  beforeEach(async () => {
    await pool.query(`UPDATE project SET archived_at = NULL WHERE id = $1`, [projectId]);
  });

  it.each([
    // 본문 없는 POST 라도 `{}` 를 보낸다 — `call()` 이 content-type 을 늘 붙이므로
    // 빈 본문은 Fastify 가 게이트에 닿기 전에 400 으로 막는다(그러면 아무것도 못 센다).
    ['POST', '/api/v1/projects/clemvion/archive', {}],
    ['POST', '/api/v1/projects/clemvion/restore', {}],
    ['PATCH', '/api/v1/projects/clemvion', { name: '새 이름' }],
    ['POST', '/api/v1/projects/clemvion/specs/SPC-HUMAN/archive', {}],
    ['POST', '/api/v1/projects/clemvion/specs/SPC-HUMAN/restore', {}],
    ['PATCH', '/api/v1/projects/clemvion/specs/SPC-HUMAN', { title: '새 제목' }],
    ['GET', '/api/v1/approvals', undefined],
    // 2026-09-07 — 전표가 사람 전용이라 적어 두고 도메인 판정이 없던 셋(REQ-API-123).
    // 답변은 질문이 없어도 게이트가 먼저 답한다 — 그것이 검사 대상이다.
    ['GET', '/api/v1/projects/clemvion/inbox', undefined],
    ['POST', '/api/v1/projects/clemvion/gates/bypass', { subject_id: newId(), reason: '검사' }],
    ['POST', `/api/v1/projects/clemvion/questions/${newId()}/answer`, { answer_key: 'a' }],
  ] as const)('%s %s 는 에이전트 토큰에 HUMAN_ONLY 로 답한다', async (method, url, payload) => {
    // adminToken 은 PAT 다 — PAT 주체는 에이전트다(사람은 세션 쿠키로 온다)
    const res = await call(method as 'GET' | 'POST' | 'PATCH', url, {
      ...(payload === undefined ? {} : { payload }),
    });
    const body = res.body as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(body['code']).toBe(NERV_ERROR.HUMAN_ONLY);
    // 막기만 하고 길을 안 주면 에이전트는 같은 호출을 재시도한다
    expect((body['details'] as Record<string, unknown>)['action']).toBeDefined();
  });

  /**
   * **어느 문턱이 막았는가.** 답변 라우트의 권한은 `spec:read` 이고 그것은 **모든 PAT 가
   * 가진 값**이라 권한 축은 에이전트를 거르지 못한다 — 2026-09-06 대조가 짚은 자리다.
   * 읽기 권한뿐인 토큰으로 불러 `missing_scope` 가 아니라 `human_only` 가 나오는 것을
   * 본다: 그것이 "판정이 도메인에 있다" 의 증거다(REQ-API-123).
   */
  it('답변은 권한이 아니라 사람 전용 게이트에서 막힌다 — spec:read 만 가진 토큰도', async () => {
    const res = await call('POST', `/api/v1/projects/clemvion/questions/${newId()}/answer`, {
      token: narrowToken,
      payload: { answer_key: 'a' },
    });
    const body = res.body as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(body['code']).toBe(NERV_ERROR.HUMAN_ONLY);
    expect((body['details'] as Record<string, unknown>)['kind']).toBe('human_only');
    expect((body['details'] as Record<string, unknown>)['action']).toBe('inbox_decide');
  });

  /**
   * **기준선은 더 앞에서 막힌다.** `spec:approve` 는 `HUMAN_ONLY_SCOPES` 라 토큰에
   * 부여 자체가 불가능하고(§1.3), 그래서 권한 가드가 사람 전용 게이트보다 먼저 답한다.
   *
   * 그것이 더 강한 보장이라 그대로 둔다 — 다만 **막히는 이유가 다르다는 사실**을 여기
   * 적어 둔다. 적지 않으면 다음 사람이 "왜 이것만 목록에 없나" 를 다시 조사해야 한다.
   */
  it('기준선 생성은 권한 단계에서 막힌다 — 사람 전용 권한은 토큰이 가질 수 없다', async () => {
    const res = await call('POST', '/api/v1/projects/clemvion/baselines', {
      payload: { name: 'r-human' },
    });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>)['code']).toBe(NERV_ERROR.FORBIDDEN);
  });
});

async function seedSpec(
  key: string,
  options: { type?: string; title?: string } = {},
): Promise<{ specId: string; contentHash: string }> {
  const specId = newId();
  const versionId = newId();
  // `content_hash` 는 bytea 다 — 키를 그대로 쓰면 `decode(…,'hex')` 가 'S' 에서 터진다
  const hash = createHash('sha256').update(key).digest('hex');
  await pool.query(`INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,$3,$4,$5)`, [
    specId,
    projectId,
    options.type ?? 'feature',
    key,
    options.title ?? key,
  ]);
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
     VALUES ($1,$2,1,'draft',$3, decode($4,'hex'), $5)`,
    [versionId, specId, `# ${options.title ?? key}`, hash, adminId],
  );
  await pool.query(`UPDATE spec SET current_version_id = $1 WHERE id = $2`, [versionId, specId]);
  return { specId, contentHash: hash };
}

async function seedActiveClaim(): Promise<{ claimId: string; sessionId: string }> {
  const sessionId = newId();
  const taskId = newId();
  const claimId = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                       tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,'작업','in_progress','목표','PR','도구','경계')`,
    [taskId, projectId, `TSK-${taskId.slice(0, 4)}`],
  );
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-07','active')`,
    [sessionId, projectId, adminId],
  );
  await pool.query(
    `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
     VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
    [claimId, projectId, taskId, sessionId, adminId],
  );
  return { claimId, sessionId };
}

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
        // `base_version` 은 2026-08-30 에 표면에서 걷었다 — 이 검사가 그것을 계속
        // 보내고 있었고, 서버는 조용히 버렸다. 스키마가 `.strict()` 로 그것을 짚었다.
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

  // 화면의 영향 미리보기가 이 값을 센다. 서버가 요청받아야 싣는데 REST 가 그 인자를
  // 넘기지 않아, 파생 Task 를 가진 스펙 86개가 전부 "0건" 이라 말하고 있었다(실측 2026-09-03).
  it('EP-SPEC-03 — include=tasks 가 파생 Task 를 싣는다', async () => {
    const plain = await call('GET', '/api/v1/projects/clemvion/specs/SPC-PATHS');
    expect((plain.body as Record<string, unknown>)['tasks']).toBeUndefined();

    const withTasks = await call('GET', '/api/v1/projects/clemvion/specs/SPC-PATHS?include=tasks');
    expect(withTasks.status).toBe(200);
    expect((withTasks.body as Record<string, unknown>)['tasks']).toEqual(expect.any(Array));
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

  it('viewer 는 웹으로 들어와도 메타·아카이브·기준선을 못 건드린다 (역할 매트릭스)', async () => {
    await call('POST', '/api/v1/projects/clemvion/specs', {
      payload: { key: 'SPC-RBAC', title: '권한 시험', type: 'feature', body_markdown: '# 본문' },
    });
    // `assertScope` 는 "세션 사용자는 역할 매트릭스가 판정한다"고 적어 두고 그 매트릭스가
    // 없어 `if (!isAgent) return;` 로 통과시켰다. 웹으로 들어오면 viewer 도 스펙을
    // 아카이브하고 기준선을 동결할 수 있었다(실측 2026-08-23).
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

  it('권한이 있으면 권한 문턱은 넘는다 — 조인 것이 아니라 **가른** 것이다', async () => {
    // 전부 막으면 조인 것이 아니라 부순 것이다. 다만 EP-SPEC-15 는 그 다음 문턱이
    // **사람 전용**이라(requireHuman) PAT 는 어차피 못 지난다 — 그래서 "통과했다"가 아니라
    // "**권한에서 막히지는 않았다**"를 본다. 두 문턱은 다른 것을 지킨다.
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
