// 받은 요청 — 결정 · 지시자≠승인자 · stale 승인 차단
// 정본: docs/03-proposal/spec-workflow.md §2.5·§6.4 · docs/04-mvp/api.md §2.6
//
// **승인·질문·리뷰 요청은 알림이 아니라 작업 항목이다**(§6.4). 흩어진 핑 대신 미결 액션을
// 한 곳에서 추적하는 것이 받은 요청의 존재 이유이고, Phase 1 종료 게이트가 그것을 수치로 잰다 —
// 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건**.
//
// 카드는 세 유형이다: 승인 · 질문 · 통지. 그리고 **에이전트의 요약문이 아니라 실제 diff·대상
// 리소스를 먼저 보여준다** — 매끄러운 설명으로 사람을 속여 유해한 승인을 받아내는 것이
// OWASP ASI09 가 명명한 공격 표면이고, 원문 우선 표시가 그에 대한 구조적 방어다.

import { Injectable, Logger } from '@nestjs/common';
import {
  APPROVAL_INBOX_STATES,
  approvalDecision,
  msg,
  NERV_ERROR,
  NERV_EVENT,
  newId,
  questionStatus,
  scopesForRoles,
} from '@nerv/schema';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  DECIDER_ROLES,
  canApproveReasonSql,
  canApproveSql,
  eligibleSql,
  selfKindOf,
} from './approval-policy.js';
import { InjectDb } from '../../common/database.module.js';
import { assertVocab } from '../../common/query-vocab.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertHuman } from '../../common/human-only.js';
import type { Actor } from '../../common/human-only.js';
import { EventService } from '../event/event.service.js';
import { SpecService } from '../spec/spec.service.js';
import { AuthService } from '../auth/auth.service.js';

export type ApprovalDecision = 'approve' | 'reject' | 'comment';

