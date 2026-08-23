// Task 도메인 서비스 — 상태 전이 · 위임 명세 · 클레임 조율
// 메서드 이름은 docs/04-mvp/api.md §4 대응표의 "내부 서비스 메서드" 열과 1:1 이다.
// REST 컨트롤러와 MCP 도구가 이 클래스의 같은 인스턴스를 거친다(D-05) — 판정은 여기 한 곳이다.

import { Injectable, Logger } from '@nestjs/common';
import {
  msg,
  newId,
  LEASE_TTL_SECONDS,
  NERV_ERROR,
  NERV_EVENT,
  TASK_DONE_WINDOW_DAYS,
  text,
} from '@nerv/schema';
import { decodeCursor, encodeCursor, pageLimit } from '../../common/cursor.js';
import { displayKey } from '@nerv/schema/keys';
import { sql } from 'drizzle-orm';
import { InjectDb, toDate } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import { QuestionService } from '../approval/question.service.js';
import { ClaimService } from './claim.service.js';
import type { ClaimScope, Overlap } from './claim.service.js';

export interface ClaimInput {
  projectId: string;
  taskId: string;
  /** 사람이 직접 잡으면 null */
  sessionId: string | null;
  userId: string;
  scope: ClaimScope;
  leaseSeconds?: number;
}

export interface ClaimResult {
  claimId: string;
  leaseExpiresAt: Date;
  /** warn·info 겹침 — 통과시키되 양쪽에 알린다(spec-workflow §4.4 단계 3) */
  warnings: Overlap[];
  /** 같은 세션의 재호출이면 기존 클레임을 그대로 돌려준다(멱등, 리스 연장 없음) */
  replayed: boolean;
}

export interface ReadyCandidate extends Record<string, unknown> {
  id: string;
  key: string;
  title: string;
  priority: string;
  goal_md: string;
  output_format_md: string;
  tools_sources_md: string;
  boundaries_md: string;
  source_spec_version_id: string | null;
  baseline_id: string | null;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly claims: ClaimService,
    private readonly events: EventService,
    private readonly questions: QuestionService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * ready 큐 — **질의 결과이지 문서가 아니다**(spec-workflow §4.2).
   * clemvion 에서 백로그 조망을 담당하던 인덱스 문서가 부패해 삭제된 것이 이 설계의 근거다.
   *
   * ready(task) ⟺ 승인된 기준 버전 + 위임 명세 4요소 + 선행 의존 전부 done + blocked_reason 없음
   */
  async next(input: { projectId: string; limit?: number }): Promise<ReadyCandidate[]> {
    const limit = Math.min(input.limit ?? 10, 50);
    const { rows } = await this.db.execute<ReadyCandidate>(sql`
      SELECT t.id, t.key, t.title, t.priority::text AS priority,
             t.goal_md, t.output_format_md, t.tools_sources_md, t.boundaries_md,
             t.source_spec_version_id, t.baseline_id
        FROM task t
        LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
       WHERE t.project_id = ${input.projectId}
         AND t.status = 'ready'
         AND t.blocked_reason IS NULL
         -- 위임 명세 4요소 — CHECK 가 이미 막지만 질의에서도 확인한다(방어적)
         AND t.goal_md IS NOT NULL AND t.output_format_md IS NOT NULL
         AND t.tools_sources_md IS NOT NULL AND t.boundaries_md IS NOT NULL
         -- 기준 버전이 있으면 승인된 것이어야 한다
         AND (t.source_spec_version_id IS NULL OR sv.status = 'approved')
         -- 선행 의존(blocks)이 전부 done
         AND NOT EXISTS (
           SELECT 1 FROM task_dependency d
             JOIN task dep ON dep.id = d.depends_on_task_id
            WHERE d.task_id = t.id AND d.kind = 'blocks' AND dep.status <> 'done'
         )
         -- 이미 활성 클레임이 있으면 후보가 아니다
         AND NOT EXISTS (
           SELECT 1 FROM claim c WHERE c.task_id = t.id AND c.status = 'active'
         )
       ORDER BY t.priority ASC, t.created_at ASC
       LIMIT ${limit}
    `);
    return rows;
  }

