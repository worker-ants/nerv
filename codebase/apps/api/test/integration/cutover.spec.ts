// SoT 컷오버 M1 — 게이트 판정이 로컬 판정을 함께 받아 견주고, 2주 관측 지표를 낸다
// (2026-10-16 · 사람 결정 D6 · Phase 2 E21-S03 · api.md REQ-API-345 ~ 349 · database.md REQ-DB-052 · roadmap §7.4 ~ §7.6)
//
// 경계를 실제 Postgres 로 본다 — 서버 판정이 적용된다는 응답 · 일치 / 불일치 · 같은 비교의 재호출(멱등 — 분모가 부풀지 않는다) · 이중화
// 기간이 아닐 때(기록은 하고 알리지 않는다) · 권한(`review:submit` · viewer · 읽기 토큰) · 지표의 경계(1% · 5% · 2%) · 창 · 컷오버 단계를
// 바꾸는 감사.

import { NERV_ERROR, NERV_EVENT, NERV_EVENT_PHASE2, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { DEFAULT_ORIGIN } from '../../src/common/origins.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { CutoverService, cutoverStatus } from '../../src/modules/review/cutover.service.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let orgId: string;
let projectId: string;
/** 개발자 — 플러그인의 에이전트 토큰(권장 묶음)으로 훅이 부른다 */
let devId: string;
let devToken: string;
/** 읽기 권한뿐인 토큰 — CI 가 쓰는 모양 */
let readToken: string;
let viewerToken: string;
let plannerToken: string;
let adminId: string;
let adminCookie: string;
let agentSessionId: string;
/** 이 테스트가 시작한 DB 시각 — 이벤트는 지울 수 없으니(append-only) 이 시각 뒤의 것만 본다 */
let testStart: Date;

const BRANCH = 'feat/login';
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

beforeAll(async () => {
  db = await createScratchDb('nerv_cutover');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  // 이벤트는 월 파티션이다 — 창을 지난달로 걸쳐도 넣을 수 있게 둔다
  await pool.query(`SELECT nerv_ensure_month_partitions((now() - interval '1 month')::date)`);
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const auth = app.get(AuthService);
  devToken = (
    await auth.issueToken({
      projectId,
      userId: devId,
      name: 'hook',
      scopes: ['spec:read', 'review:submit'],
    })
  ).token;
  readToken = (
    await auth.issueToken({ projectId, userId: devId, name: 'ci', scopes: ['spec:read'] })
  ).token;

  // admin — 사람 전용인 프로젝트 설정(EP-PRJ-04)은 세션 쿠키로 부른다
  const email = 'cutover-admin@example.com';
  const password = 'correct-horse-battery';
  await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password, name: '관리자' },
  });
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  });
  const setCookie = signIn.headers['set-cookie'];
  adminCookie =
    (Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '')).split(';')[0] ?? '';
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
    email,
  ]);
  adminId = rows[0]!.id;
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
    [newId(), orgId, projectId, adminId],
  );

  // viewer · planner — 토큰은 역할과 교집합이다
  for (const [role, assign] of [
    ['viewer', (token: string) => (viewerToken = token)],
    ['planner', (token: string) => (plannerToken = token)],
  ] as const) {
    const userId = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [userId, `${role}@example.com`, role],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
      [newId(), orgId, projectId, userId, role],
    );
    assign(
      (
        await auth.issueToken({
          projectId,
          userId,
          name: role,
          scopes: ['spec:read', 'review:submit'],
        })
      ).token,
    );
  }
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM gate_verdict_comparison');
  await pool.query('DELETE FROM finding_occurrence');
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM reviewer_report');
  await pool.query('UPDATE review_session SET previous_session_id = NULL');
  await pool.query('DELETE FROM review_session');
  // 컷오버 단계를 바꾼 시각을 이 테스트의 시작으로 둔다 — 지표의 기본 창이 앞 테스트의 이벤트를 세지 않는다
  const { rows } = await pool.query<{ at: Date }>(
    `UPDATE project SET review_sot = 'dual', review_sot_since = clock_timestamp() WHERE id = $1
     RETURNING review_sot_since AS at`,
    [projectId],
  );
  testStart = rows[0]!.at;
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  devId = newId();
  agentSessionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dev@example.com','도윤','active')`,
    [devId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, devId],
  );
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-02','active')`,
    [agentSessionId, projectId, devId],
  );
}

