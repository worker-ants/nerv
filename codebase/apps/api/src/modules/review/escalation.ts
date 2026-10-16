// 에스컬레이션 카드 · 변경 요청에 묶인 발견 (2026-10-16 · 사람 결정 D3 · spec-workflow §3.4 · §4.7)
//   정본: api.md REQ-API-332 ~ 337 · data-model §2.6(`resolution.blocking`) · §2.7(`approval.subject_type = escalation`)
//
// **발견을 사람에게 넘기면 받은 요청에 카드가 선다.** `escalated` 처분은 2026-09-05 부터 있었지만 카드가 없어 아무에게도 가지
// 않았다 — 넘긴 것은 해결한 것이 아니라는 규칙(REQ-API-108)만 있고 넘겨받는 사람이 없었다. 카드는 결재 행이다: 대상은 넘긴 처분
// 한 건(`resolution` · `kind = escalated`)이고 받는 사람은 사유가 정한다(`ESCALATION_ROUTE_ROLES`). 결재 행으로 둔 이유는 받은
// 요청 · 알림 · 처리됨 탭 · 세션의 대기와 깨움 · 하트비트의 `approval_decided` 가 이미 그 행 위에서 돈다는 데 있다 — 같은 일을
// 두 번째 갈래로 만들면 한쪽만 고쳐진다.
//
// 클래스 밖의 함수로 둔다(TaskService 의 `recomputeImplStatus` · CR 의 `openChangeRequestInTx` 와 같은 모양). 처분 · 결재 결정 ·
// 변경 요청의 승인과 거절이 **같은 트랜잭션 안에서** 부른다.

import {
  ESCALATION_ROUTE_ROLES,
  msg,
  NERV_ERROR,
  NERV_EVENT,
  NERV_EVENT_PHASE2,
  newId,
  text,
} from '@nerv/schema';
import { displayKey } from '@nerv/schema/keys';
import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { closeRequestNotifications } from '../event/request-notifications.js';
import type { EventInput } from '../event/event.service.js';
import { recomputeImplStatus } from '../spec/impl-status.js';
import { wakeWaitingSessionInTx } from '../approval/session-wake.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];
type EmitFn = (input: EventInput) => Promise<unknown>;

/** 되돌림 작업 제목의 상한 — 파생 작업과 같은 길이(목록 한 줄) */
const REVERT_TITLE_MAX = 120;

export type ResolutionKindValue = 'fixed' | 'deferred' | 'dismissed' | 'escalated' | 'spec_change';
export type FindingStatusValue = 'open' | 'fixed' | 'dismissed' | 'wont_fix';

/** 처분 한 건 — 표면(EP-REV-02 · 도구)과 카드의 결정 · 변경 요청의 승인과 거절이 같은 모양으로 쓴다 */
export interface ResolutionWrite {
  projectId: string;
  findingId: string;
  userId: string;
  sessionId: string | null;
  isAgent: boolean;
  kind: ResolutionKindValue;
  status: FindingStatusValue;
  rationale: string;
  commitSha?: string | null;
  changeRequestId?: string | null;
  specVersionId?: string | null;
  escalateReason?: string | null;
  blocking?: boolean;
  /** `finding.resolved` payload 에 더할 것 — 변경 요청의 키 등 */
  extraPayload?: Record<string, unknown>;
}

/**
 * **처분 한 건을 남긴다** — 발견을 잠그고, 다른 처분으로 뒤집지 않는지 보고, 기록과 상태를 쓰고, `finding.resolved` 를 낸 뒤 구현
 * 축을 다시 파생한다(REQ-API-315). EP-REV-02 · `nerv_finding_resolve` 의 트랜잭션 몸통이고, 에스컬레이션 카드의 결정과 변경 요청의
 * 승인 · 거절이 같은 자리를 지난다 — 처분이 길마다 다른 모양으로 남으면 "이 발견은 어떻게 닫혔나" 의 답이 갈라진다.
 */
