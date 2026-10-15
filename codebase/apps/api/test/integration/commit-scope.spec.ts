// 커밋 범위 — done 게이트의 커밋 신선도와 `verified` 의 커밋 범위 (2026-10-15 · Phase 2 E16-S01 · E15-S03)
//
//   REQ-API-314  done 게이트의 리뷰 조건은 작업의 최신 커밋(가장 나중에 받은 `commit` 증적)을 본 라운드만 센다. 리뷰 뒤에
//                새 커밋이 왔으면 막고 `stale_reviews` 에 종류 · 그 커밋 · 리뷰가 본 커밋을 준다. 커밋을 모르면 신선도만
//                넘기고 done 과 함께 `gate.failopen` 을 남긴다(D-14)
//   REQ-API-315  `verified` 의 열린 critical 0 은 파생 작업의 최신 커밋을 본 라운드에서 센다 — 커밋을 모르면 예전처럼
//                요구사항 단위로 본다. 라운드 제출 · 발견 처분 · 웹훅 증적이 그 요구사항을 다시 파생한다
//
// 판정은 실제 Postgres 로 본다 — 커밋의 순서(받은 시각 · id)와 SHA 비교(짧은 SHA · 대소문자)가 SQL 에 있다.

import { NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import type { SubmitResult } from '../../src/modules/review/review.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { WebhookService } from '../../src/modules/task/webhook.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let reviews: ReviewService;
let tasks: TaskService;
let projectId: string;
let userId: string;
let agentSessionId: string;
let specVersionId: string;
let specId: string;

/** 커밋 둘 — 40자 SHA 다. 리뷰 뒤에 B 가 온다 */
const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const B = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';

beforeAll(async () => {
  db = await createScratchDb('nerv_commit_scope');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  reviews = app.get(ReviewService);
  tasks = app.get(TaskService);
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
  await pool.query('DELETE FROM finding_occurrence');
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM reviewer_report');
  await pool.query('UPDATE review_session SET previous_session_id = NULL');
  await pool.query('DELETE FROM review_session');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM requirement_version');
  await pool.query('DELETE FROM requirement');
  await pool.query('TRUNCATE event');
  await pool.query(`UPDATE project SET gate_policy = '{}'::jsonb`);
});

async function setPolicy(policy: Record<string, unknown>): Promise<void> {
  await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
    JSON.stringify(policy),
    projectId,
  ]);
}

/** 진행 중인 작업 — 요구사항을 주면 그 요구사항의 파생 작업이다 */
async function makeTask(key: string, requirementId: string | null = null): Promise<string> {
  const taskId = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, source_requirement_id,
                       goal_md, output_format_md, tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,'작업','in_progress',$4,'목표','PR','도구','경계')`,
    [taskId, projectId, key, requirementId],
  );
  return taskId;
}

/** 작업에 증적을 붙인다 — 문장마다 따로 커밋되므로 뒤에 붙인 것이 나중에 받은 것이다 */
async function attach(taskId: string, kind: string, locator: string): Promise<void> {
  await pool.query(
    `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
     VALUES ($1,$2,$3,$4::evidence_kind,$5,'ci')`,
    [newId(), projectId, taskId, kind, locator],
  );
}

async function submit(over: {
  taskId: string;
  headSha: string;
  kind?: 'code' | 'consistency';
  findings?: Record<string, unknown>[];
}): Promise<SubmitResult> {
  return reviews.submit({
    projectId,
    userId,
    sessionId: agentSessionId,
    isAgent: true,
    branch: 'feat/freshness',
    baseSha: 'base0000',
    headSha: over.headSha,
    kind: over.kind ?? 'code',
    changeset: ['src/widget.ts'],
    summaryMd: '봤다.',
    reviewer: { role: 'security', risk: 'medium' },
    taskId: over.taskId,
    findings: (over.findings ?? []) as never,
  } as Parameters<ReviewService['submit']>[0]);
}

const critical = (title: string, requirementId?: string): Record<string, unknown> => ({
  severity: 'critical',
  title,
  body_md: `${title} — 본문`,
  file: 'src/widget.ts',
  line: 1,
  category: 'security',
  ...(requirementId === undefined ? {} : { requirement_id: requirementId }),
});

const close = (taskId: string, evidence?: { kind: string; locator: string }[]): Promise<unknown> =>
  tasks
    .transition({
      projectId,
      taskId,
      status: 'done',
      userId,
      roles: ['admin'],
      specImpact: { none: true },
      ...(evidence === undefined ? {} : { evidence }),
    })
    .catch((e: unknown) => e);

const detailsOf = (e: unknown): Record<string, unknown> =>
  (e as { details?: Record<string, unknown> }).details ?? {};

async function eventsOf(type: string, taskId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM event WHERE type = $1 AND subject_id = $2 ORDER BY occurred_at`,
    [type, taskId],
  );
  return rows.map((r) => r.payload);
}