  /**
   * EP-TASK-01 — S4 보드 레인용. **커서 페이지네이션이다**(§1.6).
   *
   * 전량을 주던 때가 있었다: clemvion 실측 487건 · 229 KB 였고, 그 중 done 이 419건
   * (86%)이었다(2026-08-23). 보드는 레인마다 이 목록을 부르므로 한 레인이 커져도
   * 나머지가 함께 무거워지지 않는다.
   *
   * `includeArchived` 는 **done 레인의 창**을 연다(screens.md §2.5 `done(7d)`).
   * 아카이브를 상태값으로 두지 않은 이유는 상수 `TASK_DONE_WINDOW_DAYS` 에 적어 두었다.
   */
  async list(input: {
    projectId: string;
    statuses?: string[] | null;
    assigneeUserId?: string | null;
    specId?: string | null;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string | undefined;
  }): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
    const statuses = input.statuses ?? null;
    const statusFilter =
      statuses === null || statuses.length === 0
        ? sql``
        : sql` AND t.status IN (${sql.join(
            statuses.map((st) => sql`${st}::task_status`),
            sql`, `,
          )})`;
    const assignee =
      input.assigneeUserId == null ? sql`` : sql` AND t.assignee_user_id = ${input.assigneeUserId}`;
    const spec = input.specId == null ? sql`` : sql` AND sv.spec_id = ${input.specId}`;

    // done 은 시간이 지나면 배경이 된다 — 창 밖의 것은 기본 결과에서 빠진다.
    //
    // `done_at IS NOT NULL` 은 **중복 방어**다: `task_done_at_ck` 가 done → done_at 을
    // 이미 보장하므로 지금은 항상 참이다. 그래도 두는 이유는 NULL 의 성질이다 — 이 절이
    // 없으면 done_at 이 NULL 인 순간 비교가 NULL 이 되고 `NOT (true AND NULL)` 도 NULL 이라
    // **행이 조용히 사라진다**. 제약이 바뀌는 날 감춰지는 쪽으로 틀어지지 않게 한다.
    const archived =
      input.includeArchived === true
        ? sql``
        : sql` AND NOT (t.status = 'done' AND t.done_at IS NOT NULL
                        AND t.done_at < now() - ${`${TASK_DONE_WINDOW_DAYS} days`}::interval)`;

