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
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
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
  role?: string;
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
    reviewer: { role: over.role ?? 'security', risk: 'medium' },
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
  roles: { required: string[]; reported: string[]; missing: string[] };
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

/**
 * 종류별 필수 리뷰어 역할 (2026-09-28 · clemvion 요청 N7 · 사람 결정 D9 · REQ-API-252).
 *
 * "강제 리뷰어 일곱이 모두 돌았다" 를 로컬에서만 확인하고 있었다. 정책이 역할을 요구하면 게이트 판정은 빠진 역할을
 * 알리고 통과로 치지 않는다. 같은 커밋을 역할마다 따로 제출해도 한 라운드다.
 */
describe('필수 리뷰어 역할 (REQ-API-252)', () => {
  const requireRoles = (policy: Record<string, unknown>): Promise<unknown> =>
    pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify(policy),
      projectId,
    ]);

  it('빠진 역할이 있으면 pending 이고 무엇이 빠졌는지 준다 — 채우면 통과한다', async () => {
    await requireRoles({ review_roles: { code: ['security', 'testing'] } });
    const first = await submit({ role: 'security' });
    const pending = (await check(q('&kind=code'))).items[0]!;
    expect(pending.state).toBe('pending');
    expect(pending.reasons).toEqual(['missing_roles']);
    expect(pending.roles).toEqual({
      required: ['security', 'testing'],
      reported: ['security'],
      missing: ['testing'],
    });
    // 세션에도 남는다 — 스키마에 있었지만 채우는 곳이 없던 두 열이다
    const { rows: before } = await pool.query<{ forced_roles: string[]; ok: boolean }>(
      `SELECT forced_roles, forced_coverage_ok AS ok FROM review_session WHERE id = $1`,
      [first.review_session_id],
    );
    expect(before[0]).toEqual({ forced_roles: ['security', 'testing'], ok: false });

    await submit({ role: 'testing' });
    const passed = (await check(q('&kind=code'))).items[0]!;
    expect(passed.state).toBe('passed');
    expect(passed.roles.missing).toEqual([]);
    const { rows: after } = await pool.query<{ ok: boolean }>(
      `SELECT forced_coverage_ok AS ok FROM review_session WHERE id = $1`,
      [first.review_session_id],
    );
    expect(after[0]?.ok).toBe(true);
  });

  it('작업 완료 조건(종류 목록)도 빠진 역할로 막는다', async () => {
    await requireRoles({
      done_gate: { review_coverage: ['code'] },
      review_roles: { code: ['security', 'testing'] },
    });
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,'CLV-T-ROLE01','작업','in_progress','목표','PR','도구','경계')`,
      [taskId, projectId],
    );
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'commit','a1b2c3d','human')`,
      [newId(), projectId, taskId],
    );
    await submit({ taskId, role: 'security' });
    const error = (await app
      .get(TaskService)
      .transition({
        projectId,
        taskId,
        status: 'done',
        userId,
        roles: ['planner'],
        specImpact: { none: true },
      })
      .catch((e: unknown) => e)) as { details?: { missing?: string[] } };
    expect(error.details?.missing).toEqual([
      '이 작업의 code 리뷰에 testing 역할의 보고가 없습니다',
    ]);
  });
});

/**
 * 코드 산출물이 없는 작업 — 범위를 고른 리뷰 면제 (2026-10-09 · clemvion 보고 · REQ-API-274).
 *
 * `review_coverage: ["code","consistency"]` 인 프로젝트에서 코드를 내지 않은 작업은 `code` 라운드를 받을 길이 없어
 * done 에서 막혔다. 면제는 리뷰 커버리지를 통째로 넘기는 것뿐이었고 웹에는 그 단추도 없었다 — 남은 길은 하지 않은
 * 리뷰를 꾸며 내는 것뿐이었다. 사람이 사유와 함께 **그 종류만** 면제하고, 코드를 낸 작업의 code 리뷰는 면제하지 못한다.
 */
