// EP-REV-08 게이트 판정 — 브랜치 · 종류 · head_sha 로 좁힌 라운드가 통과했는가
// (2026-09-28 · clemvion 요청 N1 · 사람 결정 D1 · D2 · REQ-API-247)
//
// push 훅과 CI 가 이 조회로 **막는다.** 그래서 판정의 경계를 실제 Postgres 로 본다: 종류가 섞인 브랜치 · 커밋으로
// 좁히기 · 리뷰 없는 종류 · 열린 warning · 아직 도는 세션 · 한 커밋을 여러 세션이 나눠 본 라운드.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import type { SubmitResult } from '../../src/modules/review/review.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let reviews: ReviewService;
let projectId: string;
let userId: string;
let agentSessionId: string;
let token: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_review_gate');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  reviews = app.get(ReviewService);
  // 읽기 범위만 가진 토큰 — CI 가 쓰는 모양이다
  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId,
      name: 'ci',
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

const BRANCH = 'feat/chat-widget';

async function submit(over: {
  kind?: 'code' | 'consistency';
  headSha?: string;
  branch?: string;
  changeset?: string[];
  findings?: Record<string, unknown>[];
  taskId?: string;
}): Promise<SubmitResult> {
  return reviews.submit({
    projectId,
    userId,
    sessionId: agentSessionId,
    isAgent: true,
    branch: over.branch ?? BRANCH,
    baseSha: 'base000',
    headSha: over.headSha ?? 'head001',
    kind: over.kind ?? 'code',
    changeset: over.changeset ?? ['src/widget.ts'],
    summaryMd: '봤다.',
    reviewer: { role: 'security', risk: 'medium' },
    taskId: over.taskId ?? null,
    findings: (over.findings ?? []) as never,
  } as Parameters<ReviewService['submit']>[0]);
}

const finding = (severity: string, title: string): Record<string, unknown> => ({
  severity,
  title,
  body_md: `${title} — 본문`,
  file: 'src/widget.ts',
  line: 1,
  category: 'security',
});

type Item = {
  kind: string;
  state: string;
  round_no: number | null;
  head_sha: string | null;
  completed_at: string | null;
  reasons: string[];
  open: { critical: number; warning: number; info: number };
  findings: {
    id: string;
    severity: string;
    status: string;
    resolution: { kind: string; commit_sha: string | null } | null;
  }[];
  findings_total: number;
};

async function check(query: string): Promise<{ status: number; items: Item[]; body: unknown }> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/clemvion/gates/reviews/check?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
  const body = JSON.parse(res.body) as { items?: Item[] };
  return { status: res.statusCode, items: body.items ?? [], body };
}

const q = (extra = ''): string => `branch=${encodeURIComponent(BRANCH)}${extra}`;

