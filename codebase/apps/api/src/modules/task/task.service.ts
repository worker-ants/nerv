// Task 도메인 서비스 — 상태 전이 · 위임 명세 · 클레임 조율
// 메서드 이름은 docs/04-mvp/api.md §4 대응표의 "내부 서비스 메서드" 열과 1:1 이다.
// REST 컨트롤러와 MCP 도구가 이 클래스의 같은 인스턴스를 거친다(D-05) — 판정은 여기 한 곳이다.

import { Injectable, Logger } from '@nestjs/common';
import {
  CLAIM_RELEASE_INPUTS,
  evidenceKind,
  LEASE_TTL_SECONDS,
  msg,
  NERV_ERROR,
  NERV_EVENT,
  newId,
  BLOCKED_REASONS,
  checkEvidenceLocator,
  GatePolicySchema,
  isDelegationFilled,
  PLAN_APPROVAL_SIBLINGS,
  TASK_LEASE_BOUND_TARGETS,
  TASK_TRANSITION_TARGETS,
  TASK_DONE_WINDOW_DAYS,
  taskPriority,
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
import { assertVocab } from '../../common/query-vocab.js';
import { EventService } from '../event/event.service.js';
import { QuestionService } from '../approval/question.service.js';
import { ApprovalService } from '../approval/approval.service.js';
import { recomputeImplStatus } from '../spec/impl-status.js';
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

/** 전이 판정이 읽는 활성 클레임 한 행 — 보유자·세션·리스 만료 여부만 본다. */
interface ActiveClaimGuard extends Record<string, unknown> {
  id: string;
  agent_session_id: string | null;
  user_id: string;
  expired: boolean;
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
  baseline: string | null;
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
    // 플랜 승인 카드를 만드는 자리 — 결재를 만드는 규칙은 저 서비스 한 곳이다(D-05)
    private readonly approvals: ApprovalService,
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
             t.source_spec_version_id, t.baseline_id, bl.name AS baseline,
             -- **기준 문서를 열 수 있게 한다**(REQ-API-081). 조인은 처음부터 있었는데 sv 에서
             -- 아무것도 고르지 않아, 스킬 6단계("기준 버전으로 nerv_spec_get")를 응답만으로는
             -- 수행할 수 없었다 — id 는 있는데 키와 버전 번호가 없었다.
             s.key AS spec_key, sv.version_no,
             -- 앞 사람이 남긴 인수인계 노트 — "왜 내려놨나" 가 후보 목록에서 보여야 한다
             (SELECT c.release_note FROM claim c
               WHERE c.task_id = t.id AND c.release_note IS NOT NULL
               ORDER BY c.released_at DESC NULLS LAST LIMIT 1) AS handoff_note
        FROM task t
        LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
        LEFT JOIN spec s ON s.id = sv.spec_id
        LEFT JOIN spec_baseline bl ON bl.id = t.baseline_id
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
       -- 미표기(NULL)는 맨 뒤다 — PG 의 ASC 기본이 NULLS LAST 이고 그것이 우리가 원하는 것이다
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
    /** `?ai=1` — 에이전트 세션이 쥔 것만(`delegate_session_id`) */
    agentOnly?: boolean;
    specId?: string | null;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string | undefined;
  }): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
    // 모르는 상태는 거절이지 무시가 아니다(§1.4j) — 예전에는 그대로 `::task_status` 로
    // 캐스팅해 **사용자의 오타가 500** 이 됐다(라이브 실측 2026-09-03: `?status=doing`).
    const statuses =
      input.statuses == null ? null : assertVocab(input.statuses, taskStatus.enumValues, 'status');
    const statusFilter =
      statuses === null || statuses.length === 0
        ? sql``
        : sql` AND t.status IN (${sql.join(
            statuses.map((st) => sql`${st}::task_status`),
            sql`, `,
          )})`;
    const assignee =
      input.assigneeUserId == null ? sql`` : sql` AND t.assignee_user_id = ${input.assigneeUserId}`;
    /**
     * `?ai=1` — **에이전트 세션이 쥐고 있는 작업**(2026-09-06 · REQ-API-122).
     *
     * 뜻을 못 박는다: `delegate_session_id` 가 있는 것이지 `assignee_user_id` 로 사람이
     * 지정된 것이 아니다. 보드가 답하는 물음이 **"지금 무엇이 도는가"** 이기 때문이고,
     * 정의를 적어 두지 않으면 같은 이름이 두 뜻을 갖게 된다 — 이 저장소가 "스코프" 에서
     * 한 이름이 세 가지를 가리키는 것을 이미 겪었다.
     */
    const agent = input.agentOnly !== true ? sql`` : sql` AND t.delegate_session_id IS NOT NULL`;
    // **키든 UUID 든 받는다**(§1.4b). 예전에는 UUID 만 받았는데, 사람과 화면과 도구가
    // 쓰는 것은 고정 ID다 — 키를 넣으면 조용히 0건이 되어 "그 스펙에 Task 가 없다" 로 읽혔다.
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
    //
    // **우선순위는 NULL 일 수 있다**(2026-09-07 · 0024). 미표기는 `P2` 의 축약이 아니라
    // 표기가 없었다는 사실이고, `ORDER BY t.priority` 는 그것을 맨 뒤로 보낸다(PG 의 ASC
    // 기본이 NULLS LAST 다). 커서도 **그 정렬을 술어로 그대로** 써야 한다 — 행 비교
    // (`>`)는 NULL 앞에서 UNKNOWN 이 되어 남은 쪽을 통째로 잃는다.
    const after = decodeCursor(input.cursor);
    const afterPriority = after === null || after[0] === null ? null : String(after[0]);
    const tail =
      after === null
        ? sql``
        : sql`(t.updated_at < ${String(after[1])}::timestamptz
            OR (t.updated_at = ${String(after[1])}::timestamptz
                AND t.id > ${String(after[2])}::uuid))`;
    const seek =
      after === null
        ? sql``
        : afterPriority === null
          ? // 이미 NULL 무리 안이다 — 그 뒤는 같은 무리의 나머지뿐이다
            sql` AND t.priority IS NULL AND ${tail}`
          : // NULL 은 모든 값보다 뒤이므로 **무조건** 다음 쪽에 든다
            sql` AND (t.priority IS NULL
                  OR t.priority > ${afterPriority}::task_priority
                  OR (t.priority = ${afterPriority}::task_priority AND ${tail}))`;
    const limit = pageLimit(input.limit);

    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.key, t.title, t.status::text AS status, t.priority::text AS priority,
             t.assignee_user_id, u.display_name AS assignee_name,
             t.rebrief_required_at, t.blocked_reason, t.updated_at,
             s.key AS spec_key, s.id AS source_spec_id, sv.version_no AS basis_version_no,
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
       WHERE t.project_id = ${input.projectId}${statusFilter}${assignee}${agent}${spec}${archived}${seek}
       ORDER BY t.priority, t.updated_at DESC, t.id
       LIMIT ${limit + 1}
    `);
    // 한 건 더 받아 "다음이 있나"를 판정한다 — 별도 count 질의를 하지 않으려는 것이다.
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const next =
      rows.length > limit && last !== undefined
        ? encodeCursor([
            // 미표기는 커서에서도 NULL 이다 — 문자열 'null' 로 접으면 다음 쪽이 어긋난다
            last['priority'] == null ? null : String(last['priority']),
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
             (sv.status = 'superseded') AS basis_superseded,
             -- **근거는 사람 말로 보여야 한다**(2026-09-07 · REQ-API-142). 화면이 UUID 원문을
             -- 그리던 자리다 — 요구사항의 고정 ID(REQ-…)가 사람이 아는 이름이다.
             r.ref AS source_requirement_ref, r.statement_md AS source_requirement_statement
        FROM task t
   LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN requirement r ON r.id = t.source_requirement_id
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
             se.external_session_id, se.hostname, se.agent_type::text AS agent_type, c.user_id,
             -- 선언한 범위 — 겹침 판정이 보는 것이 무엇인지 사람도 봐야 한다(SCR-07)
             c.scope_spec_ids, c.scope_file_globs
        FROM claim c LEFT JOIN agent_session se ON se.id = c.agent_session_id
       WHERE c.task_id = ${taskId} ORDER BY c.acquired_at DESC LIMIT 10
    `);
    // **리뷰는 Task 에서 보인다**(2026-09-07 · REQ-API-142 · FR-13 양방향 드릴다운).
    // 리뷰 → Task 방향은 있었는데 그 반대가 응답에 없어, 작업 상세에서 "이 작업이 리뷰를
    // 지났는가" 를 알 길이 없었다 — done 게이트가 그것을 조건으로 삼는데도 그랬다.
    const { rows: reviews } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT rs.id, rs.kind::text AS kind, rs.branch, rs.head_sha, rs.round_no,
             rs.state::text AS state, rs.completed_at,
             (SELECT count(*)::int FROM finding f
               WHERE f.last_session_id = rs.id AND f.severity = 'critical' AND f.status = 'open'
             ) AS open_critical
        FROM review_session rs
       WHERE rs.task_id = ${taskId}
       ORDER BY rs.round_no DESC LIMIT 10
    `);
    const { rows: deps } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT d.depends_on_task_id, d.kind::text AS kind, dt.key, dt.title, dt.status::text AS status
        FROM task_dependency d JOIN task dt ON dt.id = d.depends_on_task_id
       WHERE d.task_id = ${taskId}
    `);
    // **`repo` 도 싣는다**(2026-09-10 · REQ-API-157). 열은 "멀티 저장소 대비" 로 처음부터
    // 있었고 GitHub 웹훅이 `repository.full_name` 을 채우는데(`webhook.service.ts`),
    // 상세가 그것을 고르지 않아 화면은 증적 전부를 **프로젝트의 저장소 하나**로 읽었다 —
    // 저장소가 둘 이상인 프로젝트에서 커밋 링크가 조용히 남의 저장소를 가리킨다.
    const { rows: evidence } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT id, kind::text AS kind, locator, repo, source::text AS source, created_at
        FROM evidence WHERE task_id = ${taskId} ORDER BY created_at
    `);

    return {
      ...task,
      claims,
      reviews,
      dependencies: deps,
      evidence,
      blocked_resolution: await this.blockedResolution(taskId, task, deps),
    };
  }

  /**
   * 무엇이 되면 이 작업이 풀리는가 — **파생이다. 저장하는 열이 아니다**
   * (2026-09-06 사람 결정 · REQ-API-118).
   *
   * 정본([3.5 스펙 워크플로우](spec-workflow.md) §2)은 `blocked` 진입에 "사유 코드와
   * **해소 조건**을 필수로 받는다" 고 적는다. 사유 코드는 어휘 4종으로 닫혔는데
   * (REQ-API-117), 해소 조건은 받을 열이 없었다.
   *
   * **열을 만들지 않은 이유.** 사유마다 해소 원천이 **이미 저장에 있다** — 질문은
   * `question.task_id`, 의존은 `task_dependency`, 기준 버전은 `rebrief_required_at`.
   * 여기에 `blocked_resolution_task_id` 같은 열을 하나 더 두면 **같은 사실에 포인터가
   * 둘**이 되고 둘은 언젠가 갈라진다(기준선/베이스라인 165곳 · 스코프 한 이름 세 뜻이
   * 그 자국이다). 게다가 그 열은 넷 중 하나에만 맞고 나머지 셋에는 NULL 이 들어간다 —
   * **넷 중 셋이 비는 열은 계약이 아니라 흔적**이다.
   *
   * 파생이라 얻는 것이 하나 더 있다: 서버가 **"이제 풀 수 있다" 를 판정할 수 있다.**
   * 지금은 `blocked_reason` 을 아무도 자동으로 지우지 않아, 선행 의존이 `done` 이 되어도
   * 사람이 손으로 전이를 다시 눌러야 풀린다 — 화면이 그것을 말해 줄 수 있게 된다.
   *
   * **`satisfied: null` 은 "아니다" 가 아니라 "서버가 판정할 수 없다" 다.** `external`
   * 은 저장소 밖의 사정이라 파생할 원천이 없고, `spec_conflict` 는 기준 버전이 밀려나
   * 있지 **않으면** 서버가 아는 신호가 없다(스펙이 틀렸다는 판단은 사람의 것이다).
   * 모르는 것을 `false` 로 적으면 화면은 그것을 "아직 막혀 있다" 로 읽는다.
   */
  private async blockedResolution(
    taskId: string,
    task: Record<string, unknown>,
    deps: Record<string, unknown>[],
  ): Promise<Record<string, unknown> | null> {
    const reason = task['blocked_reason'];
    if (typeof reason !== 'string' || reason === '') return null;

    if (reason === 'awaiting_answer') {
      const { rows } = await this.db.execute<Record<string, unknown>>(sql`
        SELECT id, title, status::text AS status, urgency::text AS urgency
          FROM question WHERE task_id = ${taskId} AND status = 'open'
         ORDER BY created_at
      `);
      return {
        reason,
        source: 'question',
        satisfied: rows.length === 0,
        pending: rows.map((q) => ({ kind: 'question', ...q })),
      };
    }

    if (reason === 'dependency_broken') {
      // **`blocks` 만 센다** — ready 판정이 보는 것과 같은 조건이다(`next()`).
      // 두 자리가 다른 조건을 쓰면 화면이 "풀 수 있다" 는데 큐는 안 올려 준다.
      const pending = deps.filter((d) => d['kind'] === 'blocks' && d['status'] !== 'done');
      return {
        reason,
        source: 'task_dependency',
        satisfied: pending.length === 0,
        pending: pending.map((d) => ({
          kind: 'task',
          id: d['depends_on_task_id'],
          key: d['key'],
          title: d['title'],
          status: d['status'],
        })),
      };
    }

    if (reason === 'spec_conflict') {
      const superseded = task['basis_superseded'] === true;
      const rebrief = task['rebrief_required_at'] != null;
      if (!superseded && !rebrief) {
        // 기준 버전이 멀쩡한데 스펙과 어긋난다는 것은 **사람의 판단**이다 — 서버는 모른다
        return { reason, source: null, satisfied: null, pending: [] };
      }
      return {
        reason,
        source: 'spec_version',
        satisfied: false,
        pending: [
          {
            kind: 'spec_version',
            id: task['source_spec_version_id'],
            key: task['spec_key'],
            version_no: task['basis_version_no'],
            superseded,
            rebrief_required: rebrief,
          },
        ],
      };
    }

    // external — 저장소 밖의 사정이라 가리킬 것이 없다. 자유 텍스트가 정직한 유일한 자리다
    return { reason, source: null, satisfied: null, pending: [] };
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
    /**
     * 기준 기준선 **이름**(REQ-API-087 · spec-workflow §4.1).
     *
     * 기준 버전이 "이 문서의 어느 버전" 이라면 기준선은 "**주변 문서까지 포함한 어느
     * 세트**" 다. 문서 하나의 핀만으로는 그것이 참조하는 문서들의 기준이 흔들린다.
     */
    baseline?: string | null;
    priority?: string | null;
    goalMd?: string | null;
    outputFormatMd?: string | null;
    toolsSourcesMd?: string | null;
    boundariesMd?: string | null;
    userId: string;
  }): Promise<Record<string, unknown>> {
    // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
    const priority = assertVocab([input.priority ?? 'P2'], taskPriority.enumValues, 'priority')[0];
    // 이름을 id 로 바꾼다 — 없는 이름은 여기서 걸린다(조용히 NULL 로 만들지 않는다).
    const baselineId = await this.baselineIdOf(input.projectId, input.baseline ?? null);

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
                          source_spec_version_id, source_requirement_id, baseline_id,
                          goal_md, output_format_md, tools_sources_md, boundaries_md)
        VALUES (${taskId}, ${input.projectId}, ${key}, ${input.title}, ${input.bodyMd ?? null},
                'backlog', ${priority}::task_priority,
                ${input.sourceSpecVersionId ?? null}, ${input.sourceRequirementId ?? null},
                ${baselineId},
                ${input.goalMd ?? null}, ${input.outputFormatMd ?? null},
                ${input.toolsSourcesMd ?? null}, ${input.boundariesMd ?? null})
      `);
      await emit({
        type: NERV_EVENT.TASK_CREATED,
        projectId: input.projectId,
        subjectType: 'task',
        subjectId: taskId,
        // 화면의 쿼리 키 축은 고정 ID다(`CLV-T-…`) — UUID 만 실으면 단건 캐시가
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
    /** 기준 버전을 최신 승인본으로 옮기고 재브리핑 플래그를 지운다(REQ-API-121) */
    rebrief?: boolean | null;
    userId: string;
  }): Promise<Record<string, unknown>> {
    // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
    const priorityValue =
      input.priority == null
        ? null
        : assertVocab([input.priority], taskPriority.enumValues, 'priority')[0];
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
               priority = coalesce(${priorityValue}::task_priority, priority),
               goal_md = ${merged.goal_md}, output_format_md = ${merged.output_format_md},
               tools_sources_md = ${merged.tools_sources_md}, boundaries_md = ${merged.boundaries_md},
               assignee_user_id = coalesce(${input.assigneeUserId ?? null}, assignee_user_id),
               updated_at = now()
         WHERE id = ${task.id}
      `);

      /**
       * **재브리핑 — 기준을 옮기고 플래그를 지운다**(REQ-API-121).
       *
       * 옮길 곳이 없으면(기준 버전이 없거나 이미 최신이면) 플래그만 지운다 — 그때는
       * "확인했다" 가 사실의 전부이기 때문이다. 옮길 곳이 있으면 **최신 승인본**으로 간다:
       * 재브리핑을 누른 사람은 그 버전을 읽고 누른 것이고, 중간 버전을 고를 이유가 없다.
       *
       * 위임 명세 4요소는 **건드리지 않는다.** 그것은 옛 버전 기준으로 쓰였을 수 있지만,
       * 서버가 다시 쓸 수는 없다 — 사람이 같은 화면에서 고치라고 폼이 열려 있다.
       */
      if (input.rebrief === true) {
        await tx.execute(sql`
          UPDATE task t
             SET source_spec_version_id = coalesce(
                   (SELECT v.id FROM spec_version v
                     WHERE v.spec_id = (SELECT sv.spec_id FROM spec_version sv
                                         WHERE sv.id = t.source_spec_version_id)
                       AND v.status = 'approved'
                     ORDER BY v.version_no DESC LIMIT 1),
                   t.source_spec_version_id),
                 rebrief_required_at = NULL,
                 updated_at = now()
           WHERE t.id = ${task.id}
        `);
      }

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
      // 자리표시자는 빈 것이다(REQ-API-131) — 임포트된 Task 의 제목만 고쳐도 ready 로 튀던 자리
      const complete = Object.values(merged).every((v) => isDelegationFilled(v));
      if (task.status === 'backlog' && complete) {
        const blocking = await this.pendingDependencies(tx, task.id);
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
      .filter(([field]) => !isDelegationFilled(task[field]))
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

  /**
   * **플랜 승인 게이트**(G2 · D-06 ② — spec-workflow §5 표 · REQ-API-095).
   *
   * 조건은 정본이 정한 둘이다: **파생 Task 4건 이상**이거나 **T3 티어 스펙에서 나온 작업**.
   * 위치도 정본이 정한 자리다 — `ready → claimed`, 즉 **착수 전**이다. 코드 2,000줄이
   * 쓰이기 전 설계 단계에서 잡자는 것이 이 게이트의 값어치다.
   *
   * **fail-open 이다**(같은 표): 판정이 실패하면 막지 않고 통과시키되 그 사실을 남긴다.
   * 게이트가 죽었다고 일이 멈추면, 다음에 사람이 하는 일은 게이트를 끄는 것이다.
   *
   * 기준 버전이 없는 작업은 판단할 근거가 없으므로 게이트도 걸지 않는다.
   */
  private async assertPlanApproved(input: ClaimInput): Promise<void> {
    // 참조를 여기서 한 번 더 푼다(키·UUID 둘 다) — 권위 있는 해소는 트랜잭션 안에 그대로
    // 있으므로, 여기서 못 찾으면 조용히 지나가고 그쪽이 제대로 된 오류를 낸다.
    const parsed = entityRef(input.taskId);
    const { rows: taskRows } = await this.db.execute<{
      id: string;
      project_id: string;
      source_spec_version_id: string | null;
    }>(
      parsed.id !== null
        ? sql`SELECT id, project_id, source_spec_version_id FROM task
               WHERE project_id = ${input.projectId} AND id = ${parsed.id}`
        : sql`SELECT id, project_id, source_spec_version_id FROM task
               WHERE project_id = ${input.projectId} AND key = ${parsed.key ?? ''}`,
    );
    const task = taskRows[0];
    if (task === undefined) return; // 없는 작업은 트랜잭션 안에서 제대로 거절된다
    const taskId = task.id;

    const gate = await this.planGate({
      projectId: task.project_id,
      taskId,
      sourceSpecVersionId: task.source_spec_version_id,
    });
    if (!gate.required) return;

    // 카드를 **먼저 만든다** — 거절만 하고 결재를 만들지 않으면 사람이 승인할 자리가 없다.
    // `request()` 는 같은 대상에 두 장을 만들지 않으므로 다시 클레임해도 카드는 하나다.
    const card = await this.approvals.request({
      projectId: task.project_id,
      subjectType: 'plan',
      subjectId: taskId,
      requestedByUserId: input.userId,
      // 막힌 것은 이 세션이다 — 승인이 나면 그 사실이 하트비트로 여기로 온다(REQ-API-133)
      requestedBySessionId: input.sessionId ?? null,
    });
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.plan_approval_required'), {
      kind: 'plan_approval_required',
      approval_id: card.approval_id,
      reason: gate.reason,
    });
  }

  private async planGate(input: {
    projectId: string;
    taskId: string;
    sourceSpecVersionId: string | null;
  }): Promise<{ required: boolean; reason: string | null }> {
    if (input.sourceSpecVersionId === null) return { required: false, reason: null };
    try {
      // 이미 승인된 플랜이 있으면 통과한다 — 게이트는 한 번 지나면 다시 서지 않는다
      const { rows: approved } = await this.db.execute<{ id: string }>(sql`
        SELECT id FROM approval
         WHERE project_id = ${input.projectId} AND subject_type = 'plan'::approval_subject_type
           AND subject_id = ${input.taskId} AND decision = 'approve'::approval_decision
         LIMIT 1
      `);
      if (approved.length > 0) return { required: false, reason: null };

      const { rows } = await this.db.execute<{ siblings: number; tier: string | null }>(sql`
        SELECT (SELECT count(*)::int FROM task t
                 WHERE t.source_spec_version_id = ${input.sourceSpecVersionId}) AS siblings,
               -- 티어는 열이 아니라 **승인 경로가 남긴 이벤트**에 있다(append-only).
               -- 판정 시점의 값을 그대로 읽는 것이라 다시 계산하는 것보다 정확하다.
               (SELECT e.payload->>'gate_tier' FROM event e
                 WHERE e.subject_type = 'spec_version' AND e.subject_id = ${input.sourceSpecVersionId}
                   AND e.payload ? 'gate_tier'
                 ORDER BY e.occurred_at DESC LIMIT 1) AS tier
      `);
      const siblings = rows[0]?.siblings ?? 0;
      const tier = rows[0]?.tier ?? null;
      if (siblings >= PLAN_APPROVAL_SIBLINGS) {
        return { required: true, reason: 'derived_tasks' };
      }
      if (tier === 'T3') return { required: true, reason: 'tier_t3' };
      return { required: false, reason: null };
    } catch (error) {
      // **통과 + 기록**(fail-open · D-14). 막지 않는 대신 왜 판정하지 못했는지를 남긴다 —
      // 2026-09-07 까지 그 "기록" 이 로그 한 줄이었고, `gate.failopen` 은 카탈로그에만
      // 있고 내는 곳이 없었다. 게이트가 판정하지 못한 채 통과시킨 것은 **감사가 알아야
      // 할 사실**이다: 그것이 fail-open 을 허용하는 조건이었다(D-14 — 통과·관측·격상).
      this.logger.warn(`플랜 승인 게이트 판정 실패 — task=${input.taskId}: ${String(error)}`);
      await this.events
        .transact(async (_tx, emit) =>
          emit({
            type: NERV_EVENT.GATE_FAILOPEN,
            projectId: input.projectId,
            subjectType: 'task',
            subjectId: input.taskId,
            actorUserId: null,
            isAgent: false,
            payload: { gate: 'plan_approval', error: String(error) },
          }),
        )
        // 기록에 실패해도 통과는 통과다 — fail-open 의 뜻이 그것이다
        .catch((emitError: unknown) => {
          this.logger.warn(`fail-open 기록 실패: ${String(emitError)}`);
        });
      return { required: false, reason: null };
    }
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    // **상한을 넘기면 거절한다 — 조용히 깎지 않는다**(2026-09-07 · REQ-API-127).
    //
    // 리스 길이는 "자동 회수까지 얼마나 기다리는가" 이고 그것은 조정 규칙이다(D-04).
    // 부른 쪽이 24시간을 달라고 했는데 서버가 말없이 30분으로 바꾸면, 그 세션은 자기
    // 리스가 24시간이라고 믿은 채로 회수당한다 — REQ-API-112 가 막은 "조용한 변환" 이다.
    // 판정이 여기 있는 이유는 표면이 둘이기 때문이다: zod 와 도구 스키마가 각자 막아도
    // 서비스를 직접 부르는 경로(임포터·테스트·다음 표면)는 그 밖이다.
    const ttl = input.leaseSeconds ?? LEASE_TTL_SECONDS;
    if (ttl > LEASE_TTL_SECONDS) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.claim.lease_too_long', { max: LEASE_TTL_SECONDS }),
        {
          kind: 'invalid_input',
          field: 'lease_seconds',
          max: LEASE_TTL_SECONDS,
        },
      );
    }

    // **플랜 승인 게이트는 트랜잭션 밖이다**(G2 · D-06 ② · REQ-API-095).
    //
    // 안에서 카드를 만들고 던지면 **그 카드도 함께 롤백된다** — 거절만 남고 승인할 자리는
    // 없어 그 작업이 영영 막힌다. 같은 함정을 아래 차단 판정이 이미 적어 두고 있다
    // ("차단도 사실이므로 기록한다. 롤백되므로 이 이벤트는 별도 트랜잭션에서 남긴다").
    //
    // 권위 있는 상태 검사는 그대로 트랜잭션 안에 있다 — 여기서는 **게이트만** 본다.
    await this.assertPlanApproved(input);

    try {
      return await this.claimInTx(input, ttl);
    } catch (error) {
      // **차단도 사실이다**(2026-09-07 · REQ-API-128). 위 주석이 "차단도 사실이므로
      // 기록한다 · 롤백되므로 별도 트랜잭션에서 남긴다" 고 적어 두었는데 **그 별도
      // 트랜잭션이 없었다** — `claim.conflict_blocked` 는 알림 카탈로그에 critical 로
      // 올라 있고 화면 무효화 맵에도 있는데 **내는 곳이 0** 이었다. 막힌 쪽은 409 로
      // 알지만, 알아야 할 사람은 **먼저 잡고 있던 쪽**이다: 자기 범위에 남이 부딪혔다는
      // 사실을 모르면 조정이 일어나지 않는다.
      if (error instanceof NervError && error.code === NERV_ERROR.CONFLICT_SCOPE) {
        const details = error.details as { task_id?: string; overlaps?: unknown };
        // **기록이 원래 오류를 덮지 않는다**(2026-09-10 · REQ-API-156). 주체는 `event.subject_id`
        // 가 `uuid` 열이라 **해소된 id 여야 한다** — 대체값이 `input.taskId` 였고 그것은 키일 수
        // 있어서, 키로 부른 클레임이 겹침에 걸리면 이 자리가 `22P02` 로 터졌다. 그리고 여기는
        // `catch` 안이라 그 터짐이 **`CONFLICT_SCOPE` 를 통째로 대체한다**: 막힌 쪽은 "겹쳤다"
        // 대신 캐스팅 오류를 받고, 기록도 남지 않는다. 던진 자리가 언제나 해소된 `task_id` 를
        // 싣지만(§1.4b) 그것을 기대로 두지 않는다 — 없으면 기록만 건너뛰고, 남기다 실패해도
        // 삼킨다. 이 경로에서 사람이 알아야 할 사실은 **겹쳤다는 것**이다.
        const subjectId = details.task_id;
        if (subjectId === undefined) {
          this.logger.warn(`클레임 차단 기록 생략 — 주체 id 없음: task=${input.taskId}`);
        } else {
          await this.events
            .transact(async (_tx, emit) =>
              emit({
                type: NERV_EVENT.CLAIM_CONFLICT_BLOCKED,
                projectId: input.projectId,
                subjectType: 'task',
                subjectId,
                actorUserId: input.userId,
                actorSessionId: input.sessionId,
                isAgent: input.sessionId !== null,
                payload: { overlaps: details.overlaps ?? [] },
              }),
            )
            .catch((emitError: unknown) => {
              this.logger.warn(`클레임 차단 기록 실패: ${String(emitError)}`);
            });
        }
      }
      throw error;
    }
  }

  /** 클레임의 트랜잭션 본체 — 차단 이벤트를 밖에서 남기려고 갈랐다(위 주석) */
  private async claimInTx(input: ClaimInput, ttl: number): Promise<ClaimResult> {
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
        source_spec_version_id: string | null;
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
      await this.claims.reclaimExpired(tx, emit, task.project_id);

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
          task_id: taskId,
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

      // 구현 축은 파생값이다(D-03) — 클레임이 `unimplemented → in_progress` 를 만든다
      await this.refreshImplStatus(tx, task.source_requirement_id);

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
  ): Promise<{
    agentSessionId: string | null;
    scopeSpecIds: string[];
    scopeFileGlobs: string[];
  }> {
    const { rows } = await this.db.execute<{
      project_id: string;
      user_id: string;
      agent_session_id: string | null;
      scope_spec_ids: string[] | null;
      scope_file_globs: string[] | null;
    }>(sql`SELECT project_id, user_id, agent_session_id, scope_spec_ids, scope_file_globs
             FROM claim WHERE id = ${claimId}`);
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
    return {
      agentSessionId: claim.agent_session_id,
      scopeSpecIds: claim.scope_spec_ids ?? [],
      scopeFileGlobs: claim.scope_file_globs ?? [],
    };
  }

  /**
   * 전표가 적은 이름으로 옮긴다 — `HeartbeatResult`(EP-TASK-07 · api.md §2.4).
   *
   * **두 표면이 같은 번역기를 쓴다**(D-05). 이 저장소는 번역을 한 표면에만 두었다가 이미
   * 한 번 손해를 봤다: 리뷰 제출의 `body`→`body_md` 가 MCP 쪽에만 있어 REST 로 올린
   * 지적의 본문이 전부 NULL 이었다(REQ-API-114). 게다가 REST 는 서비스 객체를 그대로
   * 돌려주고 있어서 **전표가 `lease_expires_at` 이라 적은 키를 `leaseExpiresAt` 으로**
   * 내보내고 있었다 — 소비자가 MCP 뿐이라 드러나지 않았을 뿐이다.
   */
  static toHeartbeatResult(beat: {
    leaseExpiresAt: Date;
    pending: unknown[];
    scopeOverlaps: number;
  }): { lease_expires_at: string; pending: unknown[]; scope_overlaps: number } {
    return {
      lease_expires_at: beat.leaseExpiresAt.toISOString(),
      // 서버 → 세션 방향의 유일한 보장된 채널이다(agent-integration §2.4)
      pending: beat.pending,
      // 지금 내 범위와 겹치는 활성 클레임 수(block·warn만) — statusline 이 읽는다
      scope_overlaps: beat.scopeOverlaps,
    };
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
  }): Promise<{ leaseExpiresAt: Date; pending: unknown[]; scopeOverlaps: number }> {
    const owned = await this.assertClaimOwner(input.claimId, input.actor, 'heartbeat');

    const leaseExpiresAt = await this.db.transaction(async (tx) =>
      this.claims.renewLease(tx, input.claimId, input.leaseSeconds),
    );

    /**
     * **겹침 수는 하트비트가 답한다**(2026-09-06 · 사람 결정 · REQ-API-116).
     *
     * 클레임 응답에도 겹침이 오지만 그것은 **잡던 순간의 사실**이다 — 겹침은 시간이
     * 지나며 생긴다(다른 세션이 나중에 같은 범위를 잡는다). 클레임 시점 값을 캐시에
     * 박아 두면 상태줄이 옛날 사실을 계속 보이게 되고, 그것은 0 보다 나쁘다.
     *
     * 스킬·문서·statusline 셋이 이 값을 쓰라고 적어 두고 **응답에 없어서** 상태줄의
     * 그 칸이 영원히 0 이었다(규약 6 이 이름 붙인 "유령 응답 필드"). 판정은 클레임과
     * **같은 함수**를 쓴다 — 겹침을 두 곳에서 세면 두 수가 갈라진다(D-05).
     *
     * `info` 는 세지 않는다. 한 줄짜리 상태줄에서 "그 밖의 스침"까지 세면 숫자가 늘
     * 켜져 있어 아무것도 알리지 못한다 — 세는 것은 막힘(block)과 경고(warn)다.
     */
    const overlaps = await this.db.transaction(async (tx) =>
      this.claims.detectOverlaps(tx, {
        projectId: input.actor.projectId,
        sessionId: owned.agentSessionId,
        scope: { specIds: owned.scopeSpecIds, fileGlobs: owned.scopeFileGlobs },
      }),
    );
    const scopeOverlaps = overlaps.filter((o) => o.severity !== 'info').length;

    if (input.progress != null && input.progress !== '') {
      await this.db.execute(
        sql`UPDATE claim SET progress_note = ${input.progress} WHERE id = ${input.claimId}`,
      );
    }

    // 역채널 — 답변된 질문을 여기 싣는다. Claude 의 channel capability 는 향상이고
    // 하트비트가 정본이다(Codex 에는 채널이 없다). 여기 실리지 않으면 에이전트는 모른다.
    const sessionId = owned.agentSessionId;
    if (sessionId === null) return { leaseExpiresAt, pending: [], scopeOverlaps };

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
    /**
     * **기준 버전이 밀려났다는 신호도 여기로 온다**(2026-09-06 · REQ-API-119).
     *
     * `skills/impl` 은 하트비트 `pending` 에서 `basis_superseded` 를 기다리라고 오래
     * 적어 왔는데 **그 종류가 실제로는 없었다** — 값은 `nerv_spec_get` 응답 필드이자 Task
     * 후보 열일 뿐이었고, 구현 중인 에이전트에게 닿는 길이 없었다. 그래서 "스펙이 구현보다
     * 앞서갈 때 옛 기준으로 계속 구현하는 것을 막는 장치" 가 **오지 않는 신호를 기다리고**
     * 있었다(규약 6 의 유령 응답 필드, 세 번째).
     *
     * 원천은 이미 있다 — `rebrief_required_at` 을 세우는 코드가 `spec.service` 에 있고
     * `task.rebrief_required` 이벤트도 난다. 하트비트는 **그 사실을 클레임한 세션에게**
     * 실어 나른다: 이벤트는 화면이 받고, 에이전트가 보장받는 채널은 이것뿐이다.
     */
    const [answers, instructions, basis, decisions] = await Promise.all([
      this.questions.pendingFor(sessionId),
      this.sessions.takePendingInstructions(sessionId),
      this.supersededBasisFor(input.claimId),
      this.approvals.pendingDecisionsFor(sessionId),
    ]);
    // 지시가 앞이다 — stop 은 지금 하던 것을 멈추라는 말이라 답변보다 먼저 읽혀야 한다.
    // 기준 드리프트는 그다음이다: 멈추라는 말보다 급하지 않지만 답변보다는 앞선다 —
    // 답을 받아 재개하는 순간 그 답이 옛 기준 위에 얹히면 안 되기 때문이다.
    // **결재 결정은 답변 앞이다**(2026-09-07 · REQ-API-133): 승인이 났으면 재개는 그 위에서
    // 시작해야 하고, 거절이면 답변을 읽어 이어 갈 일 자체가 없어진다.
    return {
      leaseExpiresAt,
      pending: [...instructions, ...basis, ...decisions, ...answers],
      scopeOverlaps,
    };
  }

  /**
   * 이 클레임의 기준 SpecVersion 이 밀려났는가 — 밀려났으면 하트비트 `pending` 한 줄.
   *
   * **매번 같은 것을 다시 싣는다.** 질문 답변은 한 번 전달되면 끝이지만(`delivered`),
   * 기준 드리프트는 **상태**다 — 사람이 재브리핑할 때까지 사실로 남고, 그동안 세션이
   * 재시작해도 알아야 한다. 지우는 것은 사람의 재브리핑이지 전달이 아니다.
   */
  private async supersededBasisFor(claimId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT 'basis_superseded' AS kind, t.id AS task_id, t.key AS task_key,
             s.key AS spec_key, sv.version_no AS basis_version_no,
             (SELECT max(v.version_no) FROM spec_version v
               WHERE v.spec_id = s.id AND v.status = 'approved') AS latest_version_no,
             t.rebrief_required_at::text AS rebrief_required_at
        FROM claim c
        JOIN task t ON t.id = c.task_id
        JOIN spec_version sv ON sv.id = t.source_spec_version_id
        JOIN spec s ON s.id = sv.spec_id
       WHERE c.id = ${claimId} AND c.status = 'active'
         AND (sv.status = 'superseded' OR t.rebrief_required_at IS NOT NULL)
    `);
    return rows;
  }

  /**
   * **이 Task 를 옮길 수 있는 사람인가**(EP-TASK-09 · 2026-09-07 개정 · REQ-API-129·130).
   *
   * 예전에는 아무 검사가 없었다 — 활성 클레임을 다른 세션이 쥐고 있어도, 내 리스가 이미
   * 만료돼 그 사이 다른 세션이 같은 Task 를 잡았어도, `done` 으로 옮길 수 있었다.
   * 그러면 "활성 소유자는 한 명" 이라는 클레임 모델의 전제가 상태 축에서 무너진다.
   *
   * **그 뒤로도 구멍이 하나 남아 있었다**: 활성 클레임이 *아예 없으면* 이 함수는 그대로
   * 돌아갔다(`if (claim === undefined) return`). 리스가 없다는 것이 거부가 아니라 무검사였던
   * 것이다 — 문서 셋이 "유효한 리스 없는 `done` 은 거부" 를 약속하는 동안(agent-integration
   * §2.7 · 백로그 E09-S05 수용 기준 · REQ-API-005) 서버는 클레임을 한 번도 쥐지 않은 세션의
   * `done` 을 받았다. 두 경로를 나눠 판정한다.
   *
   * - **세션(에이전트) 경로** — `in_progress`·`in_review`·`done`(`TASK_LEASE_BOUND_TARGETS`)
   *   으로 가려면 **그 세션이 쥔 살아 있는 클레임**이 있어야 한다. 없으면 `no_active_claim`,
   *   만료면 `lease_expired`, 둘 다 `details.reclaimable` 을 함께 준다 — 다시 잡고 이어 갈 수
   *   있는지를 모델이 그 값 하나로 판단한다(REQ-API-005).
   * - **사람 경로** — `done` 은 활성 클레임 보유자·담당자·planner·admin 만(사람 결정
   *   2026-09-07). 사람에게 리스를 요구하지 않는 이유는 사람이 리스를 쥐는 문이 없기
   *   때문이고, 아무에게나 열어 두지 않는 이유는 `done` 이 증적·스펙 영향을 채우고 닫는
   *   상태이기 때문이다.
   *
   * 나머지 목표(`backlog`·`ready`·`blocked`)에는 기존 판정만 선다 — 남의 클레임이 걸린 Task
   * 는 담당자·planner·admin 만 옮긴다.
   */
  private async assertMayTransition(
    task: { id: string; status: string; assignee_user_id: string | null },
    claim: ActiveClaimGuard | undefined,
    input: { userId: string; sessionId?: string | null; roles?: readonly string[] },
    target: string,
  ): Promise<void> {
    // planner·admin 은 남의 작업도 정리할 수 있다(전표의 "담당자·planner·admin")
    const privileged = (input.roles ?? []).some((r) => r === 'planner' || r === 'admin');
    const leaseBound = (TASK_LEASE_BOUND_TARGETS as readonly string[]).includes(target);
    // **되찾을 수 있는가**(REQ-API-005 의 `reclaimable` 실물). 살아 있는 클레임이 없고,
    // 다시 잡으면 잡히는 상태여야 참이다 — 지금 `ready` 이거나, 만료된 리스가 걸려 있어
    // `claim()` 이 그것을 회수하고 잡을 수 있는 경우다(그 회수는 클레임의 첫 단계다).
    // 클레임 없이 `in_progress` 인 고아 Task 는 **거짓**이다: 다시 잡을 길이 없고 사람이
    // 되돌려야 한다. 모델은 이 한 값으로 "이어 갈까 접을까" 를 정한다.
    const live = claim !== undefined && !claim.expired;
    const reclaimable = !live && (task.status === 'ready' || claim !== undefined);

    if (input.sessionId != null && leaseBound) {
      const mineAndLive =
        claim !== undefined && claim.agent_session_id === input.sessionId && !claim.expired;
      if (!mineAndLive) {
        const expiredMine = claim !== undefined && claim.agent_session_id === input.sessionId;
        throw new NervError(
          NERV_ERROR.LEASE_EXPIRED,
          expiredMine ? msg('error.claim.lease_expired') : msg('error.task.claim_required'),
          {
            kind: expiredMine ? 'lease_expired' : 'no_active_claim',
            task_id: task.id,
            reclaimable,
          },
        );
      }
      return;
    }

    if (input.sessionId == null && target === 'done') {
      const allowed =
        privileged ||
        task.assignee_user_id === input.userId ||
        (claim !== undefined && claim.user_id === input.userId);
      if (!allowed) {
        throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.task.not_assignee'), {
          kind: 'not_assignee',
          task_id: task.id,
        });
      }
      return;
    }

    if (claim === undefined) return;

    const mine =
      (input.sessionId != null && claim.agent_session_id === input.sessionId) ||
      claim.user_id === input.userId;

    if (!mine && !privileged) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.task.not_assignee'), {
        kind: 'not_assignee',
        task_id: task.id,
      });
    }
    // 만료된 리스로는 옮기지 못한다 — 그 사이 다른 세션이 이 Task 를 잡았을 수 있다
    if (mine && !privileged && claim.expired) {
      throw new NervError(NERV_ERROR.LEASE_EXPIRED, msg('error.claim.lease_expired'), {
        kind: 'lease_expired',
        task_id: task.id,
        reclaimable,
      });
    }
  }

  /**
   * 아직 끝나지 않은 선행 작업의 키 — 승격(`update()`)과 전이(`transition()`)가 같은 질의를 쓴다.
   * 둘이 따로 적으면 한쪽만 조건이 바뀌고, 그때 Task 는 문에 따라 다른 답을 받는다.
   */
  private async pendingDependencies(tx: Tx, taskId: string): Promise<string[]> {
    const { rows } = await tx.execute<{ key: string }>(sql`
      SELECT dt.key FROM task_dependency d JOIN task dt ON dt.id = d.depends_on_task_id
       WHERE d.task_id = ${taskId} AND dt.status <> 'done'
    `);
    return rows.map((r) => r.key);
  }

  /** 전이 판정이 보는 활성 클레임 한 행 — 한 번 읽어 세 판정이 나눠 쓴다. */
  private async activeClaimOf(tx: Tx, taskId: string): Promise<ActiveClaimGuard | undefined> {
    const { rows } = await tx.execute<ActiveClaimGuard>(sql`
      SELECT id, agent_session_id, user_id, lease_expires_at <= now() AS expired
        FROM claim WHERE task_id = ${taskId} AND status = 'active' LIMIT 1
    `);
    return rows[0];
  }

  /** 클레임 해제 — reason 에 따라 Task 를 ready 로 회수하거나 그대로 둔다. */
  async release(input: {
    claimId: string;
    /**
     * **부른 쪽이 고른 이유** — 어휘는 `CLAIM_RELEASE_INPUTS` 셋이다.
     *
     * 판정이 여기 있는 이유는 표면이 둘이기 때문이다(D-05). REST 는 예전에
     * `셋 중 하나가 아니면 handoff` 라는 삼항식으로 **조용히 바꾸고** 있었고,
     * MCP 는 스키마의 `enum` 으로 거절했다 — 같은 값에 두 표면이 다르게 답했다.
     */
    reason: string;
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
    // 어휘의 정본은 `@nerv/schema` 다 — 목록을 여기 다시 적지 않는다
    const reason = assertVocab([input.reason], CLAIM_RELEASE_INPUTS, 'reason')[0];
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        task_id: string;
        project_id: string;
        agent_session_id: string | null;
        release_note: string | null;
      }>(sql`
        UPDATE claim
           SET status = 'released', released_at = now(),
               -- **고른 이유가 그대로 남는다**(2026-09-05 · REQ-API-107). 예전에는
               -- done 외를 전부 manual 로 뭉쳐 **인계와 포기가 같은 값**이 됐다 — 다음
               -- 사람이 "왜 내려놨나" 를 물으면 답할 수 있는 것은 노트뿐이었고, 노트를
               -- 안 남기면 그것도 없었다. 서버가 판정하는 expired·conflict 와 축이
               -- 다르므로, 부른 쪽이 고른 값은 고른 대로 들어간다.
               release_reason = ${reason}::claim_release_reason,
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
      if (reason !== 'done') {
        const { rows: t } = await tx.execute<{
          status: string;
          source_requirement_id: string | null;
        }>(
          sql`
            UPDATE task SET status = 'ready', delegate_session_id = NULL
             WHERE id = ${claim.task_id} AND status IN ('claimed', 'in_progress')
            RETURNING status::text AS status, source_requirement_id
          `,
        );
        taskStatus = t[0]?.status ?? 'unchanged';
        // **회수도 구현 축을 움직인다**(2026-09-07 · REQ-API-141). 놓아 준 Task 가 ready 로
        // 돌아가면 그 요구사항은 더 이상 `in_progress` 가 아닐 수 있다 — 재파생하지 않으면
        // 아무도 하지 않는 일이 대시보드에서 계속 진행 중이다.
        if (t[0] !== undefined) await this.refreshImplStatus(tx, t[0].source_requirement_id);
      }

      await emit({
        type: NERV_EVENT.CLAIM_RELEASED,
        projectId: claim.project_id,
        subjectType: 'claim',
        subjectId: input.claimId,
        actorUserId: input.userId,
        actorSessionId: claim.agent_session_id,
        isAgent: claim.agent_session_id !== null,
        payload: { reason },
      });

      return { taskStatus, state_note: claim.release_note };
    });
  }

  /**
   * nerv_task_update · EP-TASK-09 — **done 게이트 판정의 단일 지점**이다.
   *
   * 판정하는 것은 조건 4·5(증적·스펙 영향 선언)이고, **리뷰 커버리지 조건(1~3)은 정책이
   * 켠다**(2026-09-07 · REQ-API-146~148). 이 주석은 오래 "FR-09 가 Phase 2 라 판정할 데이터가
   * 없다" 고 적고 있었는데, 리뷰 수집은 들어왔고([4.1](../../../../../docs/04-mvp/scope.md)
   * §3.2 FR-09) 이월된 것은 커버리지의 **게이트 조건**뿐이었다. 조건 6(테스트 증적)은
   * 여전히 이월이다(4.8 E09-S05).
   *
   * 조건 5(스펙 영향 선언)가 clemvion 에서 가장 잘 작동한 규칙의 이식이다: "작업 완료가 스펙
   * 정합 결정을 강제 동반"하게 만들면 완료 시점에 아무도 스펙을 보지 않는 사태가 구조적으로
   * 불가능해진다. `none` sentinel 을 허용하되 **선언 자체는 필수**라는 점이 핵심이다.
   */
  /**
   * 구현 축을 다시 파생한다(D-03 · spec-workflow §1.3). 규칙은 `impl-status.ts` 한 곳이다.
   *
   * 요구사항에 매이지 않은 Task 도 많으므로 `null` 이면 할 일이 없다 — 그때 조용히 지나가는
   * 것이 맞다(요구사항 없는 작업이 잘못된 것은 아니다).
   */
  private async refreshImplStatus(tx: Tx, requirementId: string | null): Promise<void> {
    if (requirementId === null) return;
    await recomputeImplStatus(tx, requirementId);
  }

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
      const { rows } = await tx.execute<{
        status: string;
        project_id: string;
        key: string;
        source_requirement_id: string | null;
        assignee_user_id: string | null;
        goal_md: string | null;
        output_format_md: string | null;
        tools_sources_md: string | null;
        boundaries_md: string | null;
      }>(
        sql`SELECT status::text AS status, project_id, key, source_requirement_id,
                   assignee_user_id, goal_md, output_format_md, tools_sources_md, boundaries_md
              FROM task WHERE id = ${taskId} FOR UPDATE`,
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

      // **`claimed` 는 어휘에는 있고 이 문에는 없다**(2026-09-07 · REQ-API-132). 그 상태로
      // 가는 길은 원자적 클레임 하나뿐이라(`claim()`), 상태만 써 넣으면 **클레임 행 없이
      // `claimed` 인 Task** 가 된다 — 아무도 쥐지 않았는데 `next()` 에도 안 보이고 잡을 수도
      // 없는 Task 다. "모르는 값"(어휘 오류)과는 다른 답을 준다: 갈 길이 따로 있다는 말이다.
      if (input.status === 'claimed') {
        throw new NervError(
          NERV_ERROR.PRECONDITION,
          msg('error.task.transition_not_allowed', { from: task.status, to: input.status }),
          {
            kind: 'transition_not_allowed',
            from: task.status,
            to: input.status,
            next_actions: ['nerv_task_claim'],
          },
        );
      }
      // **어휘 안의 값만 받는다.** 예전에는 입력을 그대로 `::task_status` 로 캐스팅해
      // 오타 하나가 500(22P02)이 됐다 — 그것은 "그런 상태는 없다" 가 아니라 서버 오류다.
      // `?? input.status` 는 도달하지 않는다 — 통과한 값이 그대로 배열의 첫 항목이다
      const nextStatus =
        assertVocab([input.status], TASK_TRANSITION_TARGETS, 'status')[0] ?? input.status;

      // **끝난 일은 조용히 되살아나지 않는다.** done 은 게이트를 통과해 닫힌 상태이고
      // (증적·spec_impact) 그것을 지나 되돌리는 것은 새 결정이라 이 문으로 하지 않는다.
      if (task.status === 'done') {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.done_is_final'), {
          kind: 'not_allowed',
          from: task.status,
          to: input.status,
        });
      }

      // 활성 클레임 한 행을 여기서 한 번 읽고 세 판정이 나눠 쓴다(문지기·해제 요구·ready 판정)
      const claim = await this.activeClaimOf(tx, taskId);
      await this.assertMayTransition(
        { id: taskId, status: task.status, assignee_user_id: task.assignee_user_id },
        claim,
        input,
        nextStatus,
      );

      // **되돌리려면 먼저 놓는다**(2026-09-07 · REQ-API-132). 활성 클레임이 걸린 Task 의
      // 상태만 `ready`·`backlog` 로 바꾸면 클레임 행은 그대로 살아 있다 — 그 Task 는 큐에
      // 있는 것처럼 보이지만 다음 클레임은 부분 unique(`claim_task_active_uq`)에 걸려
      // 500 이 된다. 놓는 문은 이미 둘 있다(해제 · 세션 중단).
      if (claim !== undefined && (nextStatus === 'ready' || nextStatus === 'backlog')) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.release_required'), {
          kind: 'release_required',
          task_id: taskId,
          claim_id: claim.id,
        });
      }

      for (const item of input.evidence ?? []) {
        // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
        const evidence = assertVocab([item.kind], evidenceKind.enumValues, 'kind')[0];
        // **형식도 어휘다**(2026-09-07 · REQ-API-147). 커밋 자리에 "다 했습니다" 가 들어가면
        // 게이트는 통과하지만 증적은 아무것도 가리키지 않는다 — 그것이 자기 신고다.
        const shape = checkEvidenceLocator(evidence ?? item.kind, item.locator);
        if (!shape.ok) {
          throw new NervError(
            NERV_ERROR.PRECONDITION,
            msg('error.evidence.locator_shape', { kind: item.kind }),
            {
              kind: 'invalid_input',
              field: 'locator',
              evidence_kind: item.kind,
              reason: shape.reason,
            },
          );
        }
        await tx.execute(sql`
          INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
          VALUES (${newId()}, ${input.projectId}, ${taskId}, ${evidence}::evidence_kind,
                  ${item.locator}, ${input.sessionId == null ? 'human' : 'agent'}::evidence_source)
        `);
      }

      if (input.status === 'done') {
        const gate = await this.assertDoneGate(tx, taskId, input.projectId, input.specImpact);
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
        await this.refreshImplStatus(tx, task.source_requirement_id);
        return { status: 'done', gate };
      }

      // **`ready` 는 도착지가 아니라 판정이다**(2026-09-07 · REQ-API-131). 큐에 들어간다는 것은
      // 아무 세션이나 집어 갈 수 있다는 뜻이라, 위임 명세 4요소와 선행 의존이 여기서 선다 —
      // `update()` 의 승격 경로만 그것을 보고 이 문은 그대로 통과시켰다. 4요소가 빈 채로
      // 들어간 Task 는 DB CHECK 가 막긴 했지만 돌아오는 것은 제약 이름뿐이라(400), 무엇을
      // 채워야 하는지 아무도 알 수 없었다.
      if (nextStatus === 'ready') {
        this.assertDelegationSpec(task);
        const pending = await this.pendingDependencies(tx, taskId);
        if (pending.length > 0) {
          throw new NervError(
            NERV_ERROR.PRECONDITION,
            msg('error.task.dependencies_pending', { pending: pending.join(', ') }),
            { kind: 'dependencies_pending', pending },
          );
        }
        // 큐로 돌아가는 것이므로 막힘 사유와 위임 세션을 함께 지운다 — 남겨 두면 다음 사람이
        // 이미 해소된 사유를 읽는다
        await tx.execute(sql`
          UPDATE task SET status = 'ready', blocked_reason = NULL, delegate_session_id = NULL
           WHERE id = ${taskId}
        `);
        await emit({
          type: NERV_EVENT.TASK_READY,
          projectId: input.projectId,
          subjectType: 'task',
          subjectId: taskId,
          subjectKey: task.key,
          actorUserId: input.userId,
          actorSessionId: input.sessionId ?? null,
          isAgent: input.sessionId != null,
          fromState: task.status,
          toState: 'ready',
        });
        await this.refreshImplStatus(tx, task.source_requirement_id);
        return { status: 'ready' };
      }

      if (input.status === 'blocked' && (input.blockedReason ?? '').trim() === '') {
        // 사유 없는 blocked 는 백로그 부패의 씨앗이다(§1.4) — CHECK 도 막지만 사유를 알려준다
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.task.blocked_reason_required'), {
          kind: 'blocked_reason_required',
        });
      }
      // **어휘 판정은 도메인 한 곳이다**(D-05). REST 는 zod 가 먼저 보지만 MCP 는 인자를
      // 문자열로 그대로 실어 오므로(`task.tools.ts`), 여기서 보지 않으면 도구 경로로 들어온
      // 아무 문자열이 저장된다 — 그러면 화면의 blocked 필터가 그 순간부터 사실을 못 센다.
      if (input.blockedReason != null && input.blockedReason !== '') {
        assertVocab([input.blockedReason], BLOCKED_REASONS, 'blocked_reason');
      }

      await tx.execute(sql`
        UPDATE task SET status = ${nextStatus}::task_status,
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
      // **전이하면 구현 축도 움직인다**(REQ-API-097 · 2026-09-07 보완). done 만 재파생하고
      // 있었는데, `in_progress`·`blocked` 로 옮겨도 그 요구사항의 상태는 달라진다 — 재파생을
      // 빠뜨리면 대시보드는 옛 값을 계속 말한다.
      await this.refreshImplStatus(tx, task.source_requirement_id);
      return { status: input.status };
    });
  }

  /**
   * done 전이 조건 — 기본은 조건 4·5, 강화 둘(증적 출처·리뷰 커버리지)은 **정책이 켠다**.
   * 조건 6(테스트 증적)은 이월이다(4.8 E09-S05).
   *
   * 판정 불가는 실패가 아니라 fail-open + 관측이다(D-14) — 여기서는 판정에 필요한 데이터가
   * 전부 서버에 있으므로 그 경로가 열리지 않는다.
   */
  /**
   * **게이트는 해소된 것만 본다**(2026-09-10 · REQ-API-156). 예전 시그니처는 `transition()`
   * 의 `input` 을 통째로 받았고, 그래서 `taskId` 가 **키인 채로** 세 질의에 들어갔다 —
   * 키로 `done` 을 부르면 `evidence.task_id = 'SUD-T-…'` 가 `22P02` 로 터졌고, 그 그물이
   * (REQ-API-106) 그것을 400 으로 내려 **서버 결함이 호출자의 입력 오류로 보였다.** 두 줄
   * 아래의 `UPDATE` 는 같은 블록에서 해소된 id 를 옳게 쓰고 있었으니 빠진 것은 여기 하나였다.
   * 참조가 아니라 **id 를 받는 시그니처**로 못 박아 같은 실수가 다시 가능하지 않게 한다.
   */
  private async assertDoneGate(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    /** `resolveTaskId()` 를 지난 UUID 다 — 키를 넘기면 타입이 막지 못하니 이름으로 못 박는다 */
    taskId: string,
    projectId: string,
    specImpact: Record<string, unknown> | null | undefined,
  ): Promise<{ ok: boolean; missing: string[] }> {
    const missing: string[] = [];

    // 조건 5 — 스펙 영향 선언. none sentinel 을 허용하되 선언 자체는 필수다
    const impact = specImpact;
    if (impact === null || impact === undefined || Object.keys(impact).length === 0) {
      missing.push(text('task.missing.spec_impact'));
    }

    // **강화는 프로젝트가 켠다**(2026-09-07 · REQ-API-146). 기본은 오늘과 같다 —
    // 서버가 일괄로 켜면 오늘 통과하던 작업이 내일 막히고, 그 이유를 아무도 고르지 않았다.
    const { rows: policyRows } = await tx.execute<{ gate_policy: unknown }>(
      sql`SELECT gate_policy FROM project WHERE id = ${projectId}`,
    );
    const parsed = GatePolicySchema.safeParse(policyRows[0]?.gate_policy ?? {});
    const policy = parsed.success
      ? parsed.data.done_gate
      : { evidence_source: 'any' as const, review_coverage: false };

    // 조건 4 — Requirement ↔ 구현 Evidence 1건 이상.
    // `ci_or_human` 이면 **에이전트가 스스로 올린 것은 세지 않는다** — 자기 신고 문자열
    // 하나로 닫히는 게이트는 산문 규약과 같다.
    const sourceFilter =
      policy.evidence_source === 'ci_or_human' ? sql` AND source IN ('ci', 'human')` : sql``;
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM evidence
           WHERE task_id = ${taskId}${sourceFilter}`,
    );
    if ((rows[0]?.n ?? 0) === 0) {
      missing.push(
        policy.evidence_source === 'ci_or_human'
          ? text('task.missing.evidence_source')
          : text('task.missing.evidence'),
      );
    }

    // 조건 1~3 — 리뷰 커버리지. FR-10 이 오래 이월해 온 조건이고, 이제 **정책으로 켠다**.
    // 면제(`gate_bypass` 결재)가 있으면 둘 다 넘어간다 — 면제는 기록된 예외다(FR-10).
    if (policy.review_coverage) {
      const { rows: waived } = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM approval
         WHERE is_bypass AND subject_type = 'gate_bypass' AND subject_id = ${taskId}
      `);
      if ((waived[0]?.n ?? 0) === 0) {
        const { rows: reviews } = await tx.execute<{ rounds: number; open_critical: number }>(sql`
          SELECT count(*)::int AS rounds,
                 COALESCE(sum((SELECT count(*) FROM finding f
                                WHERE f.last_session_id = rs.id
                                  AND f.severity = 'critical' AND f.status = 'open')), 0)::int
                   AS open_critical
            FROM review_session rs
           WHERE rs.task_id = ${taskId} AND rs.state <> 'running'
        `);
        if ((reviews[0]?.rounds ?? 0) === 0) missing.push(text('task.missing.review_coverage'));
        else if ((reviews[0]?.open_critical ?? 0) > 0) {
          missing.push(text('task.missing.open_critical'));
        }
      }
    }
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
  /**
   * 기준선 **이름 → id**. 없는 이름은 거부한다.
   *
   * 조용히 NULL 로 만들면 Task 는 만들어지는데 기준 세트가 없다 — 그러면 에이전트는
   * "기준선 맥락" 이라고 지시받고도 최신 버전을 읽게 되고, 그것이 정확히 기준선이
   * 막으려던 상황이다(REQ-API-087).
   */
  private async baselineIdOf(projectId: string, name: string | null): Promise<string | null> {
    if (name === null || name === '') return null;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM spec_baseline WHERE project_id = ${projectId} AND name = ${name}
    `);
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.baseline_not_found'), {
        kind: 'invalid_input',
        field: 'baseline',
        unknown: [name],
      });
    }
    return id;
  }

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
