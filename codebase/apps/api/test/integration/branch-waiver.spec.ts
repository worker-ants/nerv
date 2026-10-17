// 리뷰가 없는 브랜치의 면제 — 결재에 브랜치를 적을 자리
// (2026-10-16 · 사람 결정 D4 · Phase 2 E16-S04 · api.md REQ-API-339 ~ 341 · database.md REQ-DB-050)
//
// 문서만 바꾼 브랜치처럼 리뷰를 받지 않을 브랜치는 게이트 판정(EP-REV-08)이 `uncovered` 로 막았고, 면제는 리뷰 세션이나 작업에만
// 붙어 그 브랜치를 넘길 길이 없었다. 면제가 브랜치를 받고, 게이트 판정이 리뷰가 없는 (브랜치 · 종류)를 `waived` 로 통과시키며,
// 게이트 현황(EP-REV-04)이 그 브랜치 줄을 만든다. 경계를 실제 Postgres 로 본다 — 커밋 한정 · 다른 커밋 · 리뷰가 있는 종류 ·
// 역할 · 입력 검증 · 게이트 현황 줄.
//
// 면제 끝내기(2026-10-17 · 사람 결정 · api.md REQ-API-357 · database.md REQ-DB-055)도 여기서 본다 — 끝낸 면제는 그 뒤의 판정이
// 세지 않고, 결재 행은 끝낸 기록과 함께 남으며, 낸 사람이나 admin 만 끝낸다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { DEFAULT_ORIGIN } from '../../src/common/origins.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let userId: string;
let agentSessionId: string;
let token: string;
let cookie: string;
let humanId: string;

const BRANCH = 'docs/readme';
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER = 'ffffffffffffffffffffffffffffffffffffffff';

beforeAll(async () => {
  db = await createScratchDb('nerv_branch_waiver');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // CI 가 쓰는 모양 — 읽기 권한뿐인 토큰
  token = (
    await app.get(AuthService).issueToken({ projectId, userId, name: 'ci', scopes: ['spec:read'] })
  ).token;

  // 면제는 사람 전용이다 — REST 는 세션 쿠키로 부른다
  const email = 'branch-waiver@example.com';
  const password = 'correct-horse-battery';
  await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password, name: '도현' },
  });
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  });
  const setCookie = signIn.headers['set-cookie'];
  cookie =
    (Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '')).split(';')[0] ?? '';
  const { rows } = await pool.query<{ id: string; org: string }>(
    `SELECT u.id, (SELECT org_id FROM project WHERE id = $2) AS org FROM "user" u WHERE u.email = $1`,
    [email, projectId],
  );
  humanId = rows[0]!.id;
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), rows[0]!.org, projectId, humanId],
  );
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM resolution');
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM evidence');
  await pool.query('UPDATE review_session SET task_id = NULL');
  await pool.query('DELETE FROM task');
  await pool.query(`UPDATE project SET gate_policy = '{}'::jsonb`);
  await pool.query('DELETE FROM finding_occurrence');
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM reviewer_report');
  await pool.query('UPDATE review_session SET previous_session_id = NULL');
  await pool.query('DELETE FROM review_session');
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  agentSessionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'qa@example.com','규아','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'qa')`,
    [newId(), orgId, projectId, userId],
  );
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-02','active')`,
    [agentSessionId, projectId, userId],
  );
}

/** 서비스로 면제를 낸다 — 역할은 호출이 정한다(REST 는 멤버십에서 읽는다) */
const waive = (
  over: {
    branch?: string;
    headSha?: string;
    kinds?: string[];
    roles?: string[];
    isAgent?: boolean;
    reason?: string;
  } = {},
): Promise<unknown> =>
  app
    .get(ApprovalService)
    .bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: projectId,
      userId,
      reason: over.reason ?? 'README 만 고친 브랜치다',
      actor: { userId, isAgent: over.isAgent === true },
      ...(over.kinds === undefined ? {} : { kinds: over.kinds }),
      branch: over.branch ?? BRANCH,
      ...(over.headSha === undefined ? {} : { headSha: over.headSha }),
      roles: over.roles ?? ['admin'],
    })
    .catch((e: unknown) => e);