type CheckBody = {
  items: { kind: string; state: string }[];
  review_sot: string;
  applied: string;
  verdict: string;
  comparison: {
    id: string;
    local: string;
    server: string;
    match: boolean;
    counted: boolean;
    calls: number;
    reported: boolean;
  };
};

const post = (
  payload: Record<string, unknown>,
  token = devToken,
): ReturnType<NestFastifyApplication['inject']> =>
  app.inject({
    method: 'POST',
    url: '/api/v1/projects/clemvion/gates/reviews/check',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload,
  });

const local = (
  verdict: 'pass' | 'block',
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  branch: BRANCH,
  kind: 'code',
  head_sha: HEAD,
  local_state: { verdict, hook: 'pre-push', reason: '강제 리뷰어 셋이 모두 돌았다' },
  ...over,
});

async function check(payload: Record<string, unknown>, token = devToken): Promise<CheckBody> {
  const res = await post(payload, token);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as CheckBody;
}

/** 통과하는 라운드 하나 — 발견이 없는 끝난 리뷰 */
async function passingRound(headSha = HEAD): Promise<void> {
  await app.get(ReviewService).submit({
    projectId,
    userId: devId,
    sessionId: agentSessionId,
    isAgent: true,
    branch: BRANCH,
    baseSha: 'ba5e000',
    headSha,
    kind: 'code',
    changeset: ['src/login.ts'],
    summaryMd: '봤다.',
    reviewer: { role: 'security', risk: 'low' },
    taskId: null,
    findings: [] as never,
  } as Parameters<ReviewService['submit']>[0]);
}