describe('EP-REV-08 게이트 판정 (REQ-API-247)', () => {
  it('종류가 섞인 브랜치는 종류마다 따로 나온다 — code 의 열린 critical 이 consistency 를 막지 않는다', async () => {
    await submit({ kind: 'code', findings: [finding('critical', '토큰이 로그에 남는다')] });
    await submit({ kind: 'consistency', changeset: ['spec/a.md'] });

    const res = await check(q());
    expect(res.status).toBe(200);
    expect(res.items.map((i) => [i.kind, i.state])).toEqual([
      ['code', 'pending'],
      ['consistency', 'passed'],
    ]);
    const code = res.items[0]!;
    expect(code.reasons).toEqual(['open_critical']);
    expect(code.open).toEqual({ critical: 1, warning: 0, info: 0 });
    expect(code.round_no).toBe(1);
    expect(code.head_sha).toBe('head001');

    const onlyCode = await check(q('&kind=code'));
    expect(onlyCode.items.map((i) => i.kind)).toEqual(['code']);
  });

  it('열린 warning 도 막는다(D2) — 고친 커밋을 남기면 통과하고, info 는 수만 준다', async () => {
    const out = await submit({
      findings: [finding('warning', '재시도에 상한이 없다'), finding('info', '이름이 길다')],
    });
    const blocked = (await check(q())).items[0]!;
    expect(blocked.state).toBe('pending');
    expect(blocked.reasons).toEqual(['open_warning']);

    const warningId = blocked.findings.find((f) => f.severity === 'warning')!.id;
    expect(out.findings_new).toContain(warningId);
    await reviews.resolve({
      projectId,
      findingId: warningId,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'fixed',
      status: 'fixed',
      rationale: '상한 3회를 두었다',
      commitSha: 'c0ffee1',
    });

    const passed = (await check(q())).items[0]!;
    expect(passed.state).toBe('passed');
    expect(passed.reasons).toEqual([]);
    expect(passed.open).toEqual({ critical: 0, warning: 0, info: 1 });
    // 처분과 그 커밋이 발견마다 온다 — 커밋이 이 브랜치의 것인지는 부른 쪽이 확인한다
    const fixed = passed.findings.find((f) => f.id === warningId)!;
    expect(fixed.status).toBe('fixed');
    expect(fixed.resolution).toMatchObject({ kind: 'fixed', commit_sha: 'c0ffee1' });
    expect(passed.findings_total).toBe(2);
  });

  it('head_sha 를 주면 그 커밋의 라운드만 본다 — 주지 않으면 가장 최근 라운드다', async () => {
    await submit({ headSha: 'head001', findings: [finding('critical', '옛 커밋의 결함')] });
    await submit({ headSha: 'head002', changeset: ['src/widget.ts', 'src/other.ts'] });

    const latest = (await check(q())).items[0]!;
    expect(latest.head_sha).toBe('head002');
    expect(latest.state).toBe('passed');

    const old = (await check(q('&head_sha=head001'))).items[0]!;
    expect(old.head_sha).toBe('head001');
    expect(old.state).toBe('pending');
  });

  it('한 커밋을 세션 여럿이 나눠 보면 그 전부가 한 라운드다 — 하나라도 막으면 막힌다', async () => {
    await submit({ changeset: ['src/a.ts'] });
    await submit({ changeset: ['src/b.ts'], findings: [finding('critical', 'b 의 결함')] });
    const item = (await check(q())).items[0]!;
    expect(item.state).toBe('pending');
    expect(item.open.critical).toBe(1);
  });

  it('아직 도는 세션이 있으면 끝나지 않은 라운드다', async () => {
    const out = await submit({});
    await pool.query(
      `UPDATE review_session SET state = 'running', completed_at = NULL WHERE id = $1`,
      [out.review_session_id],
    );
    const item = (await check(q())).items[0]!;
    expect(item.state).toBe('pending');
    expect(item.reasons).toEqual(['running']);
    expect(item.completed_at).toBeNull();
  });

  it('라운드가 없는 종류를 물으면 uncovered 행이다 — 빼 버리면 통과와 구분되지 않는다', async () => {
    await submit({});
    const res = await check(q('&kind=code,consistency'));
    expect(res.items.map((i) => [i.kind, i.state])).toEqual([
      ['code', 'passed'],
      ['consistency', 'uncovered'],
    ]);
    // 리뷰가 없는 브랜치 — 종류를 주지 않으면 항목이 없다
    expect((await check('branch=feat/none')).items).toEqual([]);
  });

  it('다른 브랜치의 발견은 이 라운드에 들어오지 않는다', async () => {
    // 커밋이 같으면 변경 묶음이 같아 한 세션으로 합쳐진다 — 다른 브랜치는 다른 커밋으로 둔다
    await submit({
      branch: 'feat/other',
      headSha: 'other01',
      findings: [finding('critical', '다른 브랜치')],
    });
    await submit({});
    const item = (await check(q())).items[0]!;
    expect(item.state).toBe('passed');
    expect(item.findings_total).toBe(0);
  });

  it('branch 가 없거나 모르는 종류면 400 이다', async () => {
    const missing = await check('kind=code');
    expect(missing.status).toBe(400);
    expect((missing.body as { code: string }).code).toBe(NERV_ERROR.PRECONDITION);
    const unknown = await check(q('&kind=codes'));
    expect(unknown.status).toBe(400);
  });
});

/**
 * 제출 응답의 라운드 범위 판정 (2026-09-28 · clemvion 요청 N2 · 사람 결정 D3 · D2a · REQ-API-248).
 *
 * `block` 은 프로젝트 전체의 열린 critical 이라, 열린 critical 이 하나라도 남은 프로젝트에서는 어떤 제출도 `true`
 * 였다. 새 필드는 이번 라운드만 보고, 기준은 게이트 판정과 같다 — 제출 직후 본 값과 CI 가 본 값이 같아야 한다.
 */