export async function writeResolutionInTx(
  tx: Tx,
  emit: EmitFn,
  input: ResolutionWrite,
): Promise<{ resolution_id: string; from_status: string; severity: string }> {
  const { rows } = await tx.execute<{
    severity: string;
    status: string;
    last_session_id: string;
  }>(sql`
    SELECT severity::text AS severity, status::text AS status, last_session_id FROM finding
     WHERE id = ${input.findingId} AND project_id = ${input.projectId}
     FOR UPDATE
  `);
  const finding = rows[0];
  if (finding === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.finding_not_found'), {
      kind: 'not_found',
      finding_id: input.findingId,
    });
  }
  // **멱등은 같은 처분에만.** 이미 fixed 인 것을 다시 fixed 로 부르면 그대로 통과하고, 다른 처분으로 부르면 막는다 — 처분을
  // 뒤집는 것은 재호출이 아니라 새 판단이다.
  if (finding.status !== 'open' && finding.status !== input.status) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.already_resolved'), {
      kind: 'already_resolved',
      status: finding.status,
    });
  }

  const resolutionId = newId();
  await tx.execute(sql`
    INSERT INTO resolution (id, finding_id, kind, commit_sha, change_request_id,
                            spec_version_id, escalate_reason, blocking, rationale_md,
                            actor_user_id, actor_session_id)
    VALUES (${resolutionId}, ${input.findingId}, ${input.kind}::resolution_kind,
            ${input.commitSha ?? null}, ${input.changeRequestId ?? null},
            ${input.specVersionId ?? null}, ${input.escalateReason ?? null}::escalate_reason,
            ${input.blocking ?? false}, ${input.rationale}, ${input.userId}, ${input.sessionId})
  `);
  await tx.execute(sql`
    UPDATE finding SET status = ${input.status}::finding_status WHERE id = ${input.findingId}
  `);

  await emit({
    type: NERV_EVENT_PHASE2.FINDING_RESOLVED,
    projectId: input.projectId,
    actorUserId: input.userId,
    actorSessionId: input.sessionId,
    isAgent: input.isAgent,
    subjectType: 'finding',
    subjectId: input.findingId,
    fromState: finding.status,
    toState: input.status,
    // 라운드는 알림을 묶는 열쇠다(§6.3 `review:{id}:resolutions` · 2026-10-15 · REQ-API-316) — 발견을 마지막으로 본 라운드
    payload: {
      kind: input.kind,
      severity: finding.severity,
      downgrade:
        finding.severity === 'critical' &&
        (input.status === 'dismissed' || input.status === 'wont_fix'),
      review_session_id: finding.last_session_id,
      ...(input.escalateReason == null ? {} : { escalate_reason: input.escalateReason }),
      ...(input.kind === 'escalated' ? { blocking: input.blocking ?? false } : {}),
      ...(input.extraPayload ?? {}),
    },
  });

  // **처분은 검증의 재료다**(2026-10-15 · E15-S03 · REQ-API-315) — 그 발견이 가리키는 요구사항과, 그 발견을 관찰한 라운드의
  // 작업이 맡은 요구사항을 다시 파생한다. 열린 critical 이 닫힌 순간이 검증이 설 수 있는 순간이다
  const { rows: affected } = await tx.execute<{ id: string }>(sql`
    SELECT requirement_id AS id FROM finding
     WHERE id = ${input.findingId} AND requirement_id IS NOT NULL
    UNION
    SELECT t.source_requirement_id AS id
      FROM finding_occurrence o
      JOIN review_session rs ON rs.id = o.review_session_id
      JOIN task t ON t.id = rs.task_id
     WHERE o.finding_id = ${input.findingId} AND t.source_requirement_id IS NOT NULL
  `);
  for (const row of affected) await recomputeImplStatus(tx, row.id);

  return { resolution_id: resolutionId, from_status: finding.status, severity: finding.severity };
}

// ── 에스컬레이션 카드 ──────────────────────────────────────────────────────────────

/** 기다리는 에스컬레이션 카드 한 장 — 그 발견의 것 */
export interface PendingEscalation extends Record<string, unknown> {
  approval_id: string;
  resolution_id: string;
  escalate_reason: string | null;
  change_request_id: string | null;
  blocking: boolean;
  requested_by_session_id: string | null;
  assignee_role: string | null;
}

