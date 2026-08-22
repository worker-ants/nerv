// E09-S02·S05 — 제출 전 사전 검토 5검사기 · done 게이트.
//
// clemvion 에서 이 검사는 산출물이 git 에 커밋되는 의무였고 858세션·42MB 가 쌓였다.
// 더 나쁜 것은 **모순**이다: SUMMARY 는 BLOCK: NO 인데 리포트에는 [CRITICAL] 이 있는 경우가
// 732세션 중 24건(3.3%). 그래서 여기서는 종합 verdict 를 "개별 severity 의 최댓값"으로
// **계산**한다 — 낮출 조건문 자체가 없다.

import { NERV_ERROR, newId, runMigrations } from '@nerv/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClaimService } from '../../src/modules/task/claim.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { QuestionService } from '../../src/modules/approval/question.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { worstOf } from '../../src/modules/spec/spec-check.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let checks: SpecCheckService;
let specs: SpecService;
let tasks: TaskService;
let projectId: string;
let planner: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_check');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const drizzleDb = drizzle(pool);
  const events = new EventService(drizzleDb, silent);
  checks = new SpecCheckService(drizzleDb);
  specs = new SpecService(events, checks, drizzleDb);
  tasks = new TaskService(
    new ClaimService(),
    events,
    new QuestionService(events, drizzleDb),
    drizzleDb,
  );
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM event');
});

async function draft(key: string, body: string): Promise<{ specId: string; versionId: string }> {
  const result = await specs.draftUpsert({
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: body,
    userId: planner,
  });
  return { specId: result['spec_id'] as string, versionId: result['spec_version_id'] as string };
}

describe('E09-S02 종합 verdict 는 낮출 수 없다', () => {
  it('개별 severity 의 최댓값이다 — 조건문으로 내릴 여지가 없다', () => {
    expect(worstOf([{ checker: 'cross-spec', severity: 'info', message: '', anchor: null }])).toBe(
      'info',
    );
    expect(
      worstOf([
        { checker: 'cross-spec', severity: 'info', message: '', anchor: null },
        { checker: 'requirement-shape', severity: 'block', message: '', anchor: null },
      ]),
    ).toBe('block');
  });

  it('검사기 5종이 모두 실행된다 — 커버리지 무결성', async () => {
    const { versionId } = await draft('SPC-COV', '# 문서\n\n본문');
    const result = await checks.check({ projectId, specVersionId: versionId });
    expect(Object.keys(result.checkers).sort()).toEqual([
      'convention-compliance',
      'cross-spec',
      'rationale-continuity',
      'requirement-shape',
      'task-coherence',
    ]);
  });
});

describe('E09-S02 requirement-shape', () => {
  it('요구사항 ID 중복 정의는 block 이다 — 어느 쪽이 진짜인지 알 수 없다', async () => {
    const { versionId } = await draft(
      'SPC-DUP-REQ',
      '# 문서\n\nREQ-CWC-031 WHEN 조건이면 THE SYSTEM SHALL 동작한다\nREQ-CWC-031 WHEN 다른 조건이면 THE SYSTEM SHALL 다르게 동작한다',
    );
    const result = await checks.check({ projectId, specVersionId: versionId });
    expect(result.verdict).toBe('block');
    expect(result.findings.some((f) => f.message.includes('중복 정의'))).toBe(true);
  });

  it('EARS 문형이 아니면 경고다 — 강제하면 임포트한 문서가 전부 막힌다', async () => {
    const { versionId } = await draft('SPC-EARS', '# 문서\n\nREQ-CWC-032 위젯을 잘 만든다');
    const result = await checks.check({ projectId, specVersionId: versionId });
    expect(result.verdict).toBe('warning');
    expect(result.findings.some((f) => f.message.includes('EARS'))).toBe(true);
  });

  it('EARS 를 지키면 지적이 없다', async () => {
    const { versionId } = await draft(
      'SPC-GOOD',
      '# 문서\n\nREQ-CWC-033 WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다',
    );
    const result = await checks.check({ projectId, specVersionId: versionId });
    expect(result.findings.filter((f) => f.checker === 'requirement-shape')).toEqual([]);
  });

  it('앵커를 남긴다 — 어디를 고쳐야 하는지 가리킨다', async () => {
    const { versionId } = await draft('SPC-ANCHOR', '# 문서\n\nREQ-CWC-034 잘못된 문형');
    const result = await checks.check({ projectId, specVersionId: versionId });
    expect(result.findings[0]?.anchor).toBe('REQ-CWC-034');
  });
});

