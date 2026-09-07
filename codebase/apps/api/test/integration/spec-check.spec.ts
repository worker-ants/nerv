// E09-S02·S05 — 제출 전 사전 검토 5검사기 · done 게이트.
//
// clemvion 에서 이 검사는 산출물이 git 에 커밋되는 의무였고 858세션·42MB 가 쌓였다.
// 더 나쁜 것은 **모순**이다: SUMMARY 는 BLOCK: NO 인데 리포트에는 [CRITICAL] 이 있는 경우가
// 732세션 중 24건(3.3%). 그래서 여기서는 종합 verdict 를 "개별 severity 의 최댓값"으로
// **계산**한다 — 낮출 조건문 자체가 없다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClaimService } from '../../src/modules/task/claim.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { QuestionService } from '../../src/modules/approval/question.service.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
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
  const attachments = new AttachmentService(null as never, drizzleDb);
  specs = new SpecService(
    events,
    checks,
    new SpecRelationService(drizzleDb),
    new SpecCommentService(events, drizzleDb),
    attachments,
    drizzleDb,
  );
  tasks = new TaskService(
    new ClaimService(),
    events,
    new QuestionService(events, drizzleDb),
    new SessionService(events, drizzleDb, new ClaimService()),
    // 플랜 승인 게이트가 카드를 만드는 자리 — 이 스위트는 그 게이트에 닿지 않지만
    // 서비스는 들고 있어야 한다(AuthService 는 이 경로에서 쓰이지 않는다)
    new ApprovalService(events, specs, null as never, drizzleDb),
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
  // **FK 순서대로 지운다.** task.source_requirement_id 가 requirement 를 참조하므로 Task 를
  // 먼저 지워야 한다 — 순서가 뒤집혀 있으면 요구사항에 매달린 Task 를 만드는 검사 하나가
  // 그 뒤 스위트 전체를 FK 위반으로 무너뜨린다(2026-09-07 실측).
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM review_session');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
});