/** 그 발견의 기다리는 에스컬레이션 카드 — 변경 요청으로 보낸 카드(`withCr`)와 아닌 것을 나눠 읽는다 */
export async function pendingEscalationsOf(
  tx: Tx | NervDb,
  findingId: string,
  which: 'plain' | 'cr' | 'all' = 'all',
): Promise<PendingEscalation[]> {
  const filter =
    which === 'plain'
      ? sql` AND r.change_request_id IS NULL`
      : which === 'cr'
        ? sql` AND r.change_request_id IS NOT NULL`
        : sql``;
  const { rows } = await tx.execute<PendingEscalation>(sql`
    SELECT a.id AS approval_id, r.id AS resolution_id, r.escalate_reason::text AS escalate_reason,
           r.change_request_id, r.blocking, a.requested_by_session_id,
           a.assignee_role::text AS assignee_role
      FROM approval a
      JOIN resolution r ON r.id = a.subject_id
     WHERE a.subject_type = 'escalation' AND a.decision IS NULL
       AND r.finding_id = ${findingId}${filter}
     ORDER BY a.requested_at
  `);
  return rows;
}

/**
 * **카드를 받는 사람**(2026-10-16 · 사람 결정 D3 · spec-workflow §4.7). 사유에 역할 자리가 있으면 그 역할(`spec` → planner ·
 * `infra` · `sensitive-fix` → admin), 없으면 그 발견이 나온 작업의 담당자다 — 결재 행의 `assignee_user_id` 에 두고, 에스컬레이션
 * 카드에서는 그 칸이 **기본 큐에 더하는 사람**이라는 뜻이다(결재 판정 `eligibleSql` · 알림 `approvalTargets` 가 같은 규칙을 본다).
 * 담당자가 없으면 기본 큐만이다. 변경 요청으로 보낸 카드는 언제나 planner 다 — 그 CR 의 주인이다.
 */
async function escalationAssignee(
  tx: Tx,
  findingId: string,
  reason: string,
  withCr: boolean,
): Promise<{ role: string | null; userId: string | null }> {
  if (withCr) return { role: 'planner', userId: null };
  const role = ESCALATION_ROUTE_ROLES[reason] ?? null;
  if (role !== null) return { role, userId: null };
  const { rows } = await tx.execute<{ assignee_user_id: string | null }>(sql`
    SELECT t.assignee_user_id FROM finding f
      JOIN review_session rs ON rs.id = f.last_session_id
      JOIN task t ON t.id = rs.task_id
     WHERE f.id = ${findingId}
  `);
  return { role: null, userId: rows[0]?.assignee_user_id ?? null };
}

/**
 * **에스컬레이션 카드를 세운다**(REQ-API-333 · 334). 처분(`escalated`)과 같은 트랜잭션이다 — 카드 없이 처분만 남으면 넘긴 것을
 * 아무도 받지 않는다. 기다리는 처분이면 그 세션을 `awaiting_input` 으로 둔다.
 */
export async function openEscalationInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    findingId: string;
    resolutionId: string;
    reason: string;
    blocking: boolean;
    userId: string;
    sessionId: string | null;
    isAgent: boolean;
    changeRequest?: { id: string; key: string } | null;
  },
): Promise<{ approval_id: string; assignee_role: string | null; assignee_user_id: string | null }> {
  const assignee = await escalationAssignee(
    tx,
    input.findingId,
    input.reason,
    input.changeRequest != null,
  );
  const approvalId = newId();
  await tx.execute(sql`
    INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                          requested_by_session_id, assignee_user_id, assignee_role)
    VALUES (${approvalId}, ${input.projectId}, 'escalation'::approval_subject_type,
            ${input.resolutionId}, ${input.userId}, ${input.sessionId},
            ${assignee.userId}, ${assignee.role}::member_role)
  `);
  await emit({
    type: NERV_EVENT.APPROVAL_REQUESTED,
    projectId: input.projectId,
    actorUserId: input.userId,
    actorSessionId: input.sessionId,
    isAgent: input.isAgent,
    subjectType: 'approval',
    subjectId: approvalId,
    payload: {
      subject_type: 'escalation',
      finding_id: input.findingId,
      escalate_reason: input.reason,
      blocking: input.blocking,
      ...(input.changeRequest == null ? {} : { change_request_key: input.changeRequest.key }),
    },
  });
  // **기다리는 세션은 기다린다고 말한다**(REQ-API-134 와 같은 자리) — 카드의 결정이 푼다(`wakeWaitingSessionInTx`)
  if (input.blocking && input.sessionId !== null) {
    await tx.execute(sql`
      UPDATE agent_session SET state = 'awaiting_input'
       WHERE id = ${input.sessionId} AND state IN ('pending', 'active')
    `);
  }
  return {
    approval_id: approvalId,
    assignee_role: assignee.role,
    assignee_user_id: assignee.userId,
  };
}