const mismatchEvents = async (): Promise<Record<string, unknown>[]> =>
  (
    await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event WHERE type = $1 AND occurred_at >= $2 ORDER BY occurred_at`,
      [NERV_EVENT_PHASE2.GATE_VERDICT_MISMATCH, testStart],
    )
  ).rows.map((r) => r.payload);

describe('EP-REV-08b — 게이트 판정에 로컬 판정을 함께 보낸다 (REQ-API-345)', () => {
  it('판정은 GET 과 같고, 이중화 기간에는 서버 판정이 적용된다고 응답이 밝힌다', async () => {
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/clemvion/gates/reviews/check?branch=${encodeURIComponent(BRANCH)}&kind=code&head_sha=${HEAD}`,
      headers: { authorization: `Bearer ${readToken}` },
    });
    const body = await check(local('block'));
    expect(body.items).toEqual(JSON.parse(get.body).items);
    expect(body.items[0]).toMatchObject({ kind: 'code', state: 'uncovered' });
    expect(body).toMatchObject({ review_sot: 'dual', applied: 'server', verdict: 'block' });
    // 리뷰가 없으니 서버도 막는다 — 두 판정이 같다
    expect(body.comparison).toMatchObject({
      local: 'block',
      server: 'block',
      match: true,
      counted: true,
      calls: 1,
      reported: false,
    });
    expect(await mismatchEvents()).toEqual([]);
  });

  it('두 판정이 다르면 서버 판정을 적용하고 불일치를 이벤트로 남긴다 — 훅이 적은 이유는 넣지 않는다', async () => {
    const body = await check(local('pass'));
    expect(body).toMatchObject({ applied: 'server', verdict: 'block' });
    expect(body.comparison).toMatchObject({
      local: 'pass',
      server: 'block',
      match: false,
      reported: true,
    });
    const events = await mismatchEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      comparison_id: body.comparison.id,
      branch: BRANCH,
      head_sha: HEAD,
      kinds: ['code'],
      local: { verdict: 'pass', hook: 'pre-push' },
      server: { verdict: 'block', states: [{ kind: 'code', state: 'uncovered' }] },
      review_sot: 'dual',
    });
    expect(JSON.stringify(events[0])).not.toContain('강제 리뷰어');
    // 이유는 비교 표에 남는다 — 사람이 원인을 찾을 때 읽는다
    const { rows } = await pool.query(
      `SELECT local_reason, local_hook, review_sot::text AS sot, actor_user_id FROM gate_verdict_comparison`,
    );
    expect(rows).toEqual([
      {
        local_reason: '강제 리뷰어 셋이 모두 돌았다',
        local_hook: 'pre-push',
        sot: 'dual',
        actor_user_id: devId,
      },
    ]);
  });

  it('서버가 통과시키면 그 판정이 적용된다 — 로컬이 막았어도 응답의 판정은 통과다', async () => {
    await passingRound();
    const body = await check(local('block'));
    expect(body.items[0]).toMatchObject({ kind: 'code', state: 'passed' });
    expect(body).toMatchObject({ applied: 'server', verdict: 'pass' });
    expect(body.comparison).toMatchObject({ server: 'pass', local: 'block', match: false });
  });

  it('같은 비교를 다시 부르면 한 번으로 센다 — 이벤트도 다시 내지 않는다. 로컬 판정 · 커밋이 다르면 새 비교다', async () => {
    const first = await check(local('pass'));
    const again = await check(local('pass', { local_state: { verdict: 'pass' } }));
    expect(again.comparison).toMatchObject({
      id: first.comparison.id,
      counted: false,
      calls: 2,
      reported: false,
    });
    // 대소문자만 다른 커밋은 같은 커밋이다(소문자로 남긴다)
    const third = await check(local('pass', { head_sha: HEAD.toUpperCase() }));
    expect(third.comparison).toMatchObject({ id: first.comparison.id, calls: 3 });
    // 종류를 다르게 적어도(순서 · 공백) 같은 종류 묶음이면 같은 비교다
    await check(local('pass', { kind: 'code, code' }));
    expect(await mismatchEvents()).toHaveLength(1);

    const flipped = await check(local('block'));
    expect(flipped.comparison).toMatchObject({ counted: true, calls: 1 });
    expect(flipped.comparison.id).not.toBe(first.comparison.id);
    const other = await check(local('pass', { head_sha: OTHER }));
    expect(other.comparison).toMatchObject({ counted: true, reported: true });
    const { rows } = await pool.query<{ n: number; calls: number }>(
      `SELECT count(*)::int AS n, sum(repeat_count)::int AS calls FROM gate_verdict_comparison`,
    );
    expect(rows[0]).toEqual({ n: 3, calls: 6 });
  });

  it('이중화 기간이 아니면 비교만 남기고 알리지 않는다 — 컷오버 전에는 로컬 판정이 적용된다', async () => {
    await pool.query(`UPDATE project SET review_sot = 'git' WHERE id = $1`, [projectId]);
    const before = await check(local('pass'));
    expect(before).toMatchObject({ review_sot: 'git', applied: 'local', verdict: 'pass' });
    expect(before.comparison).toMatchObject({ match: false, counted: true, reported: false });

    await pool.query(`UPDATE project SET review_sot = 'nerv' WHERE id = $1`, [projectId]);
    const after = await check(local('pass', { head_sha: OTHER }));
    expect(after).toMatchObject({ review_sot: 'nerv', applied: 'server', verdict: 'block' });
    expect(after.comparison.reported).toBe(false);
    expect(await mismatchEvents()).toEqual([]);
    const { rows } = await pool.query<{ sot: string }>(
      `SELECT review_sot::text AS sot FROM gate_verdict_comparison ORDER BY created_at`,
    );
    expect(rows.map((r) => r.sot)).toEqual(['git', 'nerv']);
  });

  it('권한은 `review:submit` 이다 — 읽기 토큰 · viewer 는 403, GET 은 읽기 토큰으로 그대로 된다', async () => {
    expect((await post(local('pass'), readToken)).statusCode).toBe(403);
    expect((await post(local('pass'), viewerToken)).statusCode).toBe(403);
    expect((await post(local('pass'), plannerToken)).statusCode).toBe(200);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM gate_verdict_comparison`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('입력 — 40자 커밋 · 로컬 판정 · 아는 종류만 받는다(400)', async () => {
    const bad = [
      local('pass', { head_sha: HEAD.slice(0, 12) }),
      local('pass', { head_sha: undefined }),
      local('pass', { local_state: undefined }),
      local('pass', { local_state: { verdict: 'maybe' } }),
      local('pass', { local_state: { verdict: 'pass', reason: 'x'.repeat(501) } }),
      local('pass', { kind: 'nonsense' }),
      local('pass', { branch: '' }),
      { ...local('pass'), extra: 1 },
    ];
    for (const payload of bad) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const short = JSON.parse((await post(local('pass', { head_sha: 'abc1234' }))).body);
    expect(JSON.stringify(short)).toContain('40');
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM gate_verdict_comparison`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('불일치는 admin 에게 보통 알림으로 가고 같은 프로젝트의 불일치는 한 줄로 묶인다', async () => {
    await check(local('pass'));
    await check(local('pass', { head_sha: OTHER }));
    await app.get(NotificationService).route({ since: testStart });
    const { rows } = await pool.query<{ user_id: string; importance: string; batch_key: string }>(
      `SELECT n.user_id, n.importance::text AS importance, n.batch_key
         FROM notification n JOIN event e ON e.id = n.event_id`,
    );
    expect(rows).toEqual([
      {
        user_id: adminId,
        importance: 'digest',
        batch_key: `project:${projectId}:verdict_mismatch`,
      },
    ]);
  });
});