async function draft(key: string, body: string): Promise<{ specId: string; versionId: string }> {
  const result = await specs.draftUpsert({
    roles: ['planner'],
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
    // **검사기로 골라 본다.** `findings[0]` 은 검사기가 늘어날 때마다 깨지는 단언이고,
    // 실제로 cross-spec 이 "아무와도 이어지지 않았다"를 내기 시작하자 깨졌다(2026-08-30)
    const shape = result.findings.filter((f) => f.checker === 'requirement-shape');
    expect(shape[0]?.anchor).toBe('REQ-CWC-034');
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

/**
 * **구현 축은 파생값이다**(D-03 · 2026-09-07 · REQ-API-141). `verified` 는 오래 "스키마가
 * 담지 못한다" 고 적혀 있었는데 열은 처음부터 있었다(`evidence.verified_by` ·
 * `finding.requirement_id`) — QA 페르소나의 유일한 판정에 길이 없었다.
 */
/**
 * **EARS 를 배울 자리**(2026-09-07 · REQ-API-144·145). 형식을 어긴 줄은 잡으면서 줄이 아예
 * 없는 것은 잡지 않았고(sudoku 승인본 65건에 요구사항 0건), 다음 번호를 발급하는 자리도
 * 없었다 — 비전이 "서버가 발급한 고정 ID" 를 적어 두었는데.
 */
describe('요구사항 작성 표면 (REQ-API-144·145)', () => {
  it('요구사항이 한 줄도 없는 feature 문서는 경고를 받는다', async () => {
    const { versionId } = await draft('SPC-EMPTY-REQ', '# 문서\n\n본문만 있고 약속이 없다');
    const result = await checks.check({ projectId, specVersionId: versionId });
    const shape = result.findings.filter((f) => f.checker === 'requirement-shape');
    expect(shape).toHaveLength(1);
    expect(shape[0]).toMatchObject({ severity: 'warning', anchor: null });
    // 경고지 차단이 아니다 — 임포트한 문서가 전부 막히면 이관 자체가 멈춘다
    expect(result.verdict).not.toBe('block');
  });

  it('요구사항이 있으면 그 경고는 없다', async () => {
    const { versionId } = await draft(
      'SPC-HAS-REQ',
      '# 문서\n\n- REQ-HAS-001 WHEN 조건이면 THE SYSTEM SHALL 동작한다',
    );
    const result = await checks.check({ projectId, specVersionId: versionId });
    expect(result.findings.filter((f) => f.checker === 'requirement-shape')).toEqual([]);
  });

  it('다음 ID 는 서버가 발급한다 — 접두의 최대 번호 다음이다', async () => {
    const first = await specs.nextRequirementRef({ projectId, prefix: 'NEW' });
    expect(first.ref).toBe('REQ-NEW-001');

    const { specId, versionId } = await draft('SPC-REF-SEQ', '# 문서');
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-NEW-007','문장','must',$4,$4)`,
      [newId(), projectId, specId, versionId],
    );
    expect((await specs.nextRequirementRef({ projectId, prefix: 'new' })).ref).toBe('REQ-NEW-008');
  });

  it('접두가 어휘 밖이면 거절한다 — 조용히 고쳐 주지 않는다', async () => {
    await expect(specs.nextRequirementRef({ projectId, prefix: '' })).rejects.toMatchObject({
      details: { kind: 'invalid_input', field: 'prefix' },
    });
  });
});

describe('구현 축 파생 — verified 와 회수 (REQ-API-141)', () => {
  async function requirementWithTask(
    ref: string,
    taskStatus = 'in_progress',
  ): Promise<{ requirementId: string; taskId: string }> {
    const { specId, versionId } = await draft(`SPC-${ref}`, '# 문서');
    const requirementId = newId();
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,$4,'WHEN x THE SYSTEM SHALL y','must',$5,$5)`,
      [requirementId, projectId, specId, ref, versionId],
    );
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_requirement_id,
                         goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,'작업',$4::task_status,$5,'목표','PR','도구','경계')`,
      [taskId, projectId, `TSK-${ref}`, taskStatus, requirementId],
    );
    return { requirementId, taskId };
  }

  async function statusOf(requirementId: string): Promise<string | null> {
    const { rows } = await pool.query<{ s: string }>(
      `SELECT impl_status::text AS s FROM requirement WHERE id = $1`,
      [requirementId],
    );
    return rows[0]?.s ?? null;
  }

  it('검증 증적이 서명돼 있고 열린 critical 이 없으면 verified 다', async () => {
    const { requirementId, taskId } = await requirementWithTask('REQ-VER-1');
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source, verified_by, verified_at)
       VALUES ($1,$2,$3,'test','spec-check.spec.ts','agent',$4,now())`,
      [newId(), projectId, taskId, planner],
    );
    await tasks.transition({
      projectId,
      taskId,
      status: 'done',
      userId: planner,
      roles: ['planner'],
      specImpact: { none: true },
    });
    expect(await statusOf(requirementId)).toBe('verified');
  });

  it('서명 없는 증적은 implemented 까지다 — 검증은 사람이 한 것이어야 한다', async () => {
    const { requirementId, taskId } = await requirementWithTask('REQ-VER-2');
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'test','spec-check.spec.ts','agent')`,
      [newId(), projectId, taskId],
    );
    await tasks.transition({
      projectId,
      taskId,
      status: 'done',
      userId: planner,
      roles: ['planner'],
      specImpact: { none: true },
    });
    expect(await statusOf(requirementId)).toBe('implemented');
  });

  it('열린 critical 발견이 있으면 verified 가 아니다', async () => {
    const { requirementId, taskId } = await requirementWithTask('REQ-VER-3');
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source, verified_by, verified_at)
       VALUES ($1,$2,$3,'test','t','agent',$4,now())`,
      [newId(), projectId, taskId, planner],
    );
    // 발견은 리뷰 라운드에 매달린다 — 최소 라운드를 하나 세운다
    const sessionRow = newId();
    await pool.query(
      `INSERT INTO review_session (id, project_id, kind, trigger, branch, head_sha, base_sha,
                                   changeset_hash)
       VALUES ($1,$2,'code','manual','main','abc123','def456',$3::bytea)`,
      [sessionRow, projectId, Buffer.from('changeset')],
    );
    await pool.query(
      `INSERT INTO finding (id, project_id, requirement_id, severity, status, title,
                            fingerprint, category, first_session_id, last_session_id)
       VALUES ($1,$2,$3,'critical','open','열린 지적',$4::bytea,'correctness',$5,$5)`,
      [newId(), projectId, requirementId, Buffer.from('critical-open-1'), sessionRow],
    );
    await tasks.transition({
      projectId,
      taskId,
      status: 'done',
      userId: planner,
      roles: ['planner'],
      specImpact: { none: true },
    });
    expect(await statusOf(requirementId)).toBe('implemented');
  });

  it('전이가 구현 축을 움직인다 — done 만이 아니다', async () => {
    const { requirementId, taskId } = await requirementWithTask('REQ-DERIVE-1', 'ready');
    expect(await statusOf(requirementId)).toBe('unimplemented');

    await tasks.transition({
      projectId,
      taskId,
      status: 'in_progress',
      userId: planner,
      roles: ['planner'],
    });
    expect(await statusOf(requirementId)).toBe('in_progress');
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
    const error = (await tasks
      .transition({
        projectId,
        taskId,
        status: 'done',
        userId: planner,
        // 사람 경로의 done 은 담당자·클레임 보유자·planner·admin 만이다(REQ-API-130) —
        // 이 스위트가 보려는 것은 게이트이므로 역할을 명시한다
        roles: ['planner'],
        evidence: [{ kind: 'pr', locator: 'https://pr/1' }],
      })
      .catch((e: unknown) => e)) as { details: Record<string, unknown> };
    expect((error.details['missing'] as string[]).join()).toContain('spec_impact');
  });

  it('증적이 없으면 done 으로 갈 수 없다 — 조건 4', async () => {
    const taskId = await readyTask();
    const error = (await tasks
      .transition({
        projectId,
        taskId,
        status: 'done',
        userId: planner,
        // 사람 경로의 done 은 담당자·클레임 보유자·planner·admin 만이다(REQ-API-130) —
        // 이 스위트가 보려는 것은 게이트이므로 역할을 명시한다
        roles: ['planner'],
        specImpact: { none: true },
      })
      .catch((e: unknown) => e)) as { details: Record<string, unknown> };
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
        // 사람 경로의 done 은 담당자·클레임 보유자·planner·admin 만이다(REQ-API-130) —
        // 이 스위트가 보려는 것은 게이트이므로 역할을 명시한다
        roles: ['planner'],
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