describe('E09-S02 cross-spec · task-coherence', () => {
  it('다른 스펙이 소유한 ID 를 언급하면 중복 신호를 낸다', async () => {
    const owner = await draft('SPC-OWNER', '# 소유자\n\nREQ-OWN-001 WHEN x THE SYSTEM SHALL y');
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-OWN-001','WHEN x THE SYSTEM SHALL y','must',$4,$4)`,
      [newId(), projectId, owner.specId, owner.versionId],
    );

    const other = await draft('SPC-BORROW', '# 다른 문서\n\nREQ-OWN-001 를 여기서도 정의한다');
    const result = await checks.check({ projectId, specVersionId: other.versionId });
    expect(result.findings.some((f) => f.checker === 'cross-spec')).toBe(true);
  });

  it('책임지는 Task 가 없는 진행 중 요구사항은 "빈 약속"이다 (clemvion R-5)', async () => {
    const { specId, versionId } = await draft('SPC-ORPHAN', '# 문서');
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority, impl_status,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-ORPHAN-1','문장','must','in_progress',$4,$4)`,
      [newId(), projectId, specId, versionId],
    );
    const result = await checks.check({ projectId, specVersionId: versionId });
    expect(result.findings.some((f) => f.checker === 'task-coherence')).toBe(true);
    expect(result.findings.find((f) => f.checker === 'task-coherence')?.message).toContain(
      '빈 약속',
    );
  });
});

describe('E09-S02 제출 게이트 — 검사가 제출을 막는다', () => {
  it('block 이 있으면 제출 자체가 막힌다', async () => {
    const { versionId } = await draft(
      'SPC-BLOCKED',
      '# 문서\n\nREQ-A-1 WHEN x THE SYSTEM SHALL y\nREQ-A-1 WHEN z THE SYSTEM SHALL w',
    );
    await expect(
      specs.submitReview({ projectId, specVersionId: versionId, userId: planner }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });

    // 막혔으니 draft 그대로다
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM spec_version WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]?.status).toBe('draft');
  });

  it('warning 은 막지 않는다 — 경고는 넓게, 차단은 좁게', async () => {
    const { versionId } = await draft('SPC-WARN', '# 문서\n\nREQ-B-1 EARS 아닌 문장');
    await expect(
      specs.submitReview({ projectId, specVersionId: versionId, userId: planner }),
    ).resolves.toBeDefined();
  });
});

describe('E09-S05 done 게이트 (FR-10 · §4.6)', () => {
  async function readyTask(): Promise<string> {
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업','in_progress','목표','PR','도구','경계')`,
      [taskId, projectId, `TSK-${taskId.slice(0, 4)}`],
    );
    return taskId;
  }

  it('스펙 영향 선언이 없으면 done 으로 갈 수 없다 — 조건 5', async () => {
    const taskId = await readyTask();
    const error = await tasks
      .transition({
        projectId,
        taskId,
        status: 'done',
        userId: planner,
        evidence: [{ kind: 'pr', locator: 'https://pr/1' }],
      })
      .catch((e: unknown) => e as { details: Record<string, unknown> });
    expect((error.details['missing'] as string[]).join()).toContain('spec_impact');
  });

  it('증적이 없으면 done 으로 갈 수 없다 — 조건 4', async () => {
    const taskId = await readyTask();
    const error = await tasks
      .transition({
        projectId,
        taskId,
        status: 'done',
        userId: planner,
        specImpact: { none: true },
      })
      .catch((e: unknown) => e as { details: Record<string, unknown> });
    expect((error.details['missing'] as string[]).join()).toContain('evidence');
  });

  it('none sentinel 을 허용하되 선언 자체는 필수다 — 이 규칙이 clemvion 에서 가장 잘 작동했다', async () => {
    const taskId = await readyTask();
    await expect(
      tasks.transition({
        projectId,
        taskId,
        status: 'done',
        userId: planner,
        specImpact: { none: true },
        evidence: [{ kind: 'pr', locator: 'https://pr/2' }],
      }),
    ).resolves.toMatchObject({ status: 'done' });

    const { rows } = await pool.query<{ done_at: Date | null; spec_impact: unknown }>(
      `SELECT done_at, spec_impact FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]?.done_at).not.toBeNull();
    expect(rows[0]?.spec_impact).toEqual({ none: true });
  });

  it('같은 상태로의 재호출은 no-op 성공이다 — 멱등', async () => {
    const taskId = await readyTask();
    const first = await tasks.transition({
      projectId,
      taskId,
      status: 'in_progress',
      userId: planner,
    });
    expect(first.status).toBe('in_progress');
  });

  it('사유 없는 blocked 는 막는다 — 백로그 부패의 씨앗이다', async () => {
    const taskId = await readyTask();
    await expect(
      tasks.transition({ projectId, taskId, status: 'blocked', userId: planner }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });

    await expect(
      tasks.transition({
        projectId,
        taskId,
        status: 'blocked',
        userId: planner,
        blockedReason: 'awaiting_answer',
      }),
    ).resolves.toMatchObject({ status: 'blocked' });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  planner = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'jimin@example.com','지민','active')`,
    [planner],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
    [newId(), orgId, projectId, planner],
  );
}