type Item = {
  kind: string;
  state: string;
  head_sha: string | null;
  waiver?: {
    approval_id: string;
    reason: string;
    by: string | null;
    at: string;
    kinds: string[] | null;
    head_sha: string | null;
  };
};

async function check(query: string): Promise<Item[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/clemvion/gates/reviews/check?branch=${encodeURIComponent(BRANCH)}${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return (JSON.parse(res.body) as { items: Item[] }).items;
}

const stateOf = (items: Item[], kind: string): string | undefined =>
  items.find((i) => i.kind === kind)?.state;

async function submit(over: {
  kind?: 'code' | 'consistency';
  headSha?: string;
  branch?: string;
  findings?: Record<string, unknown>[];
}): Promise<void> {
  await app.get(ReviewService).submit({
    projectId,
    userId,
    sessionId: agentSessionId,
    isAgent: true,
    branch: over.branch ?? BRANCH,
    baseSha: 'ba5e000',
    headSha: over.headSha ?? HEAD,
    kind: over.kind ?? 'code',
    changeset: ['README.md'],
    summaryMd: '봤다.',
    reviewer: { role: 'security', risk: 'medium' },
    taskId: null,
    findings: (over.findings ?? []) as never,
  } as Parameters<ReviewService['submit']>[0]);
}

describe('EP-REV-08 — 리뷰가 없는 (브랜치 · 종류)는 브랜치 면제로 `waived` (REQ-API-340)', () => {
  it('면제한 종류만 통과하고 사유 · 면제한 사람 · 시각 · 범위를 함께 준다', async () => {
    const res = (await waive({ kinds: ['code'], roles: ['developer'] })) as Record<string, unknown>;
    expect(res).toMatchObject({ branch: BRANCH, head_sha: null, kinds: ['code'] });

    const items = await check('&kind=code,consistency');
    expect(stateOf(items, 'code')).toBe('waived');
    // 면제하지 않은 종류는 그대로 막는다
    expect(stateOf(items, 'consistency')).toBe('uncovered');
    const code = items.find((i) => i.kind === 'code')!;
    expect(code.waiver).toMatchObject({
      approval_id: res['approval_id'],
      reason: 'README 만 고친 브랜치다',
      by: '규아',
      kinds: ['code'],
      head_sha: null,
    });
    expect(Number.isNaN(Date.parse(code.waiver!.at))).toBe(false);
    // 다른 브랜치에는 적용되지 않는다
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/gates/reviews/check?branch=feat%2Fother&kind=code',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(other.body).items[0]).toMatchObject({ kind: 'code', state: 'uncovered' });
  });

  it('커밋을 적지 않은 면제는 그 브랜치의 모든 커밋에 유효하다 — 새 커밋이 와도 남는다', async () => {
    await waive({ kinds: ['code'], roles: ['developer'] });
    expect(stateOf(await check(`&kind=code&head_sha=${HEAD}`), 'code')).toBe('waived');
    expect(stateOf(await check(`&kind=code&head_sha=${OTHER}`), 'code')).toBe('waived');
    expect(stateOf(await check('&kind=code'), 'code')).toBe('waived');
  });

  it('커밋 하나로 좁힌 면제는 그 커밋을 물었을 때만 — 다른 커밋 · 커밋을 묻지 않은 조회는 막는다', async () => {
    await waive({ kinds: ['code'], roles: ['developer'], headSha: HEAD });
    expect(stateOf(await check(`&kind=code&head_sha=${HEAD}`), 'code')).toBe('waived');
    // 대소문자 · 짧은 SHA 도 같은 커밋이다(done 게이트와 같은 규칙)
    expect(
      stateOf(await check(`&kind=code&head_sha=${HEAD.slice(0, 7).toUpperCase()}`), 'code'),
    ).toBe('waived');
    expect(stateOf(await check(`&kind=code&head_sha=${OTHER}`), 'code')).toBe('uncovered');
    expect(stateOf(await check('&kind=code'), 'code')).toBe('uncovered');
  });

  it('리뷰가 있는 종류는 그 판정이 그대로다 — 면제는 `uncovered` 만 넘긴다', async () => {
    await waive({ kinds: ['code', 'consistency'], roles: ['admin'] });
    await submit({
      kind: 'code',
      findings: [
        {
          severity: 'warning',
          title: '링크가 깨졌다',
          body_md: '본문',
          file: 'README.md',
          line: 1,
          category: 'docs',
        },
      ],
    });
    const items = await check('&kind=code,consistency');
    expect(stateOf(items, 'code')).toBe('pending');
    expect(items.find((i) => i.kind === 'code')!.waiver).toBeUndefined();
    expect(stateOf(items, 'consistency')).toBe('waived');
  });

  it('범위 없는 면제(admin)는 모든 종류를 넘기고, 종류를 주지 않은 조회의 정책 종류도 넘긴다', async () => {
    await pool.query(
      `UPDATE project SET gate_policy = '{"done_gate": {"review_coverage": ["code", "consistency"]}}'::jsonb`,
    );
    const res = (await waive({ roles: ['admin'] })) as Record<string, unknown>;
    expect(res['kinds']).toBeUndefined();
    const items = await check('');
    expect(items.map((i) => [i.kind, i.state])).toEqual([
      ['code', 'waived'],
      ['consistency', 'waived'],
    ]);
    expect(items[0]!.waiver?.kinds).toBeNull();
  });

  it('가장 최근 면제를 준다', async () => {
    await waive({ kinds: ['code'], roles: ['developer'], reason: '첫 사유' });
    await waive({ kinds: ['code'], roles: ['developer'], reason: '나중 사유' });
    const code = (await check('&kind=code')).find((i) => i.kind === 'code')!;
    expect(code.waiver?.reason).toBe('나중 사유');
  });
});

describe('EP-APR-04 — 브랜치 면제의 역할 · 기록 (REQ-API-339)', () => {
  it('종류 · 역할 규칙은 작업 면제와 같다 — 못 하는 종류가 하나라도 있으면 아무것도 기록하지 않는다', async () => {
    expect(await waive({ kinds: ['code'], roles: ['planner'] })).toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'bypass_kind_forbidden', kinds: ['code'] },
    });
    expect(await waive({ kinds: ['consistency', 'code'], roles: ['planner'] })).toMatchObject({
      details: { kind: 'bypass_kind_forbidden', kinds: ['code'] },
    });
    expect(await waive({ roles: ['qa'] })).toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'bypass_unscoped_forbidden' },
    });
    expect(await waive({ kinds: ['code'], roles: ['admin'], isAgent: true })).toMatchObject({
      code: NERV_ERROR.HUMAN_ONLY,
    });
    expect((await pool.query(`SELECT count(*)::int AS n FROM approval`)).rows[0].n).toBe(0);
  });

  it('종류 없이 낸 developer 의 면제는 코드 계열로 풀어 읽고 그 사실을 남긴다', async () => {
    expect(await waive({ roles: ['developer'] })).toMatchObject({
      kinds: ['code', 'merge'],
      expanded: true,
      branch: BRANCH,
    });
    const items = await check('&kind=code,merge,consistency');
    expect(items.map((i) => [i.kind, i.state])).toEqual([
      ['code', 'waived'],
      ['consistency', 'uncovered'],
      ['merge', 'waived'],
    ]);
  });

  it('결재 행은 대상 칸에 프로젝트를, 제 열에 브랜치 · 커밋을 두고 `gate.bypassed` 에 브랜치를 넣는다', async () => {
    const res = (await waive({ kinds: ['code'], roles: ['developer'], headSha: HEAD })) as Record<
      string,
      unknown
    >;
    const { rows } = await pool.query(
      `SELECT subject_type::text AS subject_type, subject_id, branch, head_sha,
              bypass_kinds::text[] AS kinds, decided_by_user_id, decision::text AS decision
         FROM approval WHERE id = $1`,
      [res['approval_id']],
    );
    expect(rows[0]).toMatchObject({
      subject_type: 'gate_bypass',
      subject_id: projectId,
      branch: BRANCH,
      head_sha: HEAD,
      kinds: ['code'],
      decided_by_user_id: userId,
      decision: 'approve',
    });
    const { rows: ev } = await pool.query(
      `SELECT payload FROM event WHERE type = 'gate.bypassed' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(ev[0].payload).toMatchObject({ branch: BRANCH, head_sha: HEAD, kinds: ['code'] });
  });

  it('브랜치 면제는 작업의 done 게이트에 영향이 없다 — 대상 칸이 작업이 아니다', async () => {
    await pool.query(
      `UPDATE project SET gate_policy = '{"done_gate": {"review_coverage": ["code"]}}'::jsonb`,
    );
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,'CLV-T-BRWV01','작업','in_progress','목표','리뷰 레코드','도구','경계')`,
      [taskId, projectId],
    );
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'review','r','agent')`,
      [newId(), projectId, taskId],
    );
    await waive({ roles: ['admin'] });
    const refused = await app
      .get(TaskService)
      .transition({
        projectId,
        taskId,
        status: 'done',
        userId,
        roles: ['planner'],
        specImpact: { none: true },
      })
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({ details: { uncovered_kinds: ['code'] } });
    const detail = await app.get(TaskService).get({ projectId, taskKey: 'CLV-T-BRWV01' });
    expect(detail['review_waivers']).toEqual([]);
  });

  describe('REST — 사람의 세션으로', () => {
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/projects/clemvion/gates/bypass',
        headers: { cookie, origin: DEFAULT_ORIGIN, 'content-type': 'application/json' },
        payload,
      });

    it('브랜치와 선택 커밋을 받고, 커밋은 소문자로 남긴다 — 역할은 멤버십에서 읽는다', async () => {
      const ok = await post({
        branch: BRANCH,
        head_sha: HEAD.toUpperCase(),
        kinds: ['code'],
        reason: 'README 만',
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ branch: BRANCH, head_sha: HEAD, kinds: ['code'] });
      const byDev = await post({ branch: BRANCH, kinds: ['consistency'], reason: '스펙 없음' });
      expect(byDev.statusCode).toBe(403);
      expect(byDev.json()).toMatchObject({ details: { kind: 'bypass_kind_forbidden' } });
      const { rows } = await pool.query(`SELECT decided_by_user_id FROM approval`);
      expect(rows).toEqual([{ decided_by_user_id: humanId }]);
    });

    it('대상은 하나다 · 커밋은 브랜치 면제에만 · 40자 커밋 SHA 만 — 어기면 400 이고 아무것도 기록하지 않는다', async () => {
      const both = await post({
        branch: BRANCH,
        subject_id: newId(),
        kinds: ['code'],
        reason: 'x',
      });
      expect(both.statusCode).toBe(400);
      const none = await post({ kinds: ['code'], reason: 'x' });
      expect(none.statusCode).toBe(400);
      const headOnly = await post({
        subject_id: newId(),
        head_sha: HEAD,
        kinds: ['code'],
        reason: 'x',
      });
      expect(headOnly.statusCode).toBe(400);
      const short = await post({
        branch: BRANCH,
        head_sha: 'a1b2c3d',
        kinds: ['code'],
        reason: 'x',
      });
      expect(short.statusCode).toBe(400);
      expect(short.json()).toMatchObject({
        message: expect.stringContaining('40'),
      });
      const blank = await post({ branch: '   ', kinds: ['code'], reason: 'x' });
      expect(blank.statusCode).toBe(400);
      expect((await pool.query(`SELECT count(*)::int AS n FROM approval`)).rows[0].n).toBe(0);
    });
  });
});

describe('EP-REV-04 게이트 현황 — 면제한 브랜치의 줄 (REQ-API-341)', () => {
  async function coverage(): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/gates/reviews',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as { items: Record<string, unknown>[]; total: number };
  }

  it('리뷰가 없는 브랜치도 면제가 있으면 `uncovered` 줄이 되고 면제가 범위와 함께 펼쳐진다', async () => {
    await submit({ branch: 'feat/widget', kind: 'code' });
    await waive({ kinds: ['code'], roles: ['developer'], headSha: HEAD });
    const board = await coverage();
    expect(board.total).toBe(2);
    const row = board.items.find((r) => r['branch'] === BRANCH)!;
    expect(row).toMatchObject({
      verdict: 'uncovered',
      head_sha: null,
      round_no: null,
      total: 0,
      resolved: 0,
    });
    expect(row['bypasses']).toEqual([
      expect.objectContaining({
        bypass_reason: 'README 만 고친 브랜치다',
        display_name: '규아',
        kinds: ['code'],
        head_sha: HEAD,
      }),
    ]);
    // 리뷰가 있는 브랜치 줄은 그대로다
    expect(board.items.find((r) => r['branch'] === 'feat/widget')).toMatchObject({
      verdict: 'passed',
      bypasses: [],
    });
  });

  it('리뷰가 있는 브랜치에 낸 브랜치 면제는 그 줄에 붙는다 — 줄을 둘로 만들지 않는다', async () => {
    await submit({ branch: BRANCH, kind: 'code' });
    await waive({ kinds: ['consistency'], roles: ['admin'] });
    const board = await coverage();
    expect(board.total).toBe(1);
    expect(board.items).toHaveLength(1);
    expect(board.items[0]).toMatchObject({ branch: BRANCH, verdict: 'passed' });
    expect(board.items[0]!['bypasses']).toEqual([
      expect.objectContaining({ kinds: ['consistency'], head_sha: null }),
    ]);
  });

  it('리뷰 세션을 면제한 예전 결재도 그대로 그 브랜치 줄에 붙는다', async () => {
    await submit({ branch: 'feat/legacy', kind: 'code' });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM review_session WHERE branch = 'feat/legacy'`,
    );
    await app.get(ApprovalService).bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: rows[0]!.id,
      userId,
      reason: '핫픽스 배포 — 사후 리뷰 예약',
      actor: { userId, isAgent: false },
      roles: ['admin'],
    });
    const board = await coverage();
    expect(board.items.find((r) => r['branch'] === 'feat/legacy')!['bypasses']).toEqual([
      expect.objectContaining({ bypass_reason: '핫픽스 배포 — 사후 리뷰 예약', kinds: null }),
    ]);
  });
});