/** 비교 줄을 직접 넣는다 — 지표의 경계를 수로 본다 */
async function comparisons(n: number, mismatches: number, at = 'clock_timestamp()'): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const mismatch = i < mismatches;
    await pool.query(
      `INSERT INTO gate_verdict_comparison
         (id, project_id, branch, kinds, head_sha, local_pass, server_pass, review_sot, actor_user_id, created_at)
       VALUES ($1,$2,$3,'code',$4,true,$5,'dual',$6, ${at})`,
      [newId(), projectId, `b/${i}-${Math.random()}`, HEAD, !mismatch, devId],
    );
  }
}

/** 리뷰 제출 이벤트 · 오프라인 큐의 거절 보고 — 지표가 세는 두 출처 */
async function submissions(accepted: number, failedItems: string[]): Promise<void> {
  for (let i = 0; i < accepted; i += 1) {
    await pool.query(
      `INSERT INTO event (id, project_id, type, subject_type, subject_id, actor_user_id, is_agent, payload, occurred_at)
       VALUES ($1,$2,$3,'review_session',$4,$5,true,'{}'::jsonb, clock_timestamp())`,
      [newId(), projectId, NERV_EVENT_PHASE2.REVIEW_SUBMITTED, newId(), devId],
    );
  }
  if (failedItems.length > 0) {
    await pool.query(
      `INSERT INTO event (id, project_id, type, subject_type, subject_id, actor_user_id, is_agent, payload, occurred_at)
       VALUES ($1,$2,$3,'project',$2,$4,true,$5::jsonb, clock_timestamp())`,
      [
        newId(),
        projectId,
        NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED,
        devId,
        JSON.stringify({
          count: failedItems.length,
          items: failedItems.map((tool, i) => ({ tool, idempotency_key: `k-${i}` })),
        }),
      ],
    );
  }
}

const report = (query = '', token = plannerToken): ReturnType<NestFastifyApplication['inject']> =>
  app.inject({
    method: 'GET',
    url: `/api/v1/projects/clemvion/gates/reviews/cutover${query}`,
    headers: { authorization: `Bearer ${token}` },
  });

interface Metrics {
  review_sot: string;
  status: string;
  reasons: string[];
  window: {
    since: string;
    until: string;
    days: number;
    observation_days: number;
    complete: boolean;
  };
  comparisons: { total: number; mismatches: number; rate: number | null };
  submissions: { accepted: number; failed: number; total: number; rate: number | null };
  thresholds: Record<string, number>;
  recent_mismatches: Record<string, unknown>[];
}

async function metrics(query = ''): Promise<Metrics> {
  const res = await report(query);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Metrics;
}

