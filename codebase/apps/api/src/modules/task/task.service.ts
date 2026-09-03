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
  taskStatus,
  text,
} from '@nerv/schema';
import { decodeCursor, encodeCursor, pageLimit } from '../../common/cursor.js';
import { displayKey } from '@nerv/schema/keys';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { entityRef } from '../../common/entity-ref.js';
import { InjectDb, toDate } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

/** 트랜잭션 핸들 — spec.service.ts 와 같은 방식으로 유도한다 */
type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import { QuestionService } from '../approval/question.service.js';
import { SessionService } from '../session/session.service.js';
import { ClaimService } from './claim.service.js';
import type { ClaimScope, Overlap } from './claim.service.js';

/** 클레임을 만지는 주체 — 전표의 "보유자"·"admin" 판정에 필요한 것 전부다 */
export interface ClaimActor {
  projectId: string;
  userId: string;
  /** 에이전트 세션. 사람의 REST 호출에는 없다 */
  sessionId: string | null;
  isAdmin: boolean;
}

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
  /** 기준 문서를 여는 데 필요한 것 — `nerv_spec_get(spec_key, version_no)` 가 그대로 받는다 */
  spec_key: string | null;
  version_no: number | null;
  /** 앞 사람이 `nerv_task_release(state_note)` 로 남긴 인수인계 노트 */
  handoff_note: string | null;
}

/**
 * Task 한 건을 가리키는 조건 — **키와 UUID 를 둘 다 받는다**(§1.4b).
 * 아무 문자열이나 `::uuid` 로 캐스팅하면 22P02 가 나고, 그건 "못 찾았다"가 아니라 500 이다.
 */