describe('done 게이트의 커밋 신선도 (REQ-API-314 · E16-S01)', () => {
  it('리뷰 뒤에 새 커밋이 오면 done 을 막고 어느 종류를 어느 커밋에 대해 다시 리뷰받아야 하는지 준다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH01');
    await attach(taskId, 'commit', A);
    await submit({ taskId, headSha: A });
    await attach(taskId, 'commit', B);

    const refused = detailsOf(await close(taskId));
    expect(refused['kind']).toBe('done_gate');
    expect(refused['missing']).toEqual([
      '이 작업의 code 리뷰가 본 커밋(a1b2c3d) 뒤에 새 커밋(b2c3d4e)이 있습니다. 새 커밋을 다시 리뷰받아야 합니다',
    ]);
    expect(refused['stale_reviews']).toEqual([{ kind: 'code', head_sha: B, reviewed_sha: A }]);
    // 답은 면제가 아니라 다시 리뷰다 — 면제 후보(uncovered_kinds)에 넣지 않는다
    expect(refused['uncovered_kinds']).toBeUndefined();
    // 닫히지 않은 시도는 fail-open 을 남기지 않는다
    expect(await eventsOf(NERV_EVENT.GATE_FAILOPEN, taskId)).toEqual([]);
  });

  it('새 커밋을 리뷰받으면 닫힌다 — task.done 이 견준 커밋을 남긴다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH02');
    await attach(taskId, 'commit', A);
    await submit({ taskId, headSha: A });
    await attach(taskId, 'commit', B);
    await submit({ taskId, headSha: B });

    expect(await close(taskId)).toMatchObject({ status: 'done' });
    const [done] = await eventsOf(NERV_EVENT.TASK_DONE, taskId);
    expect((done?.['done_gate'] as Record<string, unknown>)['head_sha']).toBe(B);
    expect(await eventsOf(NERV_EVENT.GATE_FAILOPEN, taskId)).toEqual([]);
  });

  it('나중에 낸 리뷰가 옛 커밋을 봤어도 최신 커밋의 라운드가 있으면 그 라운드를 센다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH03');
    await attach(taskId, 'commit', B);
    await submit({ taskId, headSha: B });
    // 옛 커밋의 리뷰가 늦게 들어왔다 — 가장 최근 라운드는 A 지만 최신 커밋 B 의 라운드가 있다
    await submit({ taskId, headSha: A, findings: [critical('옛 커밋의 결함')] });
    expect(await close(taskId)).toMatchObject({ status: 'done' });
  });

  it('짧은 SHA 와 대소문자는 같은 커밋이다 — 증적은 짧게, 리뷰는 40자로 와도 막지 않는다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH04');
    await submit({ taskId, headSha: B.toUpperCase() });
    await attach(taskId, 'commit', B.slice(0, 7));
    expect(await close(taskId)).toMatchObject({ status: 'done' });
  });

  it('done 에 붙인 커밋도 최신 커밋이다 — 리뷰 뒤의 커밋을 붙여 닫으려 하면 막히고 증적도 남지 않는다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH05');
    await attach(taskId, 'commit', A);
    await submit({ taskId, headSha: A });

    const refused = detailsOf(await close(taskId, [{ kind: 'commit', locator: B.slice(0, 10) }]));
    expect(refused['stale_reviews']).toEqual([
      { kind: 'code', head_sha: B.slice(0, 10), reviewed_sha: A },
    ]);
    const { rows } = await pool.query(`SELECT locator FROM evidence WHERE task_id = $1`, [taskId]);
    expect(rows.map((r) => r.locator)).toEqual([A]);
  });

  it('작업의 커밋을 모르면 신선도만 넘기고 done 과 함께 gate.failopen 을 남긴다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH06');
    await attach(taskId, 'pr', 'https://git.example.com/pr/1');
    await submit({ taskId, headSha: A });

    expect(await close(taskId)).toMatchObject({ status: 'done' });
    expect(await eventsOf(NERV_EVENT.GATE_FAILOPEN, taskId)).toEqual([
      { gate: 'done_gate', error: 'commit_unknown', kinds: ['code'] },
    ]);
    const [done] = await eventsOf(NERV_EVENT.TASK_DONE, taskId);
    expect((done?.['done_gate'] as Record<string, unknown>)['head_sha']).toBeNull();
  });

  it('커밋을 몰라도 리뷰가 없거나 열린 critical 이 있으면 지금처럼 막는다 — 그때는 fail-open 도 남기지 않는다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH07');
    await attach(taskId, 'pr', 'https://git.example.com/pr/2');
    expect(detailsOf(await close(taskId))['missing']).toEqual([
      '이 작업을 검토한 code 리뷰가 없습니다',
    ]);
    await submit({ taskId, headSha: A, findings: [critical('토큰이 로그에 남는다')] });
    expect(detailsOf(await close(taskId))['missing']).toEqual([
      '이 작업의 code 리뷰에 열린 발견이 남아 있습니다(critical 1건 · warning 0건)',
    ]);
    expect(await eventsOf(NERV_EVENT.GATE_FAILOPEN, taskId)).toEqual([]);
  });

  it('리뷰가 본 것이 커밋 SHA 모양이 아니면 견주지 못한다 — 그 라운드로 판정하고 fail-open 을 남긴다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code'] } });
    const taskId = await makeTask('CLV-T-FRSH08');
    await attach(taskId, 'commit', B);
    await submit({ taskId, headSha: 'HEAD' });

    expect(await close(taskId)).toMatchObject({ status: 'done' });
    expect(await eventsOf(NERV_EVENT.GATE_FAILOPEN, taskId)).toEqual([
      { gate: 'done_gate', error: 'review_commit_unknown', kinds: ['code'] },
    ]);
  });

  it('면제한 종류는 건너뛴다 — 남은 종류만 새 커밋을 본다', async () => {
    await setPolicy({ done_gate: { review_coverage: ['code', 'consistency'] } });
    const taskId = await makeTask('CLV-T-FRSH09');
    await attach(taskId, 'commit', A);
    await submit({ taskId, headSha: A, kind: 'consistency' });
    await app.get(ApprovalService).bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: taskId,
      userId,
      reason: '스펙 정합은 이 작업의 범위가 아니다 — 문서를 고치지 않았다',
      actor: { userId, isAgent: false },
      kinds: ['consistency'],
      roles: ['admin'],
    });
    await submit({ taskId, headSha: A });
    await attach(taskId, 'commit', B);

    const refused = detailsOf(await close(taskId));
    expect(refused['stale_reviews']).toEqual([{ kind: 'code', head_sha: B, reviewed_sha: A }]);

    await submit({ taskId, headSha: B });
    expect(await close(taskId)).toMatchObject({ status: 'done' });
    const [done] = await eventsOf(NERV_EVENT.TASK_DONE, taskId);
    expect((done?.['done_gate'] as Record<string, unknown>)['conditions']).toEqual([
      { condition: 'spec_impact', result: 'passed' },
      { condition: 'evidence', result: 'passed' },
      { condition: 'review_kind', kind: 'code', result: 'passed' },
      { condition: 'review_kind', kind: 'consistency', result: 'waived' },
    ]);
  });

  it('종류 무관 조건(true)도 최신 커밋을 본 리뷰만 센다', async () => {
    await setPolicy({ done_gate: { review_coverage: true } });
    const taskId = await makeTask('CLV-T-FRSH0A');
    await attach(taskId, 'commit', A);
    await submit({ taskId, headSha: A });
    await attach(taskId, 'commit', B);

    const refused = detailsOf(await close(taskId));
    expect(refused['missing']).toEqual([
      '이 작업의 리뷰가 본 커밋(a1b2c3d) 뒤에 새 커밋(b2c3d4e)이 있습니다. 새 커밋을 다시 리뷰받아야 합니다',
    ]);
    expect(refused['stale_reviews']).toEqual([{ kind: null, head_sha: B, reviewed_sha: A }]);

    await submit({ taskId, headSha: B, kind: 'consistency' });
    expect(await close(taskId)).toMatchObject({ status: 'done' });
  });

  it('리뷰를 보지 않는 정책이면 커밋을 읽지도 남기지도 않는다', async () => {
    const taskId = await makeTask('CLV-T-FRSH0B');
    await attach(taskId, 'commit', A);
    await submit({ taskId, headSha: 'f00dfeed' });
    await attach(taskId, 'commit', B);
    expect(await close(taskId)).toMatchObject({ status: 'done' });
    const [done] = await eventsOf(NERV_EVENT.TASK_DONE, taskId);
    expect(done?.['done_gate']).not.toHaveProperty('head_sha');
    expect(await eventsOf(NERV_EVENT.GATE_FAILOPEN, taskId)).toEqual([]);
  });
});