describe('범위를 고른 리뷰 면제 — 코드 없는 작업을 정직하게 닫는다 (REQ-API-274)', () => {
  const SIX = ['security', 'testing', 'requirement', 'scope', 'side_effect', 'maintainability'];
  const policy = (): Promise<unknown> =>
    pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify({
        done_gate: { evidence_source: 'any', review_coverage: ['code', 'consistency'] },
        review_roles: { code: SIX },
      }),
      projectId,
    ]);
  async function task(key: string, evidence: [string, string][]): Promise<string> {
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업','in_progress','목표','리뷰 레코드','도구','경계')`,
      [taskId, projectId, key],
    );
    for (const [kind, locator] of evidence) {
      await pool.query(
        `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
         VALUES ($1,$2,$3,$4,$5,'agent')`,
        [newId(), projectId, taskId, kind, locator],
      );
    }
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
  const detailsOf = (e: unknown): Record<string, unknown> =>
    (e as { details?: Record<string, unknown> }).details ?? {};
  const waive = (
    subject: string,
    kinds: string[] | undefined,
    roles: string[],
    over: { isAgent?: boolean; reason?: string } = {},
  ): Promise<unknown> =>
    app
      .get(ApprovalService)
      .bypass({
        projectId,
        subjectType: 'gate_bypass',
        subjectId: subject,
        userId,
        reason: over.reason ?? '코드 변경 없이 승인된 스펙 14편의 일관성을 다시 검토한 작업이다',
        actor: { userId, isAgent: over.isAgent === true },
        ...(kinds === undefined ? {} : { kinds }),
        roles,
      })
      .catch((e: unknown) => e);

  it('CLE-T-2NVZA4 — consistency 라운드만 있는 작업은 code 가 비어 막히고, developer 가 code 를 면제하면 닫힌다', async () => {
    await policy();
    const taskId = await task('CLV-T-2NVZA4', [
      ['review', 'round-1'],
      ['review', 'round-2'],
      ['review', 'round-3'],
      ['review', 'round-4'],
    ]);
    for (const n of [1, 2, 3, 4]) {
      await submit({
        taskId,
        kind: 'consistency',
        branch: `review/consistency-${n}`,
        changeset: [`spec/CLE-${n}.md`],
      });
    }
    const refused = detailsOf(await close(taskId));
    expect(refused['missing']).toEqual(['이 작업을 검토한 code 리뷰가 없습니다']);
    // 기계가 읽을 값 — 에이전트는 이것으로 사람에게 면제를 부탁한다
    expect(refused['uncovered_kinds']).toEqual(['code']);

    const waived = (await waive('CLV-T-2NVZA4', ['code'], ['developer'])) as Record<
      string,
      unknown
    >;
    expect(waived).toMatchObject({ task_key: 'CLV-T-2NVZA4', kinds: ['code'] });
    const { rows } = await pool.query(
      `SELECT bypass_kinds::text[] AS kinds, bypass_reason, decided_by_user_id FROM approval
        WHERE is_bypass AND subject_id = $1`,
      [taskId],
    );
    expect(rows[0]).toMatchObject({ kinds: ['code'], decided_by_user_id: userId });
    const { rows: ev } = await pool.query(
      `SELECT payload FROM event WHERE type = 'gate.bypassed' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(ev[0].payload).toMatchObject({ kinds: ['code'], task_key: 'CLV-T-2NVZA4' });

    expect(await close(taskId)).toMatchObject({ status: 'done' });
    // 작업 상세가 누가 · 언제 · 왜 면제했는지 준다
    const detail = await app.get(TaskService).get({ projectId, taskKey: 'CLV-T-2NVZA4' });
    expect(detail['review_waivers']).toEqual([
      expect.objectContaining({ kinds: ['code'], by_name: '규아', void_kinds: [] }),
    ]);
  });

  it('CLE-T-SJAYNM — 스펙 초안만 쓴 작업: planner 는 code 를 면제하지 못하고 admin 은 한다', async () => {
    await policy();
    const taskId = await task('CLV-T-SJAYNM', [['review', 'spec-draft-review']]);
    await submit({ taskId, kind: 'consistency', changeset: ['spec/CLE-SJ.md'] });

    const forbidden = await waive(taskId, ['code'], ['planner']);
    expect(forbidden).toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'bypass_kind_forbidden', kinds: ['code'] },
    });
    expect((await pool.query(`SELECT count(*)::int AS n FROM approval`)).rows[0].n).toBe(0);

    await waive(taskId, ['code'], ['admin']);
    expect(await close(taskId)).toMatchObject({ status: 'done' });
  });

  it('code 를 면제해도 consistency 는 그대로 요구한다 — 면제는 고른 종류만이다', async () => {
    await policy();
    const taskId = await task('CLV-T-ONLY01', [['review', 'r']]);
    await waive(taskId, ['code'], ['developer']);
    const refused = detailsOf(await close(taskId));
    expect(refused['missing']).toEqual(['이 작업을 검토한 consistency 리뷰가 없습니다']);
    expect(refused['uncovered_kinds']).toEqual(['consistency']);
  });

  it('코드를 낸 작업의 code 리뷰는 면제하지 못한다 — 아무것도 기록하지 않는다', async () => {
    await policy();
    const taskId = await task('CLV-T-CODE01', [['commit', 'a1b2c3d']]);
    const refused = await waive(taskId, ['code'], ['developer', 'admin']);
    expect(refused).toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'bypass_has_code', kinds: ['code'] },
    });
    expect((await pool.query(`SELECT count(*)::int AS n FROM approval`)).rows[0].n).toBe(0);
  });

  it('면제한 뒤에 코드 증적이 붙으면 그 면제를 세지 않는다 — 코드를 내고 증적을 빼는 길도 막는다', async () => {
    await policy();
    const taskId = await task('CLV-T-LATE01', [['review', 'r']]);
    await submit({ taskId, kind: 'consistency', changeset: ['spec/a.md'] });
    await waive(taskId, ['code'], ['developer']);
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'pr','https://github.com/o/r/pull/7','agent')`,
      [newId(), projectId, taskId],
    );
    const refused = detailsOf(await close(taskId));
    expect(refused['missing']).toEqual([
      'code 리뷰 면제는 코드 증적이 없을 때만 적용됩니다. 이 작업에는 코드 증적이 있습니다',
      '이 작업을 검토한 code 리뷰가 없습니다',
    ]);
    const detail = await app.get(TaskService).get({ projectId, taskKey: 'CLV-T-LATE01' });
    expect(detail['review_waivers']).toEqual([expect.objectContaining({ void_kinds: ['code'] })]);
  });

  it('세지 않은 면제는 길을 막지 않는다 — 코드를 낸 뒤 진짜 code 리뷰를 통과하면 닫힌다', async () => {
    await policy();
    const taskId = await task('CLV-T-LATE02', [['review', 'r']]);
    await submit({ taskId, kind: 'consistency', changeset: ['spec/a.md'] });
    await waive(taskId, ['code'], ['developer']);
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'commit','a1b2c3d','agent')`,
      [newId(), projectId, taskId],
    );
    for (const role of SIX) await submit({ taskId, kind: 'code', role });
    expect(await close(taskId)).toMatchObject({ status: 'done' });

    // 정책이 code 를 요구하지 않게 바뀌어도 그 면제가 남아 막지 않는다
    await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
      JSON.stringify({ done_gate: { evidence_source: 'any', review_coverage: ['consistency'] } }),
      projectId,
    ]);
    const other = await task('CLV-T-LATE03', [['review', 'r']]);
    await submit({ taskId: other, kind: 'consistency', changeset: ['spec/a.md'] });
    await waive(other, ['code'], ['developer']);
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'pr','https://github.com/o/r/pull/8','agent')`,
      [newId(), projectId, other],
    );
    expect(await close(other)).toMatchObject({ status: 'done' });
  });

  it('에이전트는 면제하지 못하고, 모르는 종류 · 작업이 아닌 대상은 거절한다', async () => {
    await policy();
    const taskId = await task('CLV-T-GUARD1', []);
    expect(await waive(taskId, ['code'], ['developer'], { isAgent: true })).toMatchObject({
      code: NERV_ERROR.HUMAN_ONLY,
    });
    expect(await waive(taskId, ['lint'], ['admin'])).toMatchObject({
      details: { kind: 'invalid_input', field: 'kinds' },
    });
    expect(await waive(newId(), ['code'], ['admin'])).toMatchObject({
      details: { kind: 'not_found' },
    });
    expect((await pool.query(`SELECT count(*)::int AS n FROM approval`)).rows[0].n).toBe(0);
  });

  it('범위 없는 면제는 예전 그대로 리뷰 커버리지를 통째로 넘긴다', async () => {
    await policy();
    const taskId = await task('CLV-T-ALL001', [['review', 'r']]);
    await waive(taskId, undefined, ['planner'], { reason: '릴리스 임박 — 사후 리뷰 예약' });
    expect(await close(taskId)).toMatchObject({ status: 'done' });
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