describe('EP-REV-10 — 컷오버 지표 (REQ-API-348)', () => {
  it('비교가 없으면 `no_data` 이고 창은 컷오버 단계를 바꾼 시각부터다', async () => {
    const body = await metrics();
    expect(body['status']).toBe('no_data');
    expect(body['review_sot']).toBe('dual');
    expect(body['comparisons']).toMatchObject({ total: 0, mismatches: 0, rate: null });
    expect(body['window']).toMatchObject({ observation_days: 14, complete: false, days: 0 });
    expect(Date.parse(body['window']['since'])).toBe(Math.floor(testStart.getTime()));
    expect(body['thresholds']).toEqual({
      stable_below_pct: 1,
      rollback_mismatch_pct: 5,
      rollback_submit_failure_pct: 2,
    });
  });

  it.each([
    // [비교, 불일치, 상태] — 1% 미만이 안정, 정확히 1% 는 아니다 · 5% 부터 롤백
    [100, 0, 'stable'],
    [200, 1, 'stable'],
    [100, 1, 'watch'],
    [100, 4, 'watch'],
    [100, 5, 'rollback'],
  ] as const)('비교 %i 건 · 불일치 %i 건이면 %s', async (n, bad, status) => {
    await comparisons(n, bad);
    const body = await metrics();
    expect(body['status']).toBe(status);
    expect(body['comparisons']).toMatchObject({ total: n, mismatches: bad, rate: bad / n });
    expect(body['reasons']).toEqual(status === 'rollback' ? ['mismatch_rate'] : []);
  });

  it('리뷰 제출 실패율 2% 부터 롤백이다 — 오프라인 큐의 거절 가운데 리뷰 제출만 센다', async () => {
    await comparisons(200, 0);
    // 99 + 1 = 1% — 롤백 아님. 다른 도구의 거절은 세지 않는다
    await submissions(99, ['nerv_review_submit', 'nerv_task_update', 'nerv_evidence_add']);
    let body = await metrics();
    expect(body['submissions']).toEqual({ accepted: 99, failed: 1, total: 100, rate: 0.01 });
    expect(body['status']).toBe('stable');
    // 98 + 2 = 2% — 롤백. 이벤트는 지울 수 없으니 창을 새로 연다(컷오버 단계를 다시 바꾼 것과 같다)
    await pool.query(`UPDATE project SET review_sot_since = clock_timestamp() WHERE id = $1`, [
      projectId,
    ]);
    await comparisons(200, 0);
    await submissions(98, ['nerv_review_submit', 'nerv_review_submit']);
    body = await metrics();
    expect(body['submissions']).toMatchObject({ failed: 2, total: 100, rate: 0.02 });
    expect(body['status']).toBe('rollback');
    expect(body['reasons']).toEqual(['submit_failure_rate']);
  });

  it('창 밖의 비교는 세지 않는다 — 기본 창은 전환 시각부터, `since` · `until` 로 좁힌다', async () => {
    await comparisons(3, 3, `now() - interval '3 days'`);
    await comparisons(100, 0);
    let body = await metrics();
    expect(body['comparisons']).toMatchObject({ total: 100, mismatches: 0 });
    const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
    body = await metrics(`?since=${since}`);
    expect(body['comparisons']).toMatchObject({ total: 103, mismatches: 3 });
    const until = new Date(Date.now() - 2 * 86_400_000).toISOString();
    body = await metrics(`?since=${since}&until=${until}`);
    expect(body['comparisons']).toMatchObject({ total: 3, mismatches: 3 });
    expect(body['status']).toBe('rollback');
    // 바꾼 적이 없으면 최근 14일이다
    await pool.query(`UPDATE project SET review_sot_since = NULL WHERE id = $1`, [projectId]);
    body = await metrics();
    expect(body['comparisons']['total']).toBe(103);
    expect(body['window']).toMatchObject({ days: 14, complete: true });
  });

  it('최근 불일치를 사람 · 이유와 함께 준다', async () => {
    await check(local('pass'));
    const body = await metrics();
    expect(body['recent_mismatches']).toHaveLength(1);
    expect(body['recent_mismatches'][0]).toMatchObject({
      branch: BRANCH,
      head_sha: HEAD,
      kinds: 'code',
      local: 'pass',
      server: 'block',
      hook: 'pre-push',
      reason: '강제 리뷰어 셋이 모두 돌았다',
      by: '도윤',
      calls: 1,
    });
  });

  it('admin · planner 만 읽는다 — developer 는 403 role_required. 창이 틀리면 400', async () => {
    const dev = await report('', devToken);
    expect(dev.statusCode).toBe(403);
    expect(JSON.parse(dev.body).details).toMatchObject({ kind: 'role_required' });
    expect((await report('?since=yesterday')).statusCode).toBe(400);
    const later = new Date(Date.now() + 86_400_000).toISOString();
    expect((await report(`?since=${later}&until=${new Date().toISOString()}`)).statusCode).toBe(
      400,
    );
    // 서비스도 같은 판정이다(D-05)
    await expect(
      app.get(CutoverService).report({ projectId, roles: ['qa'] }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });

  it('상태 함수는 정수로 견준다 — 경계가 흔들리지 않는다', () => {
    expect(
      cutoverStatus({ comparisons: 300, mismatches: 3, submissions: 0, failed: 0 }).status,
    ).toBe('watch');
    expect(
      cutoverStatus({ comparisons: 300, mismatches: 2, submissions: 0, failed: 0 }).status,
    ).toBe('stable');
    expect(cutoverStatus({ comparisons: 20, mismatches: 1, submissions: 50, failed: 1 })).toEqual({
      status: 'rollback',
      reasons: ['mismatch_rate', 'submit_failure_rate'],
    });
    expect(
      cutoverStatus({ comparisons: 0, mismatches: 0, submissions: 50, failed: 1 }).status,
    ).toBe('rollback');
  });
});

describe('EP-PRJ-04 — 컷오버 단계는 admin 이 바꾸고 감사가 전후를 남긴다 (REQ-API-347)', () => {
  const patch = (
    payload: Record<string, unknown>,
    headers: Record<string, string> = { cookie: adminCookie, origin: DEFAULT_ORIGIN },
  ): ReturnType<NestFastifyApplication['inject']> =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/projects/clemvion',
      headers: { ...headers, 'content-type': 'application/json' },
      payload,
    });

  it('바꾸면 시각을 새로 적고 `project.updated` 에 전후를 남긴다 — 같은 값을 다시 보내면 아무것도 바뀌지 않는다', async () => {
    await pool.query(
      `UPDATE project SET review_sot = 'git', review_sot_since = NULL WHERE id = $1`,
      [projectId],
    );
    const res = await patch({ review_sot: 'dual' });
    expect(res.statusCode, res.body).toBe(200);
    const project = JSON.parse(res.body) as Record<string, unknown>;
    expect(project['review_sot']).toBe('dual');
    expect(project['review_sot_since']).not.toBeNull();
    const { rows: events } = await pool.query<{ payload: Record<string, unknown>; actor: string }>(
      `SELECT payload, actor_user_id AS actor FROM event
        WHERE type = $1 AND occurred_at >= $2 ORDER BY occurred_at`,
      [NERV_EVENT.PROJECT_UPDATED, testStart],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      payload: { fields: ['review_sot'], review_sot: { from: 'git', to: 'dual' } },
      actor: adminId,
    });

    const since = project['review_sot_since'];
    const again = JSON.parse((await patch({ review_sot: 'dual' })).body) as Record<string, unknown>;
    expect(again['review_sot_since']).toEqual(since);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event WHERE type = $1 AND occurred_at >= $2`,
      [NERV_EVENT.PROJECT_UPDATED, testStart],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('어휘 밖은 400 · admin 아닌 역할의 토큰은 403', async () => {
    expect((await patch({ review_sot: 'half' })).statusCode).toBe(400);
    const res = await patch({ review_sot: 'nerv' }, { authorization: `Bearer ${plannerToken}` });
    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query<{ sot: string }>(
      `SELECT review_sot::text AS sot FROM project WHERE id = $1`,
      [projectId],
    );
    expect(rows[0]!.sot).toBe('dual');
  });
});