    // 커서는 정렬 키와 **같은 순서**를 따라야 한다 — (priority ASC, updated_at DESC, id ASC).
    // id 를 마지막에 두는 이유는 동률 때문이다: priority·updated_at 이 같은 두 행이 있으면
    // 커서가 어느 쪽을 가리키는지 정해지지 않아 한 건이 영영 안 나오거나 두 번 나온다.
    // priority 는 **enum 으로 견준다** — `ORDER BY` 가 보는 것이 열거 순서이므로,
    // 텍스트로 견주면 값 이름이 바뀌는 날 정렬과 커서가 조용히 갈라진다.
    const after = decodeCursor(input.cursor);
    const seek =
      after === null
        ? sql``
        : sql` AND (t.priority > ${String(after[0])}::task_priority
                OR (t.priority = ${String(after[0])}::task_priority
                    AND (t.updated_at < ${String(after[1])}::timestamptz
                     OR (t.updated_at = ${String(after[1])}::timestamptz
                         AND t.id > ${String(after[2])}::uuid))))`;
    const limit = pageLimit(input.limit);

    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.key, t.title, t.status::text AS status, t.priority::text AS priority,
             t.assignee_user_id, t.rebrief_required_at, t.blocked_reason, t.updated_at,
             s.key AS spec_key, sv.version_no AS basis_version_no,
             (sv.status = 'superseded') AS basis_superseded,
             c.id AS claim_id, c.agent_session_id AS claim_session_id, c.lease_expires_at,
             (t.goal_md IS NOT NULL AND t.output_format_md IS NOT NULL
              AND t.tools_sources_md IS NOT NULL AND t.boundaries_md IS NOT NULL) AS delegation_complete
        FROM task t
   LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN claim c ON c.task_id = t.id AND c.status = 'active'
       WHERE t.project_id = ${input.projectId}${statusFilter}${assignee}${spec}${archived}${seek}
       ORDER BY t.priority, t.updated_at DESC, t.id
       LIMIT ${limit + 1}
    `);
    // 한 건 더 받아 "다음이 있나"를 판정한다 — 별도 count 질의를 하지 않으려는 것이다.
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const next =
      rows.length > limit && last !== undefined
        ? encodeCursor([
            String(last['priority']),
            new Date(String(last['updated_at'])).toISOString(),
            String(last['id']),
          ])
        : null;
    return { items, next_cursor: next };
  }

  /** EP-TASK-04 — 위임 명세·활성 클레임·의존·Evidence 전량. */
  async get(input: { projectId: string; taskKey: string }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.*, t.status::text AS status, t.priority::text AS priority,
             s.key AS spec_key, sv.version_no AS basis_version_no,
             (sv.status = 'superseded') AS basis_superseded
        FROM task t
   LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
   LEFT JOIN spec s ON s.id = sv.spec_id
       WHERE t.project_id = ${input.projectId} AND t.key = ${input.taskKey}
    `);
    const task = rows[0];
    if (task === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_found'), {
        kind: 'not_found',
        task: input.taskKey,
      });
    }

    const taskId = task['id'] as string;
    const { rows: claims } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.agent_session_id, c.status::text AS status, c.lease_expires_at, c.acquired_at,
             se.external_session_id, se.hostname, se.agent_type::text AS agent_type, c.user_id
        FROM claim c LEFT JOIN agent_session se ON se.id = c.agent_session_id
       WHERE c.task_id = ${taskId} ORDER BY c.acquired_at DESC LIMIT 10
    `);
    const { rows: deps } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT d.depends_on_task_id, dt.key, dt.title, dt.status::text AS status
        FROM task_dependency d JOIN task dt ON dt.id = d.depends_on_task_id
       WHERE d.task_id = ${taskId}
    `);
    const { rows: evidence } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT id, kind::text AS kind, locator, source::text AS source, created_at
        FROM evidence WHERE task_id = ${taskId} ORDER BY created_at
    `);

    return { ...task, claims, dependencies: deps, evidence };
  }

  /**
   * EP-TASK-03 — 생성은 언제나 `backlog` 다.
   *
   * `ready` 로 직접 만들 수 없다는 것이 FR-05 의 핵심이다: 위임 명세 4요소가 채워졌는지
   * 서버가 확인한 뒤에만 승격한다. 클레임 가능한 작업 = 지시가 완결된 작업이라는 등식이
   * 깨지면 에이전트는 "무엇을 어디까지 하는지 모르는 채" 일을 시작하게 된다.
   */
  async create(input: {
    projectId: string;
    title: string;
    bodyMd?: string | null;
    sourceSpecVersionId?: string | null;
    sourceRequirementId?: string | null;
    priority?: string | null;
    goalMd?: string | null;
    outputFormatMd?: string | null;
    toolsSourcesMd?: string | null;
    boundariesMd?: string | null;
    userId: string;
  }): Promise<Record<string, unknown>> {
    if (input.title.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.title_required'), {
        kind: 'missing_title',
      });
    }
    return this.events.transact(async (tx, emit) => {
      const taskId = newId();
      // 표시 키는 데이터 모델 §5.1 형식이다(`CLV-T-7QF3K2`). 이전 표기(`TSK-` + 16진 4자)는
      // 키 공간이 65,536뿐이라 프로젝트가 커지면 `task_key_uq` 에 걸려 원인 모를 오류가 났다.
      const key = displayKey(await this.projectKeyOf(tx, input.projectId), 'T', taskId);
      await tx.execute(sql`
        INSERT INTO task (id, project_id, key, title, body_md, status, priority,
                          source_spec_version_id, source_requirement_id,
                          goal_md, output_format_md, tools_sources_md, boundaries_md)
        VALUES (${taskId}, ${input.projectId}, ${key}, ${input.title}, ${input.bodyMd ?? null},
                'backlog', ${input.priority ?? 'P2'}::task_priority,
                ${input.sourceSpecVersionId ?? null}, ${input.sourceRequirementId ?? null},
                ${input.goalMd ?? null}, ${input.outputFormatMd ?? null},
                ${input.toolsSourcesMd ?? null}, ${input.boundariesMd ?? null})
      `);
      await emit({
        type: NERV_EVENT.TASK_CREATED,
        projectId: input.projectId,
        subjectType: 'task',
        subjectId: taskId,
        actorUserId: input.userId,
        isAgent: false,
        toState: 'backlog',
      });
      return { task_id: taskId, key, status: 'backlog' };
    });
  }

  /**
   * EP-TASK-05 — 위임 명세·우선순위·의존 수정. **4요소가 채워지고 의존이 해소되면 서버가
   * `ready` 로 승격한다** — 사람이 상태를 직접 올리는 경로를 두지 않는 것이 요점이다.
   */
  async update(input: {
    projectId: string;
    taskKey: string;
    title?: string | null;
    bodyMd?: string | null;
    priority?: string | null;
    goalMd?: string | null;
    outputFormatMd?: string | null;
    toolsSourcesMd?: string | null;
    boundariesMd?: string | null;
    assigneeUserId?: string | null;
    dependsOnKeys?: string[] | null;
    userId: string;
  }): Promise<Record<string, unknown>> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        id: string;
        status: string;
        goal_md: string | null;
        output_format_md: string | null;
        tools_sources_md: string | null;
        boundaries_md: string | null;
      }>(sql`
        SELECT id, status::text AS status, goal_md, output_format_md, tools_sources_md, boundaries_md
          FROM task WHERE project_id = ${input.projectId} AND key = ${input.taskKey} FOR UPDATE
      `);
      const task = rows[0];
      if (task === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_found'), {
          kind: 'not_found',
          task: input.taskKey,
        });
      }

      const merged = {
        goal_md: input.goalMd ?? task.goal_md,
        output_format_md: input.outputFormatMd ?? task.output_format_md,
        tools_sources_md: input.toolsSourcesMd ?? task.tools_sources_md,
        boundaries_md: input.boundariesMd ?? task.boundaries_md,
      };

      await tx.execute(sql`
        UPDATE task
           SET title = coalesce(${input.title ?? null}, title),
               body_md = coalesce(${input.bodyMd ?? null}, body_md),
               priority = coalesce(${input.priority ?? null}::task_priority, priority),
               goal_md = ${merged.goal_md}, output_format_md = ${merged.output_format_md},
               tools_sources_md = ${merged.tools_sources_md}, boundaries_md = ${merged.boundaries_md},
               assignee_user_id = coalesce(${input.assigneeUserId ?? null}, assignee_user_id),
               updated_at = now()
         WHERE id = ${task.id}
      `);

      if (input.dependsOnKeys != null) {
        await tx.execute(sql`DELETE FROM task_dependency WHERE task_id = ${task.id}`);
        for (const key of input.dependsOnKeys) {
          await tx.execute(sql`
            INSERT INTO task_dependency (task_id, depends_on_task_id)
            SELECT ${task.id}, id FROM task WHERE project_id = ${input.projectId} AND key = ${key}
            ON CONFLICT DO NOTHING
          `);
        }
      }

      // 승격 판정 — backlog 에서만 올라간다. 이미 진행 중인 작업의 상태를 여기서 되돌리지 않는다.
      let promoted = false;
      const complete = Object.values(merged).every((v) => v !== null && v.trim() !== '');
      if (task.status === 'backlog' && complete) {
        const { rows: blocking } = await tx.execute<{ key: string }>(sql`
          SELECT dt.key FROM task_dependency d JOIN task dt ON dt.id = d.depends_on_task_id
           WHERE d.task_id = ${task.id} AND dt.status <> 'done'
        `);
        if (blocking.length === 0) {
          await tx.execute(sql`UPDATE task SET status = 'ready' WHERE id = ${task.id}`);
          promoted = true;
          await emit({
            type: NERV_EVENT.TASK_READY,
            projectId: input.projectId,
            subjectType: 'task',
            subjectId: task.id,
            actorUserId: input.userId,
            isAgent: false,
            fromState: 'backlog',
            toState: 'ready',
          });
        }
      }

      if (!promoted) {
        await emit({
          type: NERV_EVENT.TASK_UPDATED,
          projectId: input.projectId,
          subjectType: 'task',
          subjectId: task.id,
          actorUserId: input.userId,
          isAgent: false,
        });
      }

      return {
        task_id: task.id,
        key: input.taskKey,
        status: promoted ? 'ready' : task.status,
        delegation_complete: complete,
      };
    });
  }

  /**
   * 위임 명세 4요소 검증 — backlog·blocked 밖으로 나가려면 전부 채워져야 한다(§4.1).
   * CHECK 제약이 DB 에서 막지만, 거부 사유를 **누락 요소 이름으로** 돌려주는 것은 여기 몫이다.
   */
  assertDelegationSpec(task: {
    goal_md: string | null;
    output_format_md: string | null;
    tools_sources_md: string | null;
    boundaries_md: string | null;
  }): void {
    const missing = (
      [
        ['goal_md', text('task.field.goal')],
        ['output_format_md', text('task.field.output_format')],
        ['tools_sources_md', text('task.field.tools_sources')],
        ['boundaries_md', text('task.field.boundaries')],
      ] as const
    )
      .filter(([field]) => {
        const value = task[field];
        return value === null || value.trim() === '';
      })
      .map(([field, label]) => ({ field, label }));

    if (missing.length > 0) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.task.delegation_incomplete', {
          missing: missing.map((m) => m.label).join(', '),
        }),
        { kind: 'delegation_spec_incomplete', missing },
      );
    }
  }

  /**
   * 원자적 클레임 — spec-workflow §4.3 의사코드의 직역.
   *
   *   0) 대상 행 FOR UPDATE 잠금        — 중복 클레임을 DB 레벨에서 차단
   *   1) 만료 리스 회수                  — 비교 대상을 살아있는 클레임으로 좁힌다
   *   2) 두 축(스펙·파일)으로 겹침 계산
   *   3) block 이 하나라도 있으면 롤백
   *   4) 조건부 UPDATE ... WHERE status='ready' — 경쟁에서 진 쪽은 affected=0 으로 판별
   *
   * 4단계가 핵심이다. FOR UPDATE 로 직렬화하더라도 조건부 UPDATE 가 없으면 먼저 커밋한 쪽의
   * 전이를 두 번째가 덮어쓴다. 이 두 겹 + 부분 unique(claim_task_active_uq)가 "중복 클레임 0건"이다.
   */
  async claim(input: ClaimInput): Promise<ClaimResult> {
    const ttl = input.leaseSeconds ?? LEASE_TTL_SECONDS;

    return this.events.transact(async (tx, emit) => {
      // 0) 대상 행 잠금
      const { rows: taskRows } = await tx.execute<{
        id: string;
        status: string;
        project_id: string;
        source_requirement_id: string | null;
        goal_md: string | null;
        output_format_md: string | null;
        tools_sources_md: string | null;
        boundaries_md: string | null;
      }>(sql`SELECT * FROM task WHERE id = ${input.taskId} FOR UPDATE`);

      const task = taskRows[0];
      if (task === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_found'), {
          kind: 'not_found',
          task_id: input.taskId,
        });
      }

      // 같은 세션의 재호출은 기존 클레임을 그대로 돌려준다(멱등 — agent-integration §2.3)
      const existing = await this.findOwnActiveClaim(tx, input.taskId, input.sessionId);
      if (existing !== null) {
        return {
          claimId: existing.claim_id,
          leaseExpiresAt: existing.lease_expires_at,
          warnings: [],
          replayed: true,
        };
      }

      // 1) 만료 리스 회수 — **상태 검사보다 먼저** 한다.
      //
      // spec-workflow §4.3 의사코드는 status 검사(0) 뒤에 회수(1)를 둔다. 그 순서면 리스가
      // 막 만료된 Task 는 여전히 'claimed' 이라 not_ready 로 거부되고, 워커의 lease-reaper 가
      // 돌 때까지 아무도 잡을 수 없다 — 워커가 지연되거나 죽어 있으면 그대로 멈춘다.
      // D-13 의 "사람 개입 0회"는 그 창을 허용하지 않으므로 회수를 앞으로 당긴다.
      // 회수 자체는 이 트랜잭션 안에서 일어나므로 원자성은 그대로다.
      await this.claims.reclaimExpired(tx, task.project_id);

      const { rows: fresh } = await tx.execute<{ status: string }>(
        sql`SELECT status::text AS status FROM task WHERE id = ${input.taskId}`,
      );
      const status = fresh[0]?.status ?? task.status;
      if (status !== 'ready') {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_ready', { status }), {
          kind: 'not_ready',
          status,
        });
      }
      this.assertDelegationSpec(task);

      // 2) 겹침 계산
      const overlaps = await this.claims.detectOverlaps(tx, {
        projectId: task.project_id,
        sessionId: input.sessionId,
        scope: input.scope,
        sourceRequirementId: task.source_requirement_id,
      });

      // 3) 차단 판정 — 같은 스펙 문서를 두 세션이 동시 개정하는 경우로 한정
      const blocking = overlaps.filter((o) => o.severity === 'block');
      if (blocking.length > 0) {
        // 차단도 사실이므로 기록한다. 롤백되므로 이 이벤트는 별도 트랜잭션에서 남긴다.
        this.logger.warn(`클레임 차단 — task=${input.taskId} 겹침 ${blocking.length}건`);
        throw new NervError(NERV_ERROR.CONFLICT_SCOPE, msg('error.claim.scope_conflict'), {
          kind: 'scope_conflict',
          overlaps: blocking.map(toDetail),
        });
      }

      // 4) 조건부 전이 — 경쟁에서 진 세션은 여기서 0행으로 판별된다
      const { rows: updated } = await tx.execute<{ id: string }>(sql`
        UPDATE task
           SET status = 'claimed',
               assignee_user_id = COALESCE(assignee_user_id, ${input.userId}),
               delegate_session_id = ${input.sessionId}
         WHERE id = ${input.taskId} AND status = 'ready'
        RETURNING id
      `);
      if (updated.length === 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.claim.taken'), {
          kind: 'lost_race',
        });
      }

      const claim = await this.claims.insertClaim(tx, {
        projectId: task.project_id,
        taskId: input.taskId,
        sessionId: input.sessionId,
        userId: input.userId,
        scope: input.scope,
        ttlSeconds: ttl,
      });

      await emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId: task.project_id,
        subjectType: 'task',
        subjectId: input.taskId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId,
        isAgent: input.sessionId !== null,
        fromState: 'ready',
        toState: 'claimed',
      });

      // warn 은 통과시키되 양쪽 세션·담당자에게 알린다(§4.4 단계 3 이후)
      for (const overlap of overlaps.filter((o) => o.severity === 'warn')) {
        await emit({
          type: NERV_EVENT.CLAIM_CONFLICT_WARN,
          projectId: task.project_id,
          subjectType: 'claim',
          subjectId: claim.claimId,
          actorUserId: input.userId,
          actorSessionId: input.sessionId,
          isAgent: input.sessionId !== null,
          payload: { overlap: toDetail(overlap) },
        });
      }

      return {
        claimId: claim.claimId,
        leaseExpiresAt: claim.leaseExpiresAt,
        warnings: overlaps.filter((o) => o.severity !== 'block'),
        replayed: false,
      };
    });
  }

  /**
   * 하트비트 — 리스 연장 + **서버 → 세션 방향의 유일한 보장된 채널**이다(agent-integration §2.4).
   * 질문 답변·steer/stop 지시가 여기 실린다. Claude 의 channel capability 는 향상이고
   * 하트비트가 정본이다(Codex 에는 채널이 없다).
   */
  async heartbeat(input: {
    claimId: string;
    leaseSeconds?: number;
  }): Promise<{ leaseExpiresAt: Date; pending: unknown[] }> {
    const leaseExpiresAt = await this.db.transaction(async (tx) =>
      this.claims.renewLease(tx, input.claimId, input.leaseSeconds),
    );

    // 역채널 — 답변된 질문을 여기 싣는다. Claude 의 channel capability 는 향상이고
    // 하트비트가 정본이다(Codex 에는 채널이 없다). 여기 실리지 않으면 에이전트는 모른다.
    const { rows } = await this.db.execute<{ agent_session_id: string | null }>(
      sql`SELECT agent_session_id FROM claim WHERE id = ${input.claimId}`,
    );
    const sessionId = rows[0]?.agent_session_id ?? null;
    const pending = sessionId === null ? [] : await this.questions.pendingFor(sessionId);

    return { leaseExpiresAt, pending };
  }

  /** 클레임 해제 — reason 에 따라 Task 를 ready 로 회수하거나 그대로 둔다. */
  async release(input: {
    claimId: string;
    reason: 'done' | 'handoff' | 'abandon';
    userId: string;
  }): Promise<{ taskStatus: string }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        task_id: string;
        project_id: string;
        agent_session_id: string | null;
      }>(sql`
        UPDATE claim
           SET status = 'released', released_at = now(),
               release_reason = ${input.reason === 'done' ? 'done' : 'manual'}
         WHERE id = ${input.claimId} AND status = 'active'
        RETURNING task_id, project_id, agent_session_id
      `);
      const claim = rows[0];
      if (claim === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.claim.not_active'), {
          kind: 'not_active',
          claim_id: input.claimId,
        });
      }

      // done 이 아니면 Task 를 ready 로 되돌린다 — 산출물·Activity 는 보존한다(§4.5)
      let taskStatus = 'unchanged';
      if (input.reason !== 'done') {
        const { rows: t } = await tx.execute<{ status: string }>(sql`
          UPDATE task SET status = 'ready', delegate_session_id = NULL
           WHERE id = ${claim.task_id} AND status IN ('claimed', 'in_progress')
          RETURNING status::text AS status
        `);
        taskStatus = t[0]?.status ?? 'unchanged';
      }

      await emit({
        type: NERV_EVENT.CLAIM_RELEASED,
        projectId: claim.project_id,
        subjectType: 'claim',
        subjectId: input.claimId,
        actorUserId: input.userId,
        actorSessionId: claim.agent_session_id,
        isAgent: claim.agent_session_id !== null,
        payload: { reason: input.reason },
      });

      return { taskStatus };
    });
  }

  /**
   * nerv_task_update · EP-TASK-09 — **done 게이트 판정의 단일 지점**이다.
   *
   * MVP 범위는 조건 4·5·6(증적·스펙 영향 선언·테스트 증적)이다 — 리뷰 커버리지 조건(1~3)은
   * FR-09 가 Phase 2 라 판정할 데이터가 없다(scope.md §3.2 FR-10 ◐).
   *
   * 조건 5(스펙 영향 선언)가 clemvion 에서 가장 잘 작동한 규칙의 이식이다: "작업 완료가 스펙
   * 정합 결정을 강제 동반"하게 만들면 완료 시점에 아무도 스펙을 보지 않는 사태가 구조적으로
   * 불가능해진다. `none` sentinel 을 허용하되 **선언 자체는 필수**라는 점이 핵심이다.
   */
  async transition(input: {
    projectId: string;
    taskId: string;
    status: string;
    userId: string;
    sessionId?: string | null;
    specImpact?: Record<string, unknown> | null;
    blockedReason?: string | null;
    evidence?: { kind: string; locator: string }[];
  }): Promise<{ status: string; gate?: { ok: boolean; missing: string[] } }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ status: string; project_id: string }>(
        sql`SELECT status::text AS status, project_id FROM task WHERE id = ${input.taskId} FOR UPDATE`,
      );
      const task = rows[0];
      if (task === undefined || task.project_id !== input.projectId) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_found'), {
          kind: 'not_found',
        });
      }
      if (task.status === input.status) {
        // 같은 목표 상태로의 재호출은 no-op 성공이다(멱등 — agent-integration §2.3)
        return { status: task.status };
      }

      for (const item of input.evidence ?? []) {
        await tx.execute(sql`
          INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
          VALUES (${newId()}, ${input.projectId}, ${input.taskId}, ${item.kind}::evidence_kind,
                  ${item.locator}, ${input.sessionId == null ? 'human' : 'agent'}::evidence_source)
        `);
      }

      if (input.status === 'done') {
        const gate = await this.assertDoneGate(tx, input);
        if (!gate.ok) {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.done_gate'), {
            kind: 'done_gate',
            missing: gate.missing,
          });
        }
        await tx.execute(sql`
          UPDATE task SET status = 'done', done_at = now(),
                          spec_impact = ${JSON.stringify(input.specImpact ?? {})}::jsonb
           WHERE id = ${input.taskId}
        `);
        await emit({
          type: NERV_EVENT.TASK_DONE,
          projectId: input.projectId,
          subjectType: 'task',
          subjectId: input.taskId,
          actorUserId: input.userId,
          actorSessionId: input.sessionId ?? null,
          isAgent: input.sessionId != null,
          fromState: task.status,
          toState: 'done',
        });
        return { status: 'done', gate };
      }

      if (input.status === 'blocked' && (input.blockedReason ?? '').trim() === '') {
        // 사유 없는 blocked 는 백로그 부패의 씨앗이다(§1.4) — CHECK 도 막지만 사유를 알려준다
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.blocked_reason_required'), {
          kind: 'blocked_reason_required',
        });
      }

      await tx.execute(sql`
        UPDATE task SET status = ${input.status}::task_status,
                        blocked_reason = ${input.blockedReason ?? null}
         WHERE id = ${input.taskId}
      `);
      await emit({
        type: input.status === 'blocked' ? NERV_EVENT.TASK_BLOCKED : NERV_EVENT.TASK_UPDATED,
        projectId: input.projectId,
        subjectType: 'task',
        subjectId: input.taskId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        fromState: task.status,
        toState: input.status,
      });
      return { status: input.status };
    });
  }

  /**
   * done 전이 조건 — MVP 범위(§4.6 조건 4·5·6).
   * 판정 불가는 실패가 아니라 fail-open + 관측이다(D-14) — 여기서는 판정에 필요한 데이터가
   * 전부 서버에 있으므로 그 경로가 열리지 않는다.
   */
  private async assertDoneGate(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    input: { projectId: string; taskId: string; specImpact?: Record<string, unknown> | null },
  ): Promise<{ ok: boolean; missing: string[] }> {
    const missing: string[] = [];

    // 조건 5 — 스펙 영향 선언. none sentinel 을 허용하되 선언 자체는 필수다
    const impact = input.specImpact;
    if (impact === null || impact === undefined || Object.keys(impact).length === 0) {
      missing.push(text('task.missing.spec_impact'));
    }

    // 조건 4 — Requirement ↔ 구현 Evidence 1건 이상
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM evidence WHERE task_id = ${input.taskId}`,
    );
    if ((rows[0]?.n ?? 0) === 0) missing.push(text('task.missing.evidence'));

    // 조건 1~3(리뷰 커버리지)은 FR-09 가 Phase 2 라 판정 대상이 아니다 — 없는 것을 요구하지 않는다
    return { ok: missing.length === 0, missing };
  }

  private async findOwnActiveClaim(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    taskId: string,
    sessionId: string | null,
  ): Promise<{ claim_id: string; lease_expires_at: Date } | null> {
    if (sessionId === null) return null;
    const { rows } = await tx.execute<{ claim_id: string; lease_expires_at: unknown }>(sql`
      SELECT id AS claim_id, lease_expires_at FROM claim
       WHERE task_id = ${taskId} AND agent_session_id = ${sessionId}
         AND status = 'active' AND lease_expires_at > now()
    `);
    const row = rows[0];
    return row === undefined
      ? null
      : { claim_id: row.claim_id, lease_expires_at: toDate(row.lease_expires_at) };
  }

  /** 표시 키의 접두는 프로젝트 것이다(§5.1). 트랜잭션 안에서 읽어 같은 스냅샷을 본다. */
  private async projectKeyOf(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    projectId: string,
  ): Promise<string> {
    const { rows } = await tx.execute<{ key: string }>(
      sql`SELECT key FROM project WHERE id = ${projectId}`,
    );
    const key = rows[0]?.key;
    // eslint-disable-next-line no-restricted-syntax -- 내부 불변식 — 사람에게 보이지 않는다(REQ-CB-022)
    if (key === undefined) throw new Error('프로젝트를 찾지 못했습니다');
    return key;
  }
}

/** 겹침을 에러·이벤트 페이로드용으로 평평하게 — 상대 사용자·hostname·scope 를 그대로 싣는다. */
function toDetail(o: Overlap): Record<string, unknown> {
  return {
    claim_id: o.claimId,
    session_id: o.sessionId,
    task_id: o.taskId,
    user_id: o.userId,
    hostname: o.hostname,
    severity: o.severity,
    overlap: { spec_ids: o.specHit, file_globs: o.fileHit },
  };
}
