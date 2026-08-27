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
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

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
  /** stale 판정용 — 결정 시점에 내용이 바뀌었는지 본다 */
  content_hash: string | null;
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

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
             t.key AS task_key,
             extract(epoch FROM (now() - q.asked_at))::int AS waiting_seconds
        FROM question q
        JOIN project p ON p.id = q.project_id
        JOIN agent_session se ON se.id = q.agent_session_id
        JOIN "user" u ON u.id = se.user_id
   LEFT JOIN task t ON t.id = q.task_id
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
             u.display_name AS asked_by, t.key AS task_key,
             extract(epoch FROM (now() - q.asked_at))::int AS waiting_seconds
        FROM question q
        JOIN agent_session se ON se.id = q.agent_session_id
        JOIN "user" u ON u.id = se.user_id
   LEFT JOIN task t ON t.id = q.task_id
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
      if (input.decision === 'approve' && approval.requested_by_user_id === input.userId) {
        await this.assertSmallTeamRelief(tx, input.projectId, input.userId);
      }

      await tx.execute(sql`
        UPDATE approval
           SET decision = ${input.decision}::approval_decision,
               comment_md = ${input.comment ?? null},
               decided_at = now(),
               assignee_user_id = COALESCE(assignee_user_id, ${input.userId})
         WHERE id = ${input.approvalId}
      `);

      await emit({
        type: NERV_EVENT.QUESTION_ANSWERED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: input.approvalId,
        actorUserId: input.userId,
        isAgent: false,
        payload: { decision: input.decision },
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

  private async assertSmallTeamRelief(
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
    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.self_approve'), {
      kind: 'self_approval',
    });
  }
}