/**
 * **카드를 닫는다** — 카드의 결정이 아닌 길로 그 일이 끝났을 때다(REQ-API-335 · 337). 발견을 다른 길(리뷰 센터 · 도구)로 처분했거나,
 * 변경 요청으로 보냈거나, 그 변경 요청이 승인 · 거절 · 철회됐다. 남은 카드를 대기에 두면 사람은 이미 끝난 일을 다시 결정한다.
 * 결정한 사람은 그 일을 한 사람이고 결정 이벤트의 `resolution` 이 무엇으로 끝났는지를 든다. 기다리던 세션은 다른 대기 사유가 없으면
 * 깨어난다 — 하트비트가 그 결정을 `approval_decided` 로 전한다.
 */
export async function settleEscalationsInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    approvals: readonly PendingEscalation[];
    decision: 'approve' | 'reject';
    /** 무엇으로 끝났는가 — `fix` · `wont_fix` · `dismissed` · `fixed` · `spec_change` · `change_request` · `withdrawn` */
    resolution: string;
    comment: string;
    userId: string;
    sessionId: string | null;
    isAgent: boolean;
    findingId: string;
    changeRequestKey?: string | null;
  },
): Promise<void> {
  for (const pending of input.approvals) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      UPDATE approval
         SET decision = ${input.decision}::approval_decision, comment_md = ${input.comment},
             decided_at = now(), assignee_user_id = COALESCE(assignee_user_id, ${input.userId}),
             decided_by_user_id = ${input.userId}
       WHERE id = ${pending.approval_id} AND decision IS NULL
      RETURNING id
    `);
    if (rows.length === 0) continue;
    if (pending.requested_by_session_id !== null) {
      await wakeWaitingSessionInTx(tx, pending.requested_by_session_id, [pending.approval_id]);
    }
    await closeRequestNotifications(tx, 'approval', pending.approval_id);
    await emit({
      type: NERV_EVENT.APPROVAL_DECIDED,
      projectId: input.projectId,
      subjectType: 'approval',
      subjectId: pending.approval_id,
      actorUserId: input.userId,
      actorSessionId: input.sessionId,
      isAgent: input.isAgent,
      toState: input.decision,
      payload: {
        decision: input.decision,
        subject_type: 'escalation',
        subject_id: pending.resolution_id,
        finding_id: input.findingId,
        resolution: input.resolution,
        // 카드에서 누른 결정이 아니다 — 그 일이 다른 길로 끝나 카드를 닫았다
        settled: true,
        ...(input.changeRequestKey == null ? {} : { change_request_key: input.changeRequestKey }),
      },
    });
  }
}

// ── 변경 요청에 묶인 발견(spec-workflow §3.4) ─────────────────────────────────────────

/** 변경 요청으로 보낼 발견 — 열려 있고 `spec_drift` 태그가 있어야 한다 */
export interface DriftFinding extends Record<string, unknown> {
  id: string;
  title: string;
  detail_md: string | null;
  severity: string;
  status: string;
  tags: string[];
  spec_id: string | null;
  head_sha: string | null;
}

/** 발견 한 건을 잠그고 읽는다 — 변경 요청으로 보낼 수 있는지 판정한다(REQ-API-332) */
export async function lockDriftFinding(
  tx: Tx,
  projectId: string,
  findingId: string,
): Promise<DriftFinding> {
  const { rows } = await tx.execute<DriftFinding>(sql`
    SELECT f.id, f.title, f.detail_md, f.severity::text AS severity, f.status::text AS status,
           f.tags, coalesce(sv.spec_id, rq.spec_id) AS spec_id, rs.head_sha
      FROM finding f
 LEFT JOIN spec_version sv ON sv.id = f.spec_version_id
 LEFT JOIN requirement rq ON rq.id = f.requirement_id
 LEFT JOIN review_session rs ON rs.id = f.last_session_id
     WHERE f.project_id = ${projectId} AND f.id = ${findingId}::uuid
       FOR UPDATE OF f
  `);
  const finding = rows[0];
  if (finding === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.finding_not_found'), {
      kind: 'not_found',
      finding_id: findingId,
    });
  }
  if (finding.status !== 'open') {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.already_resolved'), {
      kind: 'already_resolved',
      status: finding.status,
    });
  }
  // **스펙이 틀렸다는 지적만 보낸다** — 코드가 틀렸으면 고치고, 판단이 필요하면 에스컬레이션이다. 태그가 그 구별의 근거다
  if (!finding.tags.includes('spec_drift')) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.not_spec_drift'), {
      kind: 'not_spec_drift',
      finding_id: finding.id,
    });
  }
  return finding;
}

/**
 * **발견을 변경 요청에 묶는다**(REQ-API-332). 처분은 `escalated`(사유 `spec`)이고 `change_request_id` 가 그 CR 이다 — 발견은 열린
 * 채로 남는다(넘긴 것은 해결한 것이 아니다). 근거 칸에 넘긴 이유를, 커밋 칸에 그 발견을 마지막으로 본 라운드의 커밋을 남긴다 —
 * CR 을 보는 사람이 "어느 구현이 스펙을 바꿨나" 를 거기서 읽는다.
 *
 * 그 발견에 서 있던 에스컬레이션 카드(사유 `spec` 이 보통이다)는 이 일로 끝난다 — `change_request` 로 닫고 기다리던 세션을 깨운다.
 * 그 CR 에 planner 의 카드가 아직 없으면 하나 세운다(CR 하나에 카드 하나 — 같은 CR 로 여러 발견을 보내도 카드는 늘지 않는다).
 * 이미 같은 CR 에 묶인 발견이면 아무것도 하지 않는다. 다른 열린 CR 에 묶여 있으면 409 다.
 */
export async function linkFindingToCrInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    finding: DriftFinding;
    changeRequest: { id: string; key: string };
    userId: string;
    sessionId: string | null;
    isAgent: boolean;
    rationale: string;
  },
): Promise<{ linked: boolean; resolution_id: string | null; approval_id: string | null }> {
  const { rows: current } = await tx.execute<{ change_request_id: string; key: string }>(sql`
    SELECT r.change_request_id, cr.key FROM resolution r
      JOIN change_request cr ON cr.id = r.change_request_id
     WHERE r.finding_id = ${input.finding.id} AND r.kind = 'escalated'
       AND cr.status IN ('open', 'in_review')
     ORDER BY r.created_at DESC LIMIT 1
  `);
  const linked = current[0];
  if (linked !== undefined) {
    if (linked.change_request_id === input.changeRequest.id) {
      return { linked: false, resolution_id: null, approval_id: null };
    }
    throw new NervError(
      NERV_ERROR.PRECONDITION,
      msg('error.review.finding_in_other_cr', { change_request_key: linked.key }),
      {
        kind: 'finding_in_other_cr',
        change_request_key: linked.key,
      },
    );
  }

  const written = await writeResolutionInTx(tx, emit, {
    projectId: input.projectId,
    findingId: input.finding.id,
    userId: input.userId,
    sessionId: input.sessionId,
    isAgent: input.isAgent,
    kind: 'escalated',
    status: 'open',
    rationale: input.rationale,
    commitSha: input.finding.head_sha,
    changeRequestId: input.changeRequest.id,
    escalateReason: 'spec',
    blocking: false,
    extraPayload: { change_request_key: input.changeRequest.key },
  });

  // 서 있던 카드는 이 일로 끝났다 — 넘겨받은 사람(또는 넘긴 세션 자신)이 변경 요청으로 보냈다
  await settleEscalationsInTx(tx, emit, {
    projectId: input.projectId,
    approvals: await pendingEscalationsOf(tx, input.finding.id, 'plain'),
    decision: 'approve',
    resolution: 'change_request',
    comment: text('agent.escalation.sent_to_cr', { cr: input.changeRequest.key }),
    userId: input.userId,
    sessionId: input.sessionId,
    isAgent: input.isAgent,
    findingId: input.finding.id,
    changeRequestKey: input.changeRequest.key,
  });

  // **CR 하나에 planner 카드 하나**(REQ-API-333) — 스펙을 고칠 사람에게 "구현이 스펙을 바꿨다" 를 알린다
  const { rows: card } = await tx.execute<{ id: string }>(sql`
    SELECT a.id FROM approval a JOIN resolution r ON r.id = a.subject_id
     WHERE a.subject_type = 'escalation' AND a.decision IS NULL
       AND r.change_request_id = ${input.changeRequest.id}
     LIMIT 1
  `);
  const approvalId =
    card[0]?.id ??
    (
      await openEscalationInTx(tx, emit, {
        projectId: input.projectId,
        findingId: input.finding.id,
        resolutionId: written.resolution_id,
        reason: 'spec',
        blocking: false,
        userId: input.userId,
        sessionId: input.sessionId,
        isAgent: input.isAgent,
        changeRequest: input.changeRequest,
      })
    ).approval_id;
  return { linked: true, resolution_id: written.resolution_id, approval_id: approvalId };
}

/**
 * **변경 요청이 끝났다 → 그 CR 로 보낸 발견**(spec-workflow §3.4 · REQ-API-337).
 *
 * - **승인** — 발견은 `fixed` 로 닫힌다. 처분은 `spec_change`(스펙을 고쳐 해결했다)이고 근거는 승인된 버전이다 — 커밋이 코드 쪽
 *   증거이듯 승인본이 문서 쪽 증거다(2026-08-30 · `resolution_spec_change_cr_ck`).
 * - **거절** — 발견은 `dismissed`(기각)로 닫히고 **코드 되돌림 작업**을 만든다. 스펙이 진실이라는 원칙이 이긴 것이다 — 구현이 스펙을
 *   벗어났으니 구현을 스펙으로 돌린다. 작업은 `backlog` 이고 담당과 기준은 그 발견이 나온 작업에서 옮긴다.
 * - **철회** — 발견은 열린 채로 둔다. 이 제안이 그 길이 아니었을 뿐 지적이 사라진 것은 아니다(리뷰 센터에서 다시 보낼 수 있다).
 *
 * 어느 쪽이든 그 CR 의 planner 카드와 그 발견들에 남은 카드는 닫힌다.
 */
export async function settleDriftFindingsInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    changeRequest: { id: string; key: string };
    outcome: 'approved' | 'rejected' | 'withdrawn';
    /** 승인된 버전 — 승인이면 필수 */
    approvedVersionId?: string | null;
    approvedVersionNo?: number | null;
    reason?: string | null;
    userId: string;
    sessionId: string | null;
    isAgent: boolean;
  },
): Promise<{ resolved: string[]; revert_tasks: string[] }> {
  const { rows: findings } = await tx.execute<{
    id: string;
    title: string;
    severity: string;
    file_path: string | null;
    line_start: number | null;
    spec_version_id: string | null;
    requirement_id: string | null;
    promoted_task_id: string | null;
    head_sha: string | null;
    task_assignee: string | null;
    task_spec_version_id: string | null;
    task_requirement_id: string | null;
    task_key: string | null;
  }>(sql`
    SELECT DISTINCT ON (f.id) f.id, f.title, f.severity::text AS severity, f.file_path, f.line_start,
           f.spec_version_id, f.requirement_id, f.promoted_task_id,
           coalesce(r.commit_sha, rs.head_sha) AS head_sha,
           t.assignee_user_id AS task_assignee, t.source_spec_version_id AS task_spec_version_id,
           t.source_requirement_id AS task_requirement_id, t.key AS task_key
      FROM resolution r
      JOIN finding f ON f.id = r.finding_id
 LEFT JOIN review_session rs ON rs.id = f.last_session_id
 LEFT JOIN task t ON t.id = rs.task_id
     WHERE r.change_request_id = ${input.changeRequest.id} AND r.kind = 'escalated'
       AND f.status = 'open'
     ORDER BY f.id, r.created_at DESC
  `);
  const resolved: string[] = [];
  const revertTasks: string[] = [];
  for (const finding of findings) {
    if (input.outcome === 'approved' && input.approvedVersionId != null) {
      await writeResolutionInTx(tx, emit, {
        projectId: input.projectId,
        findingId: finding.id,
        userId: input.userId,
        sessionId: input.sessionId,
        isAgent: input.isAgent,
        kind: 'spec_change',
        status: 'fixed',
        rationale: outcomeComment(input),
        changeRequestId: input.changeRequest.id,
        specVersionId: input.approvedVersionId,
        extraPayload: { change_request_key: input.changeRequest.key },
      });
      resolved.push(finding.id);
    } else if (input.outcome === 'rejected') {
      const reason = (input.reason ?? '').trim();
      await writeResolutionInTx(tx, emit, {
        projectId: input.projectId,
        findingId: finding.id,
        userId: input.userId,
        sessionId: input.sessionId,
        isAgent: input.isAgent,
        kind: 'dismissed',
        status: 'dismissed',
        rationale: outcomeComment(input),
        changeRequestId: input.changeRequest.id,
        extraPayload: { change_request_key: input.changeRequest.key },
      });
      resolved.push(finding.id);
      revertTasks.push(
        await createRevertTaskInTx(tx, emit, {
          projectId: input.projectId,
          finding,
          crKey: input.changeRequest.key,
          reason: reason === '' ? '—' : reason,
          userId: input.userId,
          sessionId: input.sessionId,
          isAgent: input.isAgent,
        }),
      );
    }
    // 그 발견에 남은 카드(변경 요청으로 보내지 않은 것)도 이 결말로 닫는다
    if (input.outcome !== 'withdrawn') {
      await settleEscalationsInTx(tx, emit, {
        projectId: input.projectId,
        approvals: await pendingEscalationsOf(tx, finding.id, 'plain'),
        decision: input.outcome === 'approved' ? 'approve' : 'reject',
        resolution: input.outcome === 'approved' ? 'spec_change' : 'dismissed',
        comment: outcomeComment(input),
        userId: input.userId,
        sessionId: input.sessionId,
        isAgent: input.isAgent,
        findingId: finding.id,
        changeRequestKey: input.changeRequest.key,
      });
    }
  }

  // 그 CR 의 planner 카드 — CR 이 끝났으니 카드도 끝난다
  const { rows: cards } = await tx.execute<PendingEscalation & { finding_id: string }>(sql`
    SELECT a.id AS approval_id, r.id AS resolution_id, r.escalate_reason::text AS escalate_reason,
           r.change_request_id, r.blocking, a.requested_by_session_id,
           a.assignee_role::text AS assignee_role, r.finding_id
      FROM approval a JOIN resolution r ON r.id = a.subject_id
     WHERE a.subject_type = 'escalation' AND a.decision IS NULL
       AND r.change_request_id = ${input.changeRequest.id}
  `);
  for (const card of cards) {
    await settleEscalationsInTx(tx, emit, {
      projectId: input.projectId,
      approvals: [card],
      decision: input.outcome === 'approved' ? 'approve' : 'reject',
      resolution:
        input.outcome === 'approved'
          ? 'spec_change'
          : input.outcome === 'rejected'
            ? 'dismissed'
            : 'withdrawn',
      comment: outcomeComment(input),
      userId: input.userId,
      sessionId: input.sessionId,
      isAgent: input.isAgent,
      findingId: card.finding_id,
      changeRequestKey: input.changeRequest.key,
    });
  }
  return { resolved, revert_tasks: revertTasks };
}

/** CR 의 결말을 한 줄로 — 처분 근거 · 닫힌 카드의 결정 메모가 같은 문장을 쓴다 */
function outcomeComment(input: {
  changeRequest: { key: string };
  outcome: 'approved' | 'rejected' | 'withdrawn';
  approvedVersionNo?: number | null;
  reason?: string | null;
}): string {
  const reason = (input.reason ?? '').trim();
  if (input.outcome === 'approved') {
    return text('agent.cr.finding.approved', {
      cr: input.changeRequest.key,
      version: input.approvedVersionNo ?? '?',
    });
  }
  if (input.outcome === 'rejected') {
    return text('agent.cr.finding.rejected', {
      cr: input.changeRequest.key,
      reason: reason === '' ? '—' : reason,
    });
  }
  return text('agent.cr.finding.withdrawn', { cr: input.changeRequest.key });
}

/**
 * **코드 되돌림 작업**(spec-workflow §3.4 — "reject → Finding은 dismissed, 코드 되돌림 Task 생성"). 제목 · 본문에 발견 · 커밋 · CR
 * 키를 적고 `backlog` 로 만든다. 담당과 기준(기준 버전 · 요구사항)은 그 발견이 나온 작업에서 옮기고, 작업이 없으면 발견이 가리키는
 * 스펙에서 옮긴다. 발견에 올린 작업이 아직 없으면 이 작업이 그 자리다(리뷰 센터의 "올린 작업" 링크).
 */
async function createRevertTaskInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    finding: {
      id: string;
      title: string;
      severity: string;
      file_path: string | null;
      line_start: number | null;
      spec_version_id: string | null;
      requirement_id: string | null;
      promoted_task_id: string | null;
      head_sha: string | null;
      task_assignee: string | null;
      task_spec_version_id: string | null;
      task_requirement_id: string | null;
      task_key: string | null;
    };
    crKey: string;
    reason: string;
    userId: string;
    sessionId: string | null;
    isAgent: boolean;
  },
): Promise<string> {
  const { rows: projects } = await tx.execute<{ key: string }>(
    sql`SELECT key FROM project WHERE id = ${input.projectId}`,
  );
  const id = newId();
  const key = displayKey(projects[0]?.key ?? '', 'T', id);
  const f = input.finding;
  const line = text('agent.cr.task.revert_title', { title: f.title.replace(/\s+/g, ' ').trim() });
  const title = line.length <= REVERT_TITLE_MAX ? line : `${line.slice(0, REVERT_TITLE_MAX - 1)}…`;
  const location =
    f.file_path === null ? '—' : `${f.file_path}${f.line_start === null ? '' : `:${f.line_start}`}`;
  const body = text('agent.cr.task.revert_body', {
    cr: input.crKey,
    finding: f.id,
    title: f.title,
    commit: f.head_sha ?? '—',
    location,
    reason: input.reason,
    task: f.task_key ?? '—',
  });
  const goal = text('agent.cr.task.revert_goal', {
    location,
    commit: (f.head_sha ?? '—').slice(0, 12),
  });
  await tx.execute(sql`
    INSERT INTO task (id, project_id, key, title, body_md, status, priority, assignee_user_id,
                      source_spec_version_id, source_requirement_id, goal_md)
    VALUES (${id}, ${input.projectId}, ${key}, ${title}, ${body}, 'backlog',
            ${f.severity === 'critical' ? 'P0' : f.severity === 'warning' ? 'P1' : 'P2'}::task_priority,
            ${f.task_assignee}, ${f.task_spec_version_id ?? f.spec_version_id},
            ${f.task_requirement_id ?? f.requirement_id}, ${goal})
  `);
  if (f.promoted_task_id === null) {
    await tx.execute(sql`UPDATE finding SET promoted_task_id = ${id} WHERE id = ${f.id}`);
  }
  await emit({
    type: NERV_EVENT.TASK_CREATED,
    projectId: input.projectId,
    subjectType: 'task',
    subjectId: id,
    subjectKey: key,
    actorUserId: input.userId,
    actorSessionId: input.sessionId,
    isAgent: input.isAgent,
    toState: 'backlog',
    payload: { change_request_key: input.crKey, kind: 'revert', finding_id: f.id },
  });
  return key;
}