export interface InboxCard extends Record<string, unknown> {
  id: string;
  subject_type: string;
  subject_id: string;
  /** 카드 제목 — 대상 리소스의 표시 키 */
  subject_key: string | null;
  requested_by: string;
  requested_at: string;
  /** 요약이 아니라 **원문**이다(§6.4) */
  body_md: string | null;
  /** 지시자≠승인자 — 이 카드를 내가 승인할 수 있는가 */
  self_requested: boolean;
  /** 지시자≠승인자 규칙과 그 완화(소규모·admin)를 서버가 판정한 결과 */
  can_approve: boolean;
  /**
   * **왜 못 누르는가**(2026-09-07 · REQ-API-137). 잠긴 단추에 이유가 없으면 사람은 화면이
   * 고장 났다고 읽는다 — `author`·`session_owner`·`self_requested`·`missing_role`·
   * `not_in_role_queue`·`not_assignee`·`already_approved` 중 하나이고, 누를 수 있으면 NULL 이다.
   */
  can_approve_reason: string | null;
  /** 직군 슬롯(있으면) — 이 카드가 어느 역할 큐의 것인가 */
  assignee_role: string | null;
  /** stale 판정용 — 결정 시점에 내용이 바뀌었는지 본다 */
  content_hash: string | null;
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly events: EventService,
    private readonly specs: SpecService,
    private readonly auth: AuthService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * 지정 승인자가 있으면 그 사람(또는 admin), 없으면 **역할 큐**다.
   *
   * 역할 큐는 `approval:decide` 를 가진 역할이고(정본: `ROLE_SCOPES`), 그 목록을 여기서
   * 다시 적지 않는다 — 역할이 늘거나 권한이 바뀌면 두 벌 중 하나만 고쳐지기 때문이다.
   */
  private async assertMayDecide(
    projectId: string,
    userId: string,
    assigneeUserId: string | null,
    assigneeRole: string | null,
  ): Promise<void> {
    const roles = await this.auth.assertMembership(userId, projectId);
    if (assigneeUserId !== null) {
      if (assigneeUserId === userId || roles.includes('admin')) return;
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.approval.not_assignee'), {
        kind: 'not_assignee',
        roles,
      });
    }
    // **직군 슬롯**(2026-09-07 · REQ-API-138). 매트릭스의 ○ 는 "지정 시" 라는 뜻이고, 그 지정이
    // 이 열이다 — 슬롯에 역할이 적혀 있으면 그 역할(또는 admin)만 내린다. planner 라고 해서
    // designer 자리의 결재를 대신 내리면 직군 교차라는 게이트의 뜻이 사라진다.
    if (assigneeRole !== null) {
      if ((roles as readonly string[]).includes(assigneeRole) || roles.includes('admin')) return;
      throw new NervError(
        NERV_ERROR.FORBIDDEN,
        msg('error.approval.not_in_role_queue', { role: assigneeRole }),
        { kind: 'not_in_role_queue', role: assigneeRole, roles },
      );
    }
    if (scopesForRoles(roles).has('approval:decide')) return;
    throw new NervError(
      NERV_ERROR.FORBIDDEN,
      msg('error.auth.scope_missing', { scope: 'approval:decide' }),
      {
        kind: 'missing_scope',
        required: ['approval:decide'],
        roles,
      },
    );
  }

  /**
   * 결정을 **대상에 적용한다** — 결재 행을 고치는 것만으로는 아무 일도 일어나지 않는다.
   *
   * 지금 아는 대상은 `spec_version` 하나다. `question` 은 전용 경로(`questions.answer`)가
   * 이미 상태를 옮기고, `plan`·`gate_bypass` 는 결재 자체가 사실이라 옮길 상태가 없다.
   * **모르는 대상은 조용히 넘어간다** — 여기서 던지면 결정 자체가 롤백되고, 그건 "결재는
   * 됐는데 문서가 안 움직였다" 보다 더 나쁜 자리다.
   */
  private async applyToSubject(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    emit: Parameters<Parameters<EventService['transact']>[0]>[1],
    input: { projectId: string; userId: string; decision: ApprovalDecision; comment?: string },
    approval: { subject_type: string; subject_id: string },
  ): Promise<void> {
    if (approval.subject_type !== 'spec_version') return;
    if (input.decision === 'approve') {
      await this.specs.approveInTxForApproval(tx, emit, {
        projectId: input.projectId,
        specVersionId: approval.subject_id,
        approverUserId: input.userId,
      });
      return;
    }
    // **`comment` 도 문서를 움직인다** — 되돌려 놓는다(2026-09-02).
    //
    // 예전에는 "말만 남기는 결정" 이라 대상을 건드리지 않았다. 그런데 결정이 적히는
    // 순간 카드는 받은 요청에서 사라지고(`decision IS NULL` 만 보인다) 재결정은
    // `already_decided` 로 막힌다. 문서는 `in_review` 에 남는데 그 상태는 편집 불가이고
    // (D-02: 가변 구간은 draft 하나뿐) 제출도 draft 만 받으므로, **고칠 수도 다시 낼 수도
    // 없는 문서**가 된다 — 검토자가 "한 가지만 확인해 주세요" 를 누른 대가치고는 무겁다.
    //
    // 3.5 §2.5 는 이 결정을 "comment + 승인자가 직접 draft 편집 → 재제출" 로 그린다.
    // 그러려면 편집 가능한 상태여야 한다. 거절과 다른 것은 **뜻**이지 상태가 아니다 —
    // 이벤트는 `spec.rejected` 가 아니라 코멘트로 남는다.
    if (input.decision === 'reject' || input.decision === 'comment') {
      await this.specs.rejectInTxForApproval(tx, emit, {
        projectId: input.projectId,
        specVersionId: approval.subject_id,
        reviewerUserId: input.userId,
        comment: input.comment ?? '',
        ...(input.decision === 'comment' ? { asComment: true } : {}),
      });
    }
  }

  /**
   * EP-APR-01 받은 요청 — **내 결정을 기다리는 것만** 센다(§6.6 원칙 3).
   * 나머지는 피드다. 이 구분이 없으면 배지 숫자가 의미를 잃고 받은 요청이 두 번째 받은편지함이 된다.
   */
  async inbox(input: {
    projectId: string;
    userId: string;
    /** 사람 전용 게이트의 축 — 전역 경로(EP-APR-01)와 같은 규칙이다(D-05 · REQ-API-123) */
    actor: Actor;
  }): Promise<InboxCard[]> {
    assertHuman(input.actor, 'inbox', '/inbox');
    const { rows } = await this.db.execute<InboxCard>(sql`
      SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
             s.key AS subject_key,
             u.display_name AS requested_by,
             a.requested_at::text AS requested_at,
             sv.body_md,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             a.assignee_role::text AS assignee_role,
             ${canApproveSql(input.userId)},
             ${canApproveReasonSql(input.userId)},
             encode(sv.content_hash, 'hex') AS content_hash
        FROM approval a
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN agent_session owner ON owner.id = sv.author_session_id
       WHERE a.project_id = ${input.projectId}
         AND a.decision IS NULL
         -- **내 결정을 기다리는 것만**(§6.6 원칙 3 · 2026-09-07 · REQ-API-137). 예전에는
         -- 지정 승인자만 걸러서, 결재권이 없는 사람의 목록에도 카드가 있었다 — 그 사람은
         -- 그것을 자기 일로 읽고, 배지는 "내가 막고 있는 것" 을 세지 못한다.
         AND ${eligibleSql(input.userId)}
       ORDER BY a.requested_at DESC
    `);
    return rows;
  }

  /**
   * EP-APR-01 전역 받은 요청 — **내 결정을 기다리는 것만** 센다(spec-workflow §6.6 원칙 3).
   *
   * 프로젝트를 가로지르는 이유는 사람의 하루가 프로젝트로 나뉘어 있지 않기 때문이다.
   * 승인 3유형(스펙 승인·플랜·질문)이 한 줄에 섞여 나오고, 각 카드는 **얼마나 기다렸는지**를
   * 들고 온다 — 대기 시간이 보이지 않으면 승인은 조용히 늦어진다(P4).
   */
  async inboxGlobal(input: {
    /** 사람 전용 게이트의 축 — 판정은 표면이 아니라 여기다(D-05 · REQ-API-111) */
    actor: Actor;
    userId: string;
    /** 어휘는 `APPROVAL_INBOX_STATES` — 판정은 아래에서 한다(REQ-API-126) */
    state?: string | null;
    projectSlug?: string | null;
  }): Promise<Record<string, unknown>[]> {
    assertHuman(input.actor, 'inbox', '/inbox');
    const decided =
      assertVocab([input.state ?? 'pending'], APPROVAL_INBOX_STATES, 'state')[0] === 'decided';
    const stateFilter = decided ? sql`a.decision IS NOT NULL` : sql`a.decision IS NULL`;
    const projectFilter =
      input.projectSlug == null ? sql`` : sql` AND p.slug = ${input.projectSlug}`;

    const { rows: approvals } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.requested_at, a.decided_at, a.is_bypass,
             p.slug AS project_slug, p.name AS project_name, p.id AS project_id,
             u.display_name AS requested_by,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             a.assignee_role::text AS assignee_role,
             ${canApproveSql(input.userId)},
             ${canApproveReasonSql(input.userId)},
             s.key AS spec_key, s.title AS spec_title, sv.version_no,
             encode(sv.content_hash, 'hex') AS content_hash,
             extract(epoch FROM (now() - a.requested_at))::int AS waiting_seconds
        FROM approval a
        JOIN project p ON p.id = a.project_id
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN agent_session owner ON owner.id = sv.author_session_id
       WHERE ${stateFilter}${projectFilter}
         -- **보관한 프로젝트의 결재는 여기 오지 않는다**(2026-08-27 · 사람 보고).
         -- 목록에는 보이는데 누르면 아무 일도 일어나지 않았다 — 치운 프로젝트를
         -- 사람이 계속 결재하도록 두는 것은 받은 요청을 못 믿게 만드는 가장 빠른 길이다.
         AND p.archived_at IS NULL
         -- 내 큐만 — 지정·역할 슬롯·기본 큐(REQ-API-137)
         AND ${eligibleSql(input.userId)}
         -- **거절로 draft 가 된 문서의 남은 슬롯은 대기가 아니다**(2026-09-07). 슬롯이
         -- 여럿인 결재에서 하나가 reject 되면 문서는 draft 로 돌아가는데, 결정되지 않은
         -- 나머지 슬롯은 그대로 남아 있다 — 그것을 대기 목록에 두면 이미 끝난 라운드를
         -- 사람이 계속 결재하게 된다.
         AND (sv.id IS NULL OR sv.status = 'in_review')
         AND EXISTS (
           SELECT 1 FROM membership m
            WHERE m.user_id = ${input.userId} AND m.org_id = p.org_id
              AND (m.project_id IS NULL OR m.project_id = p.id)
         )
       ORDER BY a.requested_at DESC
       LIMIT 100
    `);

    if (decided) return approvals;

    // 질문 카드 — 승인과 같은 줄에 선다. 에이전트가 답을 기다리며 멈춰 있고(awaiting_input),
    // 세션 신원 3요소와 경과 시간이 카드의 필수 표기다(REQ-WEB-008).
    const { rows: questions } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT q.id, 'question' AS subject_type, q.id AS subject_id, NULL::text AS decision,
             q.asked_at AS requested_at, q.title, q.body_md, q.options, q.urgency::text AS urgency,
             p.slug AS project_slug, p.name AS project_name, p.id AS project_id,
             u.display_name AS requested_by,
             se.hostname, se.agent_type::text AS agent_type, se.external_session_id,
             -- **출처는 카드의 절반이다.** 사람은 에이전트의 요약이 아니라 원문을 보고
             -- 판단하므로, 어느 문서·작업·발견에서 온 질문인지가 카드에 있어야 한다
             t.key AS task_key, s.key AS spec_key, q.finding_id, q.escalate::text AS escalate,
             extract(epoch FROM (now() - q.asked_at))::int AS waiting_seconds
        FROM question q
        JOIN project p ON p.id = q.project_id
        JOIN agent_session se ON se.id = q.agent_session_id
        JOIN "user" u ON u.id = se.user_id
   LEFT JOIN task t ON t.id = q.task_id
   LEFT JOIN spec s ON s.id = q.spec_id
       WHERE q.status = 'open'${projectFilter}
         -- 승인 카드와 **같은 조건**이다. 한쪽만 걸렀더니 보관한 프로젝트의 질문
         -- 카드가 받은 요청에 그대로 남았다(실측 2026-08-27) — 받은 요청은 한 목록이므로
         -- 두 갈래가 같은 규칙을 써야 그 목록이 한 가지 뜻을 갖는다.
         AND p.archived_at IS NULL
         AND EXISTS (
           SELECT 1 FROM membership m
            WHERE m.user_id = ${input.userId} AND m.org_id = p.org_id
              AND (m.project_id IS NULL OR m.project_id = p.id)
         )
       ORDER BY q.asked_at DESC
       LIMIT 100
    `);

    return [...approvals, ...questions].sort(
      (a, b) => Number(b['waiting_seconds'] ?? 0) - Number(a['waiting_seconds'] ?? 0),
    );
  }

  /** EP-APR-02 — 카드 하나의 전량(대상 원문 포함). 결정 화면이 이걸로 렌더한다. */
  async detail(input: {
    approvalId: string;
    userId: string;
    /** 사람 전용 게이트의 축 — 판정은 표면이 아니라 여기다(D-05 · REQ-API-111) */
    actor: Actor;
  }): Promise<Record<string, unknown>> {
    assertHuman(input.actor, 'inbox', '/inbox');
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.project_id, a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.comment_md, a.requested_at, a.decided_at,
             a.is_bypass, a.bypass_reason,
             p.slug AS project_slug, u.display_name AS requested_by,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             a.assignee_role::text AS assignee_role,
             ${canApproveSql(input.userId)},
             ${canApproveReasonSql(input.userId)},
             s.key AS spec_key, s.title AS spec_title, sv.version_no, sv.body_md,
             sv.change_summary_md, encode(sv.content_hash, 'hex') AS content_hash
        FROM approval a
        JOIN project p ON p.id = a.project_id
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN agent_session owner ON owner.id = sv.author_session_id
       WHERE a.id = ${input.approvalId}
         AND EXISTS (
           SELECT 1 FROM membership m
            WHERE m.user_id = ${input.userId} AND m.org_id = p.org_id
              AND (m.project_id IS NULL OR m.project_id = p.id)
         )
    `);
    const approval = rows[0];
    if (approval === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.not_found'), {
        kind: 'not_found',
        approval_id: input.approvalId,
      });
    }
    return approval;
  }

  /** 결정 경로가 프로젝트를 스스로 찾을 수 있게 — 전역 라우트는 경로에 프로젝트가 없다. */
  async projectOfApproval(approvalId: string): Promise<string> {
    const { rows } = await this.db.execute<{ project_id: string }>(
      sql`SELECT project_id FROM approval WHERE id = ${approvalId}`,
    );
    const projectId = rows[0]?.project_id;
    if (projectId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.not_found'), {
        kind: 'not_found',
        approval_id: approvalId,
      });
    }
    return projectId;
  }

  /**
   * EP-QST-01 — 질문 목록(프로젝트 소속). 기본은 `open` 이다.
   *
   * **어휘 판정이 여기 있다**(REQ-API-126). 예전에는 표면이 `status === 'answered' ? … : 'open'`
   * 로 접어, `?status=cancelled` 가 **열린 질문 목록을 200 으로** 돌려줬다 — REQ-API-109 가
   * 만든 상태를 조회할 길이 없으면서 물어본 쪽은 걸러진 목록이라고 믿는다.
   * 시그니처를 `string` 으로 넓히는 것이 요점이다: 리터럴 유니온은 컴파일러를 막지
   * **호출자(HTTP·MCP)를 막지 않는다.**
   */
  async questions(input: {
    projectId: string;
    status?: string | null;
  }): Promise<Record<string, unknown>[]> {
    const status = assertVocab(
      [input.status ?? 'open'],
      questionStatus.enumValues,
      'status',
    )[0] as string;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT q.id, q.title, q.body_md, q.options, q.urgency::text AS urgency,
             q.status::text AS status, q.answer_key, q.answer_md, q.asked_at, q.answered_at,
             se.hostname, se.agent_type::text AS agent_type, se.external_session_id,
             u.display_name AS asked_by, t.key AS task_key, s.key AS spec_key,
             q.finding_id, q.escalate::text AS escalate,
             extract(epoch FROM (now() - q.asked_at))::int AS waiting_seconds
        FROM question q
        JOIN agent_session se ON se.id = q.agent_session_id
        JOIN "user" u ON u.id = se.user_id
   LEFT JOIN task t ON t.id = q.task_id
   LEFT JOIN spec s ON s.id = q.spec_id
       WHERE q.project_id = ${input.projectId} AND q.status = ${status}::question_status
       ORDER BY q.asked_at DESC
    `);
    return rows;
  }

  /**
   * EP-APR-03 결정 — **사람 전용**이다.
   *
   * stale 승인 차단이 여기 있다: 카드를 연 시점의 content_hash 를 함께 받아 결정 시점의 것과
   * 비교한다. 다르면 거부한다 — 사람이 본 것과 승인되는 것이 달라지는 순간이 승인 게이트가
   * 형식이 되는 지점이다(승인 만료 윈도우·스테일 승인 거부 — agent-integration §2.2 근거).
   */
  async decide(input: {
    /** 사람 전용 게이트의 축 — 판정은 표면이 아니라 여기다(D-05 · REQ-API-111) */
    actor: Actor;
    projectId: string;
    approvalId: string;
    userId: string;
    decision: ApprovalDecision;
    comment?: string;
    /** 카드를 연 시점의 내용 지문. 없으면 검사하지 않는다(코멘트 결정 등) */
    seenContentHash?: string | null;
  }): Promise<{ decision: ApprovalDecision; subject_type: string; subject_id: string }> {
    // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
    const decision = assertVocab([input.decision], approvalDecision.enumValues, 'decision')[0];
    assertHuman(input.actor, 'inbox_decide', '/inbox');
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        id: string;
        subject_type: string;
        subject_id: string;
        requested_by_user_id: string;
        requested_by_session_id: string | null;
        assignee_user_id: string | null;
        assignee_role: string | null;
        decision: string | null;
        content_hash: string | null;
        author_user_id: string | null;
        author_owner_user_id: string | null;
        subject_status: string | null;
        submitted_at: string | null;
      }>(sql`
        SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
               a.requested_by_user_id, a.requested_by_session_id,
               a.assignee_user_id, a.assignee_role::text AS assignee_role,
               a.decision::text AS decision,
               encode(sv.content_hash, 'hex') AS content_hash,
               sv.author_user_id, owner.user_id AS author_owner_user_id,
               sv.status::text AS subject_status, sv.submitted_at::text AS submitted_at
          FROM approval a
     LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
     LEFT JOIN agent_session owner ON owner.id = sv.author_session_id
         WHERE a.id = ${input.approvalId} AND a.project_id = ${input.projectId}
         FOR UPDATE OF a
      `);
      const approval = rows[0];
      if (approval === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.not_found'), {
          kind: 'not_found',
        });
      }
      // **이 결재를 내릴 수 있는 사람인가**(EP-APR-03 "지정 승인자·해당 역할 큐").
      //
      // 예전에는 이 문이 "사람인가" 하나였다 — 전역 경로(`/api/v1/approvals/...`)라
      // 프로젝트 가드가 소속을 채우지 않고 지나가고, 서비스는 멤버십만 확인했다.
      // 그래서 `viewer` 도 스펙 승인을 확정할 수 있었다(그 다음은 문서가 approved 다).
      await this.assertMayDecide(
        input.projectId,
        input.userId,
        approval.assignee_user_id,
        approval.assignee_role,
      );

      if (approval.decision !== null) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.already_decided'), {
          kind: 'already_decided',
          decision: approval.decision,
        });
      }

      // stale 승인 차단 — 사람이 본 것과 승인되는 것이 같아야 한다
      if (
        input.seenContentHash != null &&
        approval.content_hash !== null &&
        input.seenContentHash !== approval.content_hash
      ) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.content_changed'), {
          kind: 'stale_approval',
          seen: input.seenContentHash,
          current: approval.content_hash,
        });
      }

      // **지시자≠승인자는 세 축이다**(2026-09-07 · REQ-API-136 · spec-workflow §2.3).
      //
      // 요청자만 비교하던 동안 구멍이 하나 있었다: 작성자가 남에게 제출을 부탁하면 요청자는
      // 그 남이 되고, 작성자는 자기 초안을 자기 손으로 승인할 수 있었다. 에이전트가 쓴
      // 초안도 같다 — 그 세션의 소유자가 승인하면 사람이 검토한 것이 아니라 자기가 시킨
      // 것을 자기가 통과시킨 것이다(D-01 이 막으려는 바로 그것).
      //
      // approve 에만 적용한다 — 코멘트·거절은 요청자도 작성자도 할 수 있다.
      const selfKind = selfKindOf(approval, input.userId);
      if (input.decision === 'approve' && selfKind !== null) {
        await this.assertSelfApprovalAllowed(tx, input.projectId, input.userId, approval, selfKind);
      }
      const selfApprove = selfKind !== null && input.decision === 'approve';

      await tx.execute(sql`
        UPDATE approval
           SET decision = ${decision}::approval_decision,
               comment_md = ${input.comment ?? null},
               decided_at = now(),
               assignee_user_id = COALESCE(assignee_user_id, ${input.userId})
         WHERE id = ${input.approvalId}
      `);

      // **결정은 대상을 움직여야 한다**(2026-08-31 — 사람 보고 · REQ-API-063).
      //
      // 예전에는 여기서 결재 행만 고치고 끝냈다. 그래서 받은편지함에서 스펙을 거절하면
      // 결재는 사라지는데(`decision IS NOT NULL`) **문서는 `in_review` 에 갇혔다** —
      // 가변 구간은 draft 하나뿐이라(D-02) 고칠 수도, 다시 제출할 수도 없는 상태다.
      // 실측(sudoku 2026-08-31): 거절 2건, 둘 다 `in_review` 로 남아 있었다.
      //
      // **같은 트랜잭션이다.** 웹이 두 번 부르게 하면 그 사이의 실패가 정확히 이 상태를
      // 다시 만들고, 판정이 표면으로 새어 나간다(D-05).
      await this.applyToSubject(tx, emit, input, approval);

      // **결정을 요청한 세션에게 돌려준다**(2026-09-07 · REQ-API-133 · FR-11).
      //
      // 이 자리는 오래 결재 행만 고쳤다. 그래서 A3 승인을 기다리는 에이전트는 승인이 나도
      // **영영 듣지 못했다** — 서버→세션 방향의 보장 채널은 하트비트 하나인데(§2.4) 결재
      // 결정이 거기 실리지 않았기 때문이다. 실데이터 결재 11건 중 4건이 세션 기원이었다.
      //
      // 깨우는 조건이 둘 더 있다: **다른 대기 사유가 남아 있으면 깨우지 않는다.** 열린
      // blocking 질문이나 아직 결정되지 않은 다른 결재가 있으면 그 세션은 여전히 사람을
      // 기다리는 중이고, 여기서 `active` 로 돌려놓으면 S5 는 일하고 있는 세션으로 그린다.
      if (approval.requested_by_session_id !== null) {
        await tx.execute(sql`
          UPDATE agent_session SET state = 'active'
           WHERE id = ${approval.requested_by_session_id}
             AND state = 'awaiting_input'
             AND NOT EXISTS (
               SELECT 1 FROM question q
                WHERE q.agent_session_id = ${approval.requested_by_session_id}
                  AND q.status = 'open' AND q.urgency = 'blocking'
             )
             AND NOT EXISTS (
               SELECT 1 FROM approval a2
                WHERE a2.requested_by_session_id = ${approval.requested_by_session_id}
                  AND a2.id <> ${input.approvalId} AND a2.decision IS NULL
             )
        `);
      }

      await emit({
        // **결재는 결재다**(2026-09-07 · REQ-API-128). 대상이 질문이든 스펙이든 이 자리가
        // 남기는 사실은 "결재가 결정됐다" 이고, 질문에 답한 사실은 `QuestionService` 가
        // 자기 자리에서 남긴다 — 하나의 이름이 둘을 가리키면 어느 쪽도 셀 수 없다.
        type: NERV_EVENT.APPROVAL_DECIDED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: input.approvalId,
        actorUserId: input.userId,
        isAgent: false,
        toState: input.decision,
        // **자기 승인은 그 사실을 남긴다.** 규칙의 예외를 허용하는 것과 그것을 감추는 것은
        // 다른 일이다 — 감사가 나중에 "이 결재는 한 사람이 양쪽에 섰다" 를 셀 수 있어야 한다.
        payload: {
          decision: input.decision,
          subject_type: approval.subject_type,
          subject_id: approval.subject_id,
          ...(selfApprove ? { self_approved: true, self_kind: selfKind } : {}),
        },
      });

      return {
        decision: input.decision,
        subject_type: approval.subject_type,
        subject_id: approval.subject_id,
      };
    });
  }

  /**
   * **하트비트 역채널에 실을 결재 결정**(2026-09-07 · REQ-API-133).
   *
   * 질문 답변과 같은 창(1시간)·같은 상한(10건)이고, 같은 규율이다: **전달로 소멸하지
   * 않는다.** 하트비트는 유실될 수 있는 호출이라 한 번 실어 보내고 지우면 그 결정은
   * 아무도 모르는 결정이 된다 — 창이 닫힐 때까지 매번 다시 싣고, 중복 처리는 에이전트가
   * 멱등으로 감당한다(`question_answered` 가 이미 그 규약이다).
   *
   * 이 채널이 없던 동안 `NERV_APPROVAL_REQUIRED` 는 "하트비트로 확인하라" 는 다음 행동을
   * 주면서 정작 하트비트에 그 결과를 싣지 않았다 — 있는 것처럼 말하는 채널이 없는 채널보다
   * 나쁘다.
   */
  async pendingDecisionsFor(sessionId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT 'approval_decided' AS kind, a.id AS approval_id,
             a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.comment_md,
             a.decided_at::text AS decided_at, u.display_name AS decided_by,
             COALESCE(s.key, t.key, f.title) AS subject_key
        FROM approval a
   LEFT JOIN "user" u ON u.id = a.assignee_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN task t ON t.id = a.subject_id AND a.subject_type = 'plan'
   LEFT JOIN finding f ON f.id = a.subject_id AND a.subject_type = 'finding'
       WHERE a.requested_by_session_id = ${sessionId}
         AND a.decision IS NOT NULL
         AND a.decided_at > now() - interval '1 hour'
       ORDER BY a.decided_at DESC LIMIT 10
    `);
    return rows;
  }

  /**
   * EP-APR-04 게이트 면제 — **면제도 결재 레코드다**(FR-10).
   * 사유가 없으면 CHECK 가 막는다(4.3 §2.8). 기록되지 않는 면제는 면제가 아니라 구멍이다.
   *
   * **사람 전용이고 판정은 여기다**(REQ-API-123). 역할 문턱(`@RequireRole`)만으로는 막히지
   * 않는다 — PAT 도 소유자의 멤버십 역할로 그 문턱을 지난다(`project-access.guard.ts`).
   * 게이트가 사유 검사보다 앞이라 에이전트 호출은 DB 를 한 번도 건드리지 않는다.
   */
  async bypass(input: {
    projectId: string;
    subjectType: 'spec_version' | 'change_request' | 'plan' | 'question' | 'gate_bypass';
    subjectId: string;
    userId: string;
    reason: string;
    actor: Actor;
  }): Promise<{ approval_id: string }> {
    assertHuman(input.actor, 'bypass');
    if (input.reason.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.waiver_reason_required'), {
        kind: 'bypass_reason_required',
      });
    }
    return this.events.transact(async (tx, emit) => {
      const approvalId = newId();
      await tx.execute(sql`
        INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                              decision, decided_at, is_bypass, bypass_reason)
        VALUES (${approvalId}, ${input.projectId}, ${input.subjectType}::approval_subject_type,
                ${input.subjectId}, ${input.userId}, 'approve', now(), true, ${input.reason})
      `);
      await emit({
        type: NERV_EVENT.GATE_BYPASSED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: approvalId,
        actorUserId: input.userId,
        isAgent: input.actor.isAgent,
        payload: { reason: input.reason },
      });
      return { approval_id: approvalId };
    });
  }

  /** 승인 요청 생성 — SpecService 가 부르는 것과 같은 재사용 규칙을 쓴다. */
  async request(input: {
    projectId: string;
    subjectType: 'spec_version' | 'change_request' | 'plan' | 'question';
    subjectId: string;
    requestedByUserId: string;
    /**
     * **누가 기다리고 있는가**(2026-09-07 · REQ-API-133). 이 값이 비어 있으면 결정이 나도
     * 돌려줄 곳이 없다 — 하트비트 역채널은 이 열로 수신자를 찾는다.
     */
    requestedBySessionId?: string | null;
    assigneeUserId?: string | null;
    /**
     * **직군 슬롯**(2026-09-07 · REQ-API-138). 매트릭스의 ○ 는 "지정 시" 라는 뜻이고 이 열이
     * 그 지정이다 — 이 값이 있으면 그 역할(과 admin)만 이 카드를 내린다.
     */
    assigneeRole?: string | null;
  }): Promise<{ approval_id: string; reused: boolean }> {
    return this.events.transact(async (tx, emit) => {
      const { rows: existing } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM approval
         WHERE project_id = ${input.projectId} AND subject_type = ${input.subjectType}::approval_subject_type
           AND subject_id = ${input.subjectId} AND decision IS NULL
      `);
      const found = existing[0]?.id;
      if (found !== undefined) return { approval_id: found, reused: true };

      const approvalId = newId();
      await tx.execute(sql`
        INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                              requested_by_session_id, assignee_user_id, assignee_role)
        VALUES (${approvalId}, ${input.projectId}, ${input.subjectType}::approval_subject_type,
                ${input.subjectId}, ${input.requestedByUserId},
                ${input.requestedBySessionId ?? null}, ${input.assigneeUserId ?? null},
                ${input.assigneeRole ?? null}::member_role)
      `);
      await emit({
        type: NERV_EVENT.APPROVAL_REQUESTED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: approvalId,
        actorUserId: input.requestedByUserId,
        isAgent: false,
      });
      return { approval_id: approvalId, reused: false };
    });
  }

  /** 콘텐츠 지문 — 카드가 보여준 것과 승인되는 것이 같은지 판정하는 축이다. */
  static hashOf(body: string): string {
    return createHash('sha256').update(body, 'utf8').digest('hex');
  }

  /**
   * 자기가 요청한 결재를 자기가 승인할 수 있는가 — **두 가지 완화**가 있다.
   *
   * ① **소규모**: 프로젝트에 사람이 하나뿐이면 규칙이 성립하지 않는다. 둘째 사람이 없는데
   *    "둘째 사람이 승인하라" 는 것은 요구가 아니라 막다른 길이다.
   * ② **admin**(2026-08-30 — 사람 결정): 조직·프로젝트를 책임지는 사람은 자기 요청을
   *    스스로 결재할 수 있다. 지시자≠승인자 규칙이 막으려는 것은 **에이전트가 자기 산출물을
   *    통과시키는 것**이고(D-01), 사람 admin 이 자기 판단에 서명하는 것은 다른 일이다 —
   *    admin 이 없으면 그 프로젝트의 어떤 결재도 끝나지 않는 상황이 생긴다.
   *
   * 둘 다 **감사에 남는다**: 이벤트 페이로드의 `self_approved` 가 그 자리다.
   * 예외를 허용하는 것과 그것을 감추는 것은 다른 일이다.
   */
  private async assertSelfApprovalAllowed(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    projectId: string,
    userId: string,
    approval: { requested_by_user_id: string; author_user_id: string | null },
    selfKind: 'requester' | 'author' | 'session_owner',
  ): Promise<void> {
    // **소규모 완화의 축은 멤버 수가 아니라 승인 가능한 사람 수다**(2026-09-07 · §2.3 문장
    // 그대로: "승인 가능한 다른 역할이 없으면 자동 완화"). 멤버를 세면 viewer 다섯이 있는
    // 프로젝트에서 완화가 꺼지고, 그 다섯 중 누구도 결재를 내릴 수 없어 문서가 갇힌다.
    // 조직 단위 멤버십은 **그 조직의 것만** 센다(REQ-API-125).
    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT m.user_id)::int AS n FROM membership m
        JOIN project p ON p.id = ${projectId}
       WHERE m.org_id = p.org_id
         AND (m.project_id = p.id OR m.project_id IS NULL)
         AND m.role::text IN (${sql.join(
           DECIDER_ROLES.map((r) => sql`${r}`),
           sql`, `,
         )})
         AND m.user_id <> ${userId}
         AND m.user_id <> ${approval.requested_by_user_id}
         AND (${approval.author_user_id}::uuid IS NULL OR m.user_id <> ${approval.author_user_id})
    `);
    if ((rows[0]?.n ?? 0) === 0) {
      this.logger.warn(`소규모 완화 — 자기 승인을 허용한다(감사 기록됨) user=${userId}`);
      return;
    }

    // 프로젝트 멤버십과 **조직 단위 멤버십**을 함께 본다 — 조직 admin 만 가진 사람은
    // 프로젝트 행이 없어서 한 행 판정에서는 아무 역할도 없는 사람이 된다(2026-08-24 와 같은 함정).
    const { rows: admin } = await tx.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM membership
       WHERE user_id = ${userId} AND role = 'admin'
         AND (project_id = ${projectId}
              OR (project_id IS NULL
                  AND org_id = (SELECT org_id FROM project WHERE id = ${projectId})))
       LIMIT 1
    `);
    if (admin[0]?.ok === true) {
      this.logger.warn(`admin 자기 승인 — 허용한다(감사 기록됨) user=${userId}`);
      return;
    }

    // 축마다 다른 문장을 준다 — "요청자는 승인할 수 없습니다" 를 작성자에게 보이면
    // 그 사람은 자기가 요청하지 않았다는 것을 알기 때문에 화면이 틀렸다고 읽는다.
    const key =
      selfKind === 'author'
        ? 'error.auth.self_approve_author'
        : selfKind === 'session_owner'
          ? 'error.auth.self_approve_session_owner'
          : 'error.auth.self_approve';
    throw new NervError(NERV_ERROR.FORBIDDEN, msg(key), {
      kind: 'self_approval',
      self_kind: selfKind,
      // 막다른 길에 세우지 않는다 — 누가 할 수 있는지 말한다
      allowed_roles: DECIDER_ROLES,
    });
  }
}