describe('`verified` 의 커밋 범위 (REQ-API-315 · E15-S03)', () => {
  /** 요구사항 하나와 그 파생 작업 — 서명된 test 증적을 미리 붙인다(QA 가 검증했다) */
  async function verifiable(
    ref: string,
    taskKey: string,
  ): Promise<{ reqId: string; taskId: string }> {
    const reqId = newId();
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,$4,'WHEN 조건이면 THE SYSTEM SHALL 동작한다','must',$5,$5)`,
      [reqId, projectId, specId, ref, specVersionId],
    );
    const taskId = await makeTask(taskKey, reqId);
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source, verified_by, verified_at)
       VALUES ($1,$2,$3,'test','widget.spec.ts','human',$4,now())`,
      [newId(), projectId, taskId, userId],
    );
    return { reqId, taskId };
  }

  const statusOf = async (reqId: string): Promise<string> => {
    const { rows } = await pool.query<{ s: string }>(
      `SELECT impl_status::text AS s FROM requirement WHERE id = $1`,
      [reqId],
    );
    return rows[0]?.s ?? '';
  };

  it('리뷰가 본 커밋 뒤에 새 커밋이 있으면 검증되지 않는다 — 그 커밋을 리뷰받으면 검증된다', async () => {
    const { reqId, taskId } = await verifiable('REQ-SCOPE-001', 'CLV-T-SCPE01');
    await submit({ taskId, headSha: A });
    // 리뷰를 요구하지 않는 정책이라 done 은 닫힌다 — 검증은 따로 본다
    expect(await close(taskId, [{ kind: 'commit', locator: B }])).toMatchObject({ status: 'done' });
    expect(await statusOf(reqId)).toBe('implemented');

    // 라운드가 들어온 순간 다시 파생한다 — 서명을 다시 받지 않아도 된다
    await submit({ taskId, headSha: B });
    expect(await statusOf(reqId)).toBe('verified');
  });

  it('커밋 범위로 좁힌다 — 새 커밋의 라운드가 깨끗하면 앞 라운드에 남은 열린 critical 은 막지 않는다', async () => {
    const { reqId, taskId } = await verifiable('REQ-SCOPE-002', 'CLV-T-SCPE02');
    await submit({
      taskId,
      headSha: A,
      findings: [critical('입력을 검증하지 않는다', 'REQ-SCOPE-002')],
    });
    await submit({ taskId, headSha: B });
    expect(await close(taskId, [{ kind: 'commit', locator: B }])).toMatchObject({ status: 'done' });
    // 예전 규칙(그 요구사항에 열린 critical 0)이면 implemented 에 머물렀다
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM finding WHERE requirement_id = $1 AND status = 'open'`,
      [reqId],
    );
    expect(rows[0].n).toBe(1);
    expect(await statusOf(reqId)).toBe('verified');
  });

  it('새 커밋의 라운드에 열린 critical 이 있으면 검증되지 않고, 처분하면 검증된다', async () => {
    const { reqId, taskId } = await verifiable('REQ-SCOPE-003', 'CLV-T-SCPE03');
    const round = await submit({ taskId, headSha: B, findings: [critical('경계값이 빠졌다')] });
    expect(await close(taskId, [{ kind: 'commit', locator: B }])).toMatchObject({ status: 'done' });
    expect(await statusOf(reqId)).toBe('implemented');

    await reviews.resolve({
      projectId,
      findingId: round.findings_new[0]!,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'fixed',
      status: 'fixed',
      rationale: '경계값을 더했다',
      commitSha: B,
    });
    expect(await statusOf(reqId)).toBe('verified');
  });

  it('작업의 커밋을 모르면 예전처럼 요구사항 단위로 본다 — 그 요구사항의 열린 critical 이 막고 처분이 푼다', async () => {
    const { reqId, taskId } = await verifiable('REQ-SCOPE-004', 'CLV-T-SCPE04');
    const round = await submit({
      taskId,
      headSha: A,
      findings: [critical('권한을 보지 않는다', 'REQ-SCOPE-004')],
    });
    expect(await close(taskId, [{ kind: 'code_path', locator: 'src/widget.ts' }])).toMatchObject({
      status: 'done',
    });
    expect(await statusOf(reqId)).toBe('implemented');

    await reviews.resolve({
      projectId,
      findingId: round.findings_new[0]!,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'fixed',
      status: 'fixed',
      rationale: '권한 검사를 더했다',
      commitSha: A,
    });
    expect(await statusOf(reqId)).toBe('verified');
  });

  it('리뷰를 받지 않은 작업은 커밋을 알아도 요구사항 단위로 본다 — 리뷰를 쓰지 않는 프로젝트의 검증이 막히지 않는다', async () => {
    const { reqId, taskId } = await verifiable('REQ-SCOPE-005', 'CLV-T-SCPE05');
    expect(await close(taskId, [{ kind: 'commit', locator: A }])).toMatchObject({ status: 'done' });
    expect(await statusOf(reqId)).toBe('verified');
  });

  it('웹훅이 새 커밋을 붙이면 다시 파생한다 — 검증된 값은 내리지 않는다', async () => {
    const { reqId, taskId } = await verifiable('REQ-SCOPE-006', 'CLV-T-SCPE06');
    await pool.query(`DELETE FROM evidence WHERE task_id = $1 AND kind = 'test'`, [taskId]);
    await submit({ taskId, headSha: A });
    expect(await close(taskId, [{ kind: 'commit', locator: A }])).toMatchObject({ status: 'done' });
    expect(await statusOf(reqId)).toBe('implemented');
    // 서명된 증적이 생기고(직접 넣어 파생은 일어나지 않는다) 웹훅의 새 커밋이 다시 파생을 부른다 — 새 커밋 B 를
    // 리뷰받지 않았으므로 검증되지 않는다
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source, verified_by, verified_at)
       VALUES ($1,$2,$3,'test','widget.spec.ts','human',$4,now())`,
      [newId(), projectId, taskId, userId],
    );
    const hook = await app.get(WebhookService).handle({
      projectId,
      event: 'push',
      payload: { ref: 'refs/heads/feat/CLV-T-SCPE06', after: B, commits: [] },
    });
    expect(hook.evidence_id).not.toBeNull();
    expect(await statusOf(reqId)).toBe('implemented');

    await submit({ taskId, headSha: B });
    expect(await statusOf(reqId)).toBe('verified');
    // 한번 선 검증은 그 뒤의 새 커밋으로 내리지 않는다(REQ-API-141)
    await app.get(WebhookService).handle({
      projectId,
      event: 'push',
      payload: { ref: 'refs/heads/feat/CLV-T-SCPE06', after: A.replace('a1', 'c3'), commits: [] },
    });
    expect(await statusOf(reqId)).toBe('verified');
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  agentSessionId = newId();
  specId = newId();
  specVersionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'admin@example.com','관리자','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
    [newId(), orgId, projectId, userId],
  );
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-02','active')`,
    [agentSessionId, projectId, userId],
  );
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SPC-SCOPE','커밋 범위')`,
    [specId, projectId],
  );
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
     VALUES ($1,$2,1,'approved','# 본문', sha256('scope'::bytea), $3)`,
    [specVersionId, specId, userId],
  );
}
