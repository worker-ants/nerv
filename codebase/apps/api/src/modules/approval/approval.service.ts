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
import { msg, newId, NERV_ERROR, NERV_EVENT } from '@nerv/schema';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import { SpecService } from '../spec/spec.service.js';

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
  /** stale 판정용 — 결정 시점에 내용이 바뀌었는지 본다 */
  content_hash: string | null;
}

/**
 * 이 사람이 이 결재를 **승인할 수 있는가** — 지시자≠승인자 규칙과 그 완화 둘을 한 식으로.
 *
 * **판정은 서버 한 곳이다**(D-05). 예전에는 화면이 `self_requested` 만 보고 단추를 껐는데,
 * 완화가 둘로 늘면(소규모·admin) 화면이 규칙을 다시 구현해야 한다 — 그러면 두 벌이 되고,
 * 두 벌이 되면 언젠가 한쪽만 고친다. 화면은 이 불리언을 그대로 읽는다.
 */
function canApproveSql(userId: string): SQL {
  return sql`(
    a.requested_by_user_id <> ${userId}
    OR EXISTS (SELECT 1 FROM membership m
                WHERE m.user_id = ${userId} AND m.role = 'admin'
                  AND (m.project_id = a.project_id
                       OR (m.project_id IS NULL AND m.org_id = (
                             SELECT org_id FROM project WHERE id = a.project_id))))
    OR (SELECT count(DISTINCT user_id) FROM membership
         WHERE project_id = a.project_id OR project_id IS NULL) < 2
  ) AS can_approve`;
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly events: EventService,
    private readonly specs: SpecService,
    @InjectDb() private readonly db: NervDb,
  ) {}

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
    if (input.decision === 'reject') {
      await this.specs.rejectInTxForApproval(tx, emit, {
        projectId: input.projectId,
        specVersionId: approval.subject_id,
        reviewerUserId: input.userId,
        comment: input.comment ?? '',
      });
    }
    // `comment` 는 대상을 움직이지 않는다 — 카드에 말만 남기는 결정이다
  }

  /**
   * EP-APR-01 받은 요청 — **내 결정을 기다리는 것만** 센다(§6.6 원칙 3).
   * 나머지는 피드다. 이 구분이 없으면 배지 숫자가 의미를 잃고 받은 요청이 두 번째 받은편지함이 된다.
   */
  async inbox(input: { projectId: string; userId: string }): Promise<InboxCard[]> {
    const { rows } = await this.db.execute<InboxCard>(sql`
      SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
             s.key AS subject_key,
             u.display_name AS requested_by,
             a.requested_at::text AS requested_at,
             sv.body_md,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             ${canApproveSql(input.userId)},
             encode(sv.content_hash, 'hex') AS content_hash
        FROM approval a
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
       WHERE a.project_id = ${input.projectId}
         AND a.decision IS NULL
         AND (a.assignee_user_id IS NULL OR a.assignee_user_id = ${input.userId})
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
    userId: string;
    state?: 'pending' | 'decided' | null;
    projectSlug?: string | null;
  }): Promise<Record<string, unknown>[]> {
    const decided = input.state === 'decided';
    const stateFilter = decided ? sql`a.decision IS NOT NULL` : sql`a.decision IS NULL`;
    const projectFilter =
      input.projectSlug == null ? sql`` : sql` AND p.slug = ${input.projectSlug}`;

    const { rows: approvals } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.requested_at, a.decided_at, a.is_bypass,
             p.slug AS project_slug, p.name AS project_name, p.id AS project_id,
             u.display_name AS requested_by,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             ${canApproveSql(input.userId)},
             s.key AS spec_key, s.title AS spec_title, sv.version_no,
             encode(sv.content_hash, 'hex') AS content_hash,
             extract(epoch FROM (now() - a.requested_at))::int AS waiting_seconds
        FROM approval a
        JOIN project p ON p.id = a.project_id
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
       WHERE ${stateFilter}${projectFilter}
         -- **보관한 프로젝트의 결재는 여기 오지 않는다**(2026-08-27 · 사람 보고).
         -- 목록에는 보이는데 누르면 아무 일도 일어나지 않았다 — 치운 프로젝트를
         -- 사람이 계속 결재하도록 두는 것은 받은 요청을 못 믿게 만드는 가장 빠른 길이다.
         AND p.archived_at IS NULL
         AND (a.assignee_user_id IS NULL OR a.assignee_user_id = ${input.userId})
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
  async detail(input: { approvalId: string; userId: string }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.project_id, a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.comment_md, a.requested_at, a.decided_at,
             a.is_bypass, a.bypass_reason,
             p.slug AS project_slug, u.display_name AS requested_by,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             ${canApproveSql(input.userId)},
             s.key AS spec_key, s.title AS spec_title, sv.version_no, sv.body_md,
             sv.change_summary_md, encode(sv.content_hash, 'hex') AS content_hash
        FROM approval a
        JOIN project p ON p.id = a.project_id
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
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

  /** EP-QST-01 — 열린 질문 목록(프로젝트 스코프). */
  async questions(input: {
    projectId: string;
    status?: 'open' | 'answered' | null;
  }): Promise<Record<string, unknown>[]> {
    const status = input.status ?? 'open';
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
    projectId: string;
    approvalId: string;
    userId: string;
    decision: ApprovalDecision;
    comment?: string;
    /** 카드를 연 시점의 내용 지문. 없으면 검사하지 않는다(코멘트 결정 등) */
    seenContentHash?: string | null;
  }): Promise<{ decision: ApprovalDecision; subject_type: string; subject_id: string }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        id: string;
        subject_type: string;
        subject_id: string;
        requested_by_user_id: string;
        decision: string | null;
        content_hash: string | null;
      }>(sql`
        SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
               a.requested_by_user_id, a.decision::text AS decision,
               encode(sv.content_hash, 'hex') AS content_hash
          FROM approval a
     LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
         WHERE a.id = ${input.approvalId} AND a.project_id = ${input.projectId}
         FOR UPDATE OF a
      `);
      const approval = rows[0];
      if (approval === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.not_found'), {
          kind: 'not_found',
        });
      }
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

      // 지시자≠승인자 — approve 에만 적용한다(코멘트·거절은 요청자도 할 수 있다)
      const selfApprove =
        input.decision === 'approve' && approval.requested_by_user_id === input.userId;
      if (selfApprove) {
        await this.assertSelfApprovalAllowed(tx, input.projectId, input.userId);
      }

      await tx.execute(sql`
        UPDATE approval
           SET decision = ${input.decision}::approval_decision,
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

      await emit({
        type: NERV_EVENT.QUESTION_ANSWERED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: input.approvalId,
        actorUserId: input.userId,
        isAgent: false,
        // **자기 승인은 그 사실을 남긴다.** 규칙의 예외를 허용하는 것과 그것을 감추는 것은
        // 다른 일이다 — 감사가 나중에 "이 결재는 한 사람이 양쪽에 섰다" 를 셀 수 있어야 한다.
        payload: { decision: input.decision, ...(selfApprove ? { self_approved: true } : {}) },
      });

      return {
        decision: input.decision,
        subject_type: approval.subject_type,
        subject_id: approval.subject_id,
      };
    });
  }

  /**
   * EP-APR-04 게이트 면제 — **면제도 결재 레코드다**(FR-10).
   * 사유가 없으면 CHECK 가 막는다(4.3 §2.8). 기록되지 않는 면제는 면제가 아니라 구멍이다.
   */
  async bypass(input: {
    projectId: string;
    subjectType: 'spec_version' | 'change_request' | 'plan' | 'question' | 'gate_bypass';
    subjectId: string;
    userId: string;
    reason: string;
  }): Promise<{ approval_id: string }> {
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
        isAgent: false,
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
    assigneeUserId?: string | null;
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
        INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id, assignee_user_id)
        VALUES (${approvalId}, ${input.projectId}, ${input.subjectType}::approval_subject_type,
                ${input.subjectId}, ${input.requestedByUserId}, ${input.assigneeUserId ?? null})
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
  ): Promise<void> {
    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT user_id)::int AS n FROM membership
       WHERE project_id = ${projectId} OR project_id IS NULL
    `);
    if ((rows[0]?.n ?? 1) < 2) {
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

    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.self_approve'), {
      kind: 'self_approval',
      // 막다른 길에 세우지 않는다 — 누가 할 수 있는지 말한다
      allowed_roles: ['admin'],
    });
  }
}