describe('EP-APR-09 — 면제 끝내기 (REQ-API-357 · REQ-DB-055)', () => {
  /** 서비스로 면제를 끝낸다 — 기본은 그 면제를 낸 사람(규아 · developer)이다 */
  const revoke = (
    approvalId: string,
    over: { by?: string; roles?: string[]; isAgent?: boolean; reason?: string } = {},
  ): Promise<unknown> =>
    app
      .get(ApprovalService)
      .revokeBypass({
        projectId,
        approvalId,
        userId: over.by ?? userId,
        reason: over.reason ?? '리뷰를 받기로 했다',
        actor: { userId: over.by ?? userId, isAgent: over.isAgent === true },
        roles: over.roles ?? ['developer'],
      })
      .catch((e: unknown) => e);
  const idOf = (res: unknown): string => String((res as Record<string, unknown>)['approval_id']);

  beforeEach(async () => {
    await pool.query('DELETE FROM notification_batch_event');
    await pool.query('DELETE FROM notification');
  });

  it('끝낸 면제는 그 뒤의 게이트 판정이 세지 않는다 — 결재 행은 남고 끝낸 사람 · 시각 · 사유가 붙는다', async () => {
    const id = idOf(await waive({ kinds: ['code'], roles: ['developer'] }));
    expect(stateOf(await check('&kind=code'), 'code')).toBe('waived');

    const res = (await revoke(id)) as Record<string, unknown>;
    expect(res).toMatchObject({
      approval_id: id,
      revoked_by_user_id: userId,
      revoke_reason: '리뷰를 받기로 했다',
      branch: BRANCH,
      head_sha: null,
      kinds: ['code'],
      task_key: null,
    });
    expect(res['unchanged']).toBeUndefined();
    expect(Number.isNaN(Date.parse(String(res['revoked_at'])))).toBe(false);
    expect(stateOf(await check('&kind=code'), 'code')).toBe('uncovered');

    // 지우지 않는다 — 면제의 기록은 그대로이고 끝낸 기록이 더해진다
    const { rows } = await pool.query(
      `SELECT is_bypass, decision::text AS decision, bypass_reason, revoked_by_user_id, revoke_reason,
              revoked_at IS NOT NULL AS revoked
         FROM approval WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      is_bypass: true,
      decision: 'approve',
      bypass_reason: 'README 만 고친 브랜치다',
      revoked_by_user_id: userId,
      revoke_reason: '리뷰를 받기로 했다',
      revoked: true,
    });
    const { rows: ev } = await pool.query(
      `SELECT subject_type, subject_id, payload FROM event
        WHERE type = 'gate.bypass_revoked' AND subject_id = $1`,
      [id],
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ subject_type: 'approval', subject_id: id });
    expect(ev[0].payload).toMatchObject({
      reason: '리뷰를 받기로 했다',
      branch: BRANCH,
      head_sha: null,
      kinds: ['code'],
      waiver_by_user_id: userId,
      // 스스로 끝냈다 — 알릴 사람이 없다
      notify_user_ids: [],
    });
  });

  it('다른 면제가 남아 있으면 그것이 판정을 넘긴다 — 끝낸 것만 빠진다', async () => {
    await waive({ kinds: ['code'], roles: ['developer'], reason: '첫 사유' });
    const later = idOf(await waive({ kinds: ['code'], roles: ['developer'], reason: '나중 사유' }));
    await revoke(later);
    const code = (await check('&kind=code')).find((i) => i.kind === 'code')!;
    expect(code.state).toBe('waived');
    expect(code.waiver?.reason).toBe('첫 사유');
  });

  it('낸 사람이나 admin 만 끝낸다 — admin 이 끝내면 낸 사람에게 high 알림이 간다', async () => {
    const id = idOf(await waive({ kinds: ['code'], roles: ['developer'] }));
    for (const roles of [['developer'], ['planner']]) {
      expect(await revoke(id, { by: humanId, roles })).toMatchObject({
        code: NERV_ERROR.FORBIDDEN,
        details: { kind: 'revoke_forbidden', approval_id: id },
      });
    }
    // 낸 사람도 면제를 낼 수 있는 역할을 잃었으면 끝내지 못한다
    expect(await revoke(id, { roles: ['qa'] })).toMatchObject({
      details: { kind: 'revoke_forbidden' },
    });
    expect(
      (await pool.query(`SELECT revoked_at FROM approval WHERE id = $1`, [id])).rows[0].revoked_at,
    ).toBeNull();

    expect(await revoke(id, { by: humanId, roles: ['admin'] })).toMatchObject({
      revoked_by_user_id: humanId,
    });
    const { rows: ev } = await pool.query(
      `SELECT payload FROM event WHERE type = 'gate.bypass_revoked' AND subject_id = $1`,
      [id],
    );
    expect(ev[0].payload).toMatchObject({ waiver_by_user_id: userId, notify_user_ids: [userId] });
    await new NotificationService(drizzle(pool)).route();
    const { rows: got } = await pool.query(
      `SELECT n.user_id, n.importance::text AS importance FROM notification n
         JOIN event e ON e.id = n.event_id
        WHERE e.type = 'gate.bypass_revoked' AND e.subject_id = $1`,
      [id],
    );
    // high 등급은 바로 오는 알림(`immediate`)이다 — 요약에 묶이지 않는다
    expect(got).toEqual([{ user_id: userId, importance: 'immediate' }]);
  });

  it('스스로 끝내면 아무에게도 알리지 않는다', async () => {
    const id = idOf(await waive({ kinds: ['code'], roles: ['developer'] }));
    await revoke(id);
    await new NotificationService(drizzle(pool)).route();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM notification n
         JOIN event e ON e.id = n.event_id
        WHERE e.type = 'gate.bypass_revoked' AND e.subject_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(0);
  });

  it('사유가 필요하고 에이전트는 끝내지 못한다 — 없는 면제 · 면제가 아닌 결재는 not_found 다', async () => {
    const id = idOf(await waive({ kinds: ['code'], roles: ['developer'] }));
    expect(await revoke(id, { reason: '   ' })).toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'revoke_reason_required' },
    });
    expect(await revoke(id, { isAgent: true })).toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });
    expect(await revoke('not-a-uuid')).toMatchObject({ details: { kind: 'not_found' } });
    expect(await revoke(newId())).toMatchObject({ details: { kind: 'not_found' } });
    const plan = newId();
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id)
       VALUES ($1,$2,'plan',$3,$4)`,
      [plan, projectId, newId(), userId],
    );
    expect(await revoke(plan, { roles: ['admin'] })).toMatchObject({
      details: { kind: 'not_found' },
    });
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM approval WHERE revoked_at IS NOT NULL`))
        .rows[0].n,
    ).toBe(0);
  });

  it('이미 끝낸 면제는 처음 기록을 덮지 않는다 — `unchanged` 이고 이벤트를 다시 내지 않는다', async () => {
    const id = idOf(await waive({ kinds: ['code'], roles: ['developer'] }));
    const first = (await revoke(id, { reason: '처음 사유' })) as Record<string, unknown>;
    const again = (await revoke(id, {
      by: humanId,
      roles: ['admin'],
      reason: '다른 사유',
    })) as Record<string, unknown>;
    expect(again).toMatchObject({
      unchanged: true,
      revoked_by_user_id: userId,
      revoke_reason: '처음 사유',
      revoked_at: first['revoked_at'],
    });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM event WHERE type = 'gate.bypass_revoked' AND subject_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('게이트 현황은 끝낸 면제를 끝낸 기록과 함께 그 줄에 남긴다 — 낸 사람 id 도 준다', async () => {
    const id = idOf(await waive({ kinds: ['code'], roles: ['developer'] }));
    await revoke(id);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/gates/reviews',
      headers: { authorization: `Bearer ${token}` },
    });
    const row = (JSON.parse(res.body) as { items: Record<string, unknown>[] }).items.find(
      (r) => r['branch'] === BRANCH,
    )!;
    expect(row['bypasses']).toEqual([
      expect.objectContaining({
        id,
        by_user_id: userId,
        revoked_by_name: '규아',
        revoke_reason: '리뷰를 받기로 했다',
        revoked_at: expect.any(String),
      }),
    ]);
  });

  it('REST — 사람의 세션으로 끝내고 200 을 준다 · 사유가 없으면 400 · 토큰은 막는다', async () => {
    const made = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/clemvion/gates/bypass',
      headers: { cookie, origin: DEFAULT_ORIGIN, 'content-type': 'application/json' },
      payload: { branch: BRANCH, kinds: ['code'], reason: 'README 만' },
    });
    expect(made.statusCode).toBe(201);
    const id = String(made.json()['approval_id']);
    const url = `/api/v1/projects/clemvion/gates/bypass/${id}/revoke`;
    const blank = await app.inject({
      method: 'POST',
      url,
      headers: { cookie, origin: DEFAULT_ORIGIN, 'content-type': 'application/json' },
      payload: {},
    });
    expect(blank.statusCode).toBe(400);
    const byToken = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { reason: '토큰으로' },
    });
    expect(byToken.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url,
      headers: { cookie, origin: DEFAULT_ORIGIN, 'content-type': 'application/json' },
      payload: { reason: '리뷰를 받는다' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ approval_id: id, revoked_by_user_id: humanId });
    expect(stateOf(await check('&kind=code'), 'code')).toBe('uncovered');
  });
});