function taskMatch(ref: string): SQL {
  const parsed = entityRef(ref);
  return parsed.id === null ? sql`t.key = ${ref}` : sql`t.id = ${parsed.id}`;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly claims: ClaimService,
    private readonly events: EventService,
    private readonly questions: QuestionService,
    // 지시 역채널 — 세션이 그것을 들고 있다(SessionModule → TaskModule 방향은 없어 순환이 아니다)
    private readonly sessions: SessionService,
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
             t.source_spec_version_id, t.baseline_id,
             -- **기준 문서를 열 수 있게 한다**(REQ-API-081). 조인은 처음부터 있었는데 sv 에서
             -- 아무것도 고르지 않아, 스킬 6단계("기준 버전으로 nerv_spec_get")를 응답만으로는
             -- 수행할 수 없었다 — id 는 있는데 키와 판 번호가 없었다.
             s.key AS spec_key, sv.version_no,
             -- 앞 사람이 남긴 인수인계 노트 — "왜 내려놨나" 가 후보 목록에서 보여야 한다
             (SELECT c.release_note FROM claim c
               WHERE c.task_id = t.id AND c.release_note IS NOT NULL
               ORDER BY c.released_at DESC NULLS LAST LIMIT 1) AS handoff_note
        FROM task t
        LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
        LEFT JOIN spec s ON s.id = sv.spec_id
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
    // **키든 UUID 든 받는다**(§1.4b). 예전에는 UUID 만 받았는데, 사람과 화면과 도구가
    // 쓰는 것은 안정 키다 — 키를 넣으면 조용히 0건이 되어 "그 스펙에 Task 가 없다" 로 읽혔다.
    const specRef = entityRef(input.specId ?? null);
    const spec =
      specRef.id === null && specRef.key === null
        ? sql``
        : specRef.id !== null
          ? sql` AND sv.spec_id = ${specRef.id}`
          : sql` AND sv.spec_id = (SELECT id FROM spec
                                    WHERE project_id = ${input.projectId} AND key = ${specRef.key})`;

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
             t.assignee_user_id, u.display_name AS assignee_name,
             t.rebrief_required_at, t.blocked_reason, t.updated_at,
             s.key AS spec_key, sv.version_no AS basis_version_no,
             (sv.status = 'superseded') AS basis_superseded,
             c.id AS claim_id, c.agent_session_id AS claim_session_id, c.lease_expires_at,
             (t.goal_md IS NOT NULL AND t.output_format_md IS NOT NULL
              AND t.tools_sources_md IS NOT NULL AND t.boundaries_md IS NOT NULL) AS delegation_complete
        FROM task t
   -- 담당자는 **이름으로** 준다. id 만 주면 화면이 아무것도 못 그리고, 목록마다
   -- 사용자를 다시 조회하면 N+1 이다(2026-08-23 — 보드 아바타).
   LEFT JOIN "user" u ON u.id = t.assignee_user_id
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
  /**
   * EP-TASK-02 — Task 한 건. **키든 UUID 든 받는다**(§1.4b).
   *
   * 예전에는 키만 받았다 — 그런데 옆의 `nerv_task_claim`·`nerv_task_update` 는 둘 다
   * 받으므로, 같은 이름의 인자가 도구마다 다른 것을 뜻하는 상태였다(스펙 축에서 이미
   * 한 번 고친 종류다).
   */
  async get(input: { projectId: string; taskKey: string }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.*, t.status::text AS status, t.priority::text AS priority,
             s.key AS spec_key, sv.version_no AS basis_version_no,
             (sv.status = 'superseded') AS basis_superseded
        FROM task t
   LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
   LEFT JOIN spec s ON s.id = sv.spec_id
       WHERE t.project_id = ${input.projectId} AND ${taskMatch(input.taskKey)}
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
        // 화면의 쿼리 키 축은 안정 키다(`CLV-T-…`) — UUID 만 실으면 단건 캐시가
        // 무효화되지 않아 작업 상세가 열린 채로 낡는다(screens.md §1.4)
        subjectKey: key,
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
          subjectKey: input.taskKey,
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
  /**
   * 참조(`CLV-T-…` 키 또는 UUID)를 Task UUID 로 바꾼다(§1.4b).
   *
   * 사람과 화면과 로그가 쓰는 것은 키인데 도구는 UUID 만 받고 있었다 — 에이전트가 화면에서
   * 본 값을 그대로 넣으면 "없는 작업"이 된다. 형태로 갈라 둘 다 받는다.
   */
  private async resolveTaskId(tx: Tx, projectId: string, ref: string): Promise<string> {
    const parsed = entityRef(ref);
    // **UUID 도 프로젝트 안에서 해소한다.** 예전에는 UUID 면 그대로 돌려줬고, 그래서
    // `claim` 의 FOR UPDATE 조회가 남의 프로젝트 Task 를 잠그고 그 프로젝트 id 로
    // 클레임·이벤트를 적었다(`transition` 은 같은 파일에서 이미 경계를 보고 있었다).
    const { rows } = await tx.execute<{ id: string }>(
      parsed.id !== null
        ? sql`SELECT id FROM task WHERE project_id = ${projectId} AND id = ${parsed.id}`
        : sql`SELECT id FROM task WHERE project_id = ${projectId} AND key = ${parsed.key ?? ''}`,
    );
    const found = rows[0]?.id;
    if (found === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_found'), {
        kind: 'not_found',
        task: ref,
      });
    }
    return found;
  }

  /** scope 의 스펙 참조를 UUID 로 — 키와 UUID 를 섞어 줘도 된다(§1.4b). */
  private async resolveSpecIds(tx: Tx, projectId: string, refs: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const ref of refs) {
      const parsed = entityRef(ref);
      if (parsed.id !== null) {
        out.push(parsed.id);
        continue;
      }
      if (parsed.key === null) continue;
      const { rows } = await tx.execute<{ id: string }>(
        sql`SELECT id FROM spec WHERE project_id = ${projectId} AND key = ${parsed.key}`,
      );
      const found = rows[0]?.id;
      if (found === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
          kind: 'not_found',
          spec: parsed.key,
        });
      }
      out.push(found);
    }
    return out;
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const ttl = input.leaseSeconds ?? LEASE_TTL_SECONDS;

    return this.events.transact(async (tx, emit) => {
      // 0) 대상 행 잠금 — 키로 왔으면 먼저 UUID 로 바꾼다(§1.4b)
      const taskId = await this.resolveTaskId(tx, input.projectId, input.taskId);
      // scope 의 스펙도 같은 규칙이다 — 키로 선언해도 겹침 판정이 UUID 로 돌아야 한다.
      // 여기서 안 풀면 `::uuid[]` 캐스팅에서 22P02 가 나고, 그건 "못 찾았다"가 아니라 500 이다.
      const scope = {
        ...input.scope,
        specIds: await this.resolveSpecIds(tx, input.projectId, input.scope.specIds),
      };
      const { rows: taskRows } = await tx.execute<{
        id: string;
        status: string;
        project_id: string;
        source_requirement_id: string | null;
        goal_md: string | null;
        output_format_md: string | null;
        tools_sources_md: string | null;
        boundaries_md: string | null;
      }>(sql`SELECT * FROM task WHERE id = ${taskId} FOR UPDATE`);

      const task = taskRows[0];
      if (task === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.not_found'), {
          kind: 'not_found',
          task_id: taskId,
        });
      }

      // 같은 세션의 재호출은 기존 클레임을 그대로 돌려준다(멱등 — agent-integration §2.3)
      const existing = await this.findOwnActiveClaim(tx, taskId, input.sessionId);
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
        sql`SELECT status::text AS status FROM task WHERE id = ${taskId}`,
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
        scope,
        sourceRequirementId: task.source_requirement_id,
      });

      // 3) 차단 판정 — 같은 스펙 문서를 두 세션이 동시 개정하는 경우로 한정
      const blocking = overlaps.filter((o) => o.severity === 'block');
      if (blocking.length > 0) {
        // 차단도 사실이므로 기록한다. 롤백되므로 이 이벤트는 별도 트랜잭션에서 남긴다.
        this.logger.warn(`클레임 차단 — task=${taskId} 겹침 ${blocking.length}건`);
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
         WHERE id = ${taskId} AND status = 'ready'
        RETURNING id
      `);
      if (updated.length === 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.claim.taken'), {
          kind: 'lost_race',
        });
      }

      const claim = await this.claims.insertClaim(tx, {
        projectId: task.project_id,
        taskId: taskId,
        sessionId: input.sessionId,
        userId: input.userId,
        scope,
        ttlSeconds: ttl,
      });

      await emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId: task.project_id,
        subjectType: 'task',
        subjectId: taskId,
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
   * **이 클레임은 부른 쪽의 것인가**(EP-TASK-07·08).
   *
   * 예전에는 `claim_id` 하나면 충분했다 — 프로젝트도, 세션도, 사용자도 보지 않았다.
   * 클레임 UUID 는 이벤트 피드·화면·로그에 그대로 실리는 값이라 비밀이 아니고, 그래서
   * 같은 프로젝트의 다른 멤버가 남의 리스를 연장하고(그리고 그 세션 앞으로 온 steer·stop 을
   * **소비하고**) 남의 클레임을 해제해 Task 를 ready 로 되돌릴 수 있었다.
   *
   * 보유자는 **그 클레임을 쥔 세션**이고, 세션이 없는 경로(사람의 REST)에서는 그 클레임을
   * 만든 사용자다. admin 은 해제만 할 수 있다 — 전표가 그렇게 적었다.
   */
  private async assertClaimOwner(
    claimId: string,
    actor: ClaimActor,
    action: 'heartbeat' | 'release',
  ): Promise<{ agentSessionId: string | null }> {
    const { rows } = await this.db.execute<{
      project_id: string;
      user_id: string;
      agent_session_id: string | null;
    }>(sql`SELECT project_id, user_id, agent_session_id FROM claim WHERE id = ${claimId}`);
    const claim = rows[0];
    if (claim === undefined || claim.project_id !== actor.projectId) {
      // 남의 프로젝트 클레임은 **없는 것**이다 — 존재를 알려 주지 않는다
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.claim.not_active'), {
        kind: 'not_active',
        claim_id: claimId,
      });
    }

    const bySession = actor.sessionId !== null && claim.agent_session_id === actor.sessionId;
    const byUser = claim.user_id === actor.userId;
    const byAdmin = action === 'release' && actor.isAdmin;
    if (!bySession && !byUser && !byAdmin) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.claim.not_owner'), {
        kind: 'not_owner',
        claim_id: claimId,
      });
    }
    return { agentSessionId: claim.agent_session_id };
  }

  /**
   * 하트비트 — 리스 연장 + **서버 → 세션 방향의 유일한 보장된 채널**이다(agent-integration §2.4).
   * 질문 답변·steer/stop 지시가 여기 실린다. Claude 의 channel capability 는 향상이고
   * 하트비트가 정본이다(Codex 에는 채널이 없다).
   */
  async heartbeat(input: {
    claimId: string;
    /** 전표의 "클레임 보유자"(EP-TASK-07) — 부른 주체다 */
    actor: ClaimActor;
    leaseSeconds?: number;
    /** 한 줄 진행 요약 — 이력이 아니라 **지금 무엇을 하는 중인가**라 덮어쓴다(LWW) */
    progress?: string | null;
    /** 세션 카드의 +N −M — 카탈로그가 처음부터 적고 있던 셋(REQ-API-081) */
    stats?: { added?: number; removed?: number; files?: number } | null;
  }): Promise<{ leaseExpiresAt: Date; pending: unknown[] }> {
    const owned = await this.assertClaimOwner(input.claimId, input.actor, 'heartbeat');

    const leaseExpiresAt = await this.db.transaction(async (tx) =>
      this.claims.renewLease(tx, input.claimId, input.leaseSeconds),
    );

    if (input.progress != null && input.progress !== '') {
      await this.db.execute(
        sql`UPDATE claim SET progress_note = ${input.progress} WHERE id = ${input.claimId}`,
      );
    }

    // 역채널 — 답변된 질문을 여기 싣는다. Claude 의 channel capability 는 향상이고
    // 하트비트가 정본이다(Codex 에는 채널이 없다). 여기 실리지 않으면 에이전트는 모른다.
    const sessionId = owned.agentSessionId;
    if (sessionId === null) return { leaseExpiresAt, pending: [] };

    // **세션 카드의 +N −M 이 여기서 채워진다.** 열은 처음부터 있었고 읽는 화면도 있었는데
    // 쓰는 곳이 없어 실사용 세션 34개 전부 `+0 −0` 이었다(실측 2026-09-03). 하트비트는
    // 자연 멱등(LWW)이라 마지막 값이 곧 현재 값이다 — 누적이 아니라 덮어쓰기다.
    const stats = input.stats ?? null;
    if (stats !== null) {
      await this.db.execute(sql`
        UPDATE agent_session
           SET diff_added = coalesce(${num(stats.added)}::int, diff_added),
               diff_removed = coalesce(${num(stats.removed)}::int, diff_removed),
               diff_files = coalesce(${num(stats.files)}::int, diff_files)
         WHERE id = ${sessionId}
      `);
    }

    // **사람이 보낸 지시도 여기 실린다**(2026-09-01 · REQ-API-072).
    //
    // `steer`/`stop` 은 `activity` 에 `delivered: false` 로 잘 적히고 있었는데, 그것을
    // 걷어 오는 `takePendingInstructions` 를 **아무도 부르지 않았다** — 화면은 "다음
    // 하트비트에 전달됩니다" 라고 약속하는데 그 하트비트가 지시를 싣지 않았다.
    // 보낸 사람은 보냈다고 믿고, 에이전트는 영영 듣지 못한다.
    const [answers, instructions] = await Promise.all([
      this.questions.pendingFor(sessionId),
      this.sessions.takePendingInstructions(sessionId),
    ]);
    // 지시가 앞이다 — stop 은 지금 하던 것을 멈추라는 말이라 답변보다 먼저 읽혀야 한다
    return { leaseExpiresAt, pending: [...instructions, ...answers] };
  }

  /**
   * **이 Task 를 옮길 수 있는 사람인가**(EP-TASK-09 "담당자·planner·admin").
   *
   * 예전에는 아무 검사가 없었다 — 활성 클레임을 다른 세션이 쥐고 있어도, 내 리스가 이미
   * 만료돼 그 사이 다른 세션이 같은 Task 를 잡았어도, `done` 으로 옮길 수 있었다.
   * 그러면 "활성 소유자는 한 명" 이라는 클레임 모델의 전제가 상태 축에서 무너진다.
   *
   * 활성 클레임이 없으면 판정하지 않는다 — 아직 아무도 잡지 않은 Task 를 사람이 옮기는
   * 것은 정상 경로다(위임 명세를 채우고 backlog 를 정리하는 일).
   */
  private async assertMayTransition(
    tx: Tx,
    taskId: string,
    input: { userId: string; sessionId?: string | null; roles?: readonly string[] },
  ): Promise<void> {
    const { rows } = await tx.execute<{
      agent_session_id: string | null;
      user_id: string;
      expired: boolean;
    }>(sql`
      SELECT agent_session_id, user_id, lease_expires_at <= now() AS expired
        FROM claim WHERE task_id = ${taskId} AND status = 'active' LIMIT 1
    `);
    const claim = rows[0];
    if (claim === undefined) return;

    const mine =
      (input.sessionId != null && claim.agent_session_id === input.sessionId) ||
      claim.user_id === input.userId;
    // planner·admin 은 남의 작업도 정리할 수 있다(전표의 "담당자·planner·admin")
    const privileged = (input.roles ?? []).some((r) => r === 'planner' || r === 'admin');

    if (!mine && !privileged) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.task.not_assignee'), {
        kind: 'not_assignee',
        task_id: taskId,
      });
    }
    // 만료된 리스로는 옮기지 못한다 — 그 사이 다른 세션이 이 Task 를 잡았을 수 있다
    if (mine && !privileged && claim.expired) {
      throw new NervError(NERV_ERROR.LEASE_EXPIRED, msg('error.claim.lease_expired'), {
        kind: 'lease_expired',
        task_id: taskId,
      });
    }
  }

  /** 클레임 해제 — reason 에 따라 Task 를 ready 로 회수하거나 그대로 둔다. */
  async release(input: {
    claimId: string;
    reason: 'done' | 'handoff' | 'abandon';
    userId: string;
    /**
     * 인수인계 노트(REQ-API-081). 카탈로그는 처음부터 이 입력과 "인수인계 노트" 출력을
     * 적고 있었지만 저장할 열이 없어 **성공 응답과 함께 버려졌다** — 에이전트는 노트를
     * 남겼다고 믿고 다음 사람은 빈 Task 를 집었다(실측 2026-09-03).
     */
    stateNote?: string | null;
    /** 전표의 "클레임 보유자 또는 admin"(EP-TASK-08) */
    actor: ClaimActor;
  }): Promise<{ taskStatus: string; state_note: string | null }> {
    await this.assertClaimOwner(input.claimId, input.actor, 'release');
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        task_id: string;
        project_id: string;
        agent_session_id: string | null;
        release_note: string | null;
      }>(sql`
        UPDATE claim
           SET status = 'released', released_at = now(),
               release_reason = ${input.reason === 'done' ? 'done' : 'manual'},
               -- 빈 노트로 앞의 노트를 지우지 않는다 — 인계는 덧쓰기가 아니라 남기는 일이다
               release_note = coalesce(${input.stateNote ?? null}::text, release_note)
         WHERE id = ${input.claimId} AND status = 'active'
        RETURNING task_id, project_id, agent_session_id, release_note
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

      return { taskStatus, state_note: claim.release_note };
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
    /** 전표의 "담당자·planner·admin" 판정 축 — 표면이 실어 준다 */
    roles?: readonly string[];
    specImpact?: Record<string, unknown> | null;
    blockedReason?: string | null;
    evidence?: { kind: string; locator: string }[];
  }): Promise<{ status: string; gate?: { ok: boolean; missing: string[] } }> {
    return this.events.transact(async (tx, emit) => {
      // 키로 왔든 UUID 로 왔든 같은 작업을 가리킨다(§1.4b)
      const taskId = await this.resolveTaskId(tx, input.projectId, input.taskId);
      const { rows } = await tx.execute<{ status: string; project_id: string; key: string }>(
        sql`SELECT status::text AS status, project_id, key FROM task WHERE id = ${taskId} FOR UPDATE`,
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

      // **어휘 안의 값만 받는다.** 예전에는 입력을 그대로 `::task_status` 로 캐스팅해
      // 오타 하나가 500(22P02)이 됐다 — 그것은 "그런 상태는 없다" 가 아니라 서버 오류다.
      if (!(taskStatus.enumValues as readonly string[]).includes(input.status)) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
          kind: 'invalid_input',
          field: 'status',
          allowed: taskStatus.enumValues,
          value: input.status,
        });
      }

      // **끝난 일은 조용히 되살아나지 않는다.** done 은 게이트를 통과해 닫힌 상태이고
      // (증적·spec_impact) 그것을 지나 되돌리는 것은 새 결정이라 이 문으로 하지 않는다.
      if (task.status === 'done') {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.done_is_final'), {
          kind: 'not_allowed',
          from: task.status,
          to: input.status,
        });
      }

      await this.assertMayTransition(tx, taskId, input);

      for (const item of input.evidence ?? []) {
        await tx.execute(sql`
          INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
          VALUES (${newId()}, ${input.projectId}, ${taskId}, ${item.kind}::evidence_kind,
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
           WHERE id = ${taskId}
        `);
        await emit({
          type: NERV_EVENT.TASK_DONE,
          projectId: input.projectId,
          subjectType: 'task',
          subjectId: taskId,
          subjectKey: task.key,
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
         WHERE id = ${taskId}
      `);
      await emit({
        type: input.status === 'blocked' ? NERV_EVENT.TASK_BLOCKED : NERV_EVENT.TASK_UPDATED,
        projectId: input.projectId,
        subjectType: 'task',
        subjectId: taskId,
        subjectKey: task.key,
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

/**
 * 통계 값 하나 — 숫자가 아니면 `null` 이라 `coalesce` 가 이전 값을 지킨다.
 *
 * 셋 중 하나만 보낸 하트비트가 나머지 둘을 0 으로 지우면, 화면의 `+0 −0` 은 "변경이 없다"
 * 가 아니라 "말하지 않았다" 를 뜻하게 된다 — 두 가지는 다르게 보여야 한다.
 */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}