describe('제출 응답의 round_block (REQ-API-248)', () => {
  it('다른 브랜치에 열린 critical 이 있어도 이번 라운드가 깨끗하면 round_block 은 거짓이다 — block 은 그대로다', async () => {
    await submit({
      branch: 'feat/other',
      headSha: 'other01',
      findings: [finding('critical', '다른 브랜치')],
    });
    const out = await submit({});
    expect(out.block).toBe(true);
    expect(out.block_scope).toBe('round');
    expect(out.round_block).toBe(false);
    expect(out.blocking_findings).toEqual([]);
  });

  it('이번 라운드의 열린 warning 도 막는다 — 막는 발견을 함께 준다, info 는 빼고', async () => {
    const out = await submit({
      findings: [finding('warning', '재시도에 상한이 없다'), finding('info', '이름이 길다')],
    });
    expect(out.block).toBe(false);
    expect(out.round_block).toBe(true);
    expect(out.blocking_findings).toEqual([
      { id: expect.any(String) as string, severity: 'warning', title: '재시도에 상한이 없다' },
    ]);
  });

  it('같은 커밋을 본 앞 세션의 발견도 이번 라운드다 — 게이트 판정과 같은 값이다', async () => {
    await submit({ changeset: ['src/a.ts'], findings: [finding('critical', 'a 의 결함')] });
    const out = await submit({ changeset: ['src/b.ts'] });
    expect(out.round_block).toBe(true);
    expect(out.blocking_findings.map((f) => f.title)).toEqual(['a 의 결함']);
    const gate = (await check(q('&kind=code'))).items[0]!;
    expect(gate.state).toBe('pending');
  });
});

/**
 * done 게이트의 종류 조건 (2026-09-28 · clemvion 요청 N6 · 사람 결정 D9 · D2a · REQ-API-250).
 *
 * `review_coverage` 가 종류 목록이면 종류마다 그 작업의 최신 라운드가 게이트 판정을 통과해야 done 이다 — "구현이
 * 스펙과 맞는지(consistency) 검토했는가" 를 서버가 강제한다. `true` 의 뜻(종류 무관 · critical 0)은 그대로다.
 */
describe('done 게이트의 종류 조건 (REQ-API-250)', () => {
  async function doneTask(key: string): Promise<string> {
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업','in_progress','목표','PR','도구','경계')`,
      [taskId, projectId, key],
    );
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'commit','a1b2c3d','human')`,
      [newId(), projectId, taskId],
    );
    return taskId;
  }
  const close = (taskId: string): Promise<unknown> =>
    app
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
  const missingOf = (e: unknown): string[] =>
    (e as { details?: { missing?: string[] } }).details?.missing ?? [];

  it('종류마다 라운드가 있어야 하고 열린 warning 도 막는다 — 다 통과하면 닫힌다', async () => {
    await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify({ done_gate: { review_coverage: ['code', 'consistency'] } }),
      projectId,
    ]);
    const taskId = await doneTask('CLV-T-KIND01');

    const none = missingOf(await close(taskId));
    expect(none).toEqual([
      '이 작업을 검토한 code 리뷰가 없습니다',
      '이 작업을 검토한 consistency 리뷰가 없습니다',
    ]);

    const code = await submit({ taskId, findings: [finding('warning', '재시도에 상한이 없다')] });
    await submit({ taskId, kind: 'consistency', changeset: ['spec/a.md'] });
    expect(missingOf(await close(taskId))).toEqual([
      '이 작업의 code 리뷰에 열린 발견이 남아 있습니다(critical 0건 · warning 1건)',
    ]);

    await reviews.resolve({
      projectId,
      findingId: code.findings_new[0]!,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'fixed',
      status: 'fixed',
      rationale: '상한 3회',
      commitSha: 'c0ffee2',
    });
    expect(await close(taskId)).toMatchObject({ status: 'done' });
  });

  it('게이트 판정은 종류를 주지 않아도 정책이 요구하는 종류를 uncovered 로 함께 준다', async () => {
    await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify({ done_gate: { review_coverage: ['code', 'consistency'] } }),
      projectId,
    ]);
    await submit({});
    const res = await check(q());
    expect(res.items.map((i) => [i.kind, i.state])).toEqual([
      ['code', 'passed'],
      ['consistency', 'uncovered'],
    ]);
  });
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
