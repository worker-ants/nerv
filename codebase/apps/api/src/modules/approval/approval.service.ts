// 승인함 — 결정 · 지시자≠승인자 · stale 승인 차단
// 정본: docs/03-proposal/spec-workflow.md §2.5·§6.4 · docs/04-mvp/api.md §2.6
//
// **승인·질문·리뷰 요청은 알림이 아니라 작업 항목이다**(§6.4). 흩어진 핑 대신 미결 액션을
// 한 곳에서 추적하는 것이 승인함의 존재 이유이고, Phase 1 종료 게이트가 그것을 수치로 잰다 —
// 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건**.
//
// 카드는 세 유형이다: 승인 · 질문 · 통지. 그리고 **에이전트의 요약문이 아니라 실제 diff·대상
// 리소스를 먼저 보여준다** — 매끄러운 설명으로 사람을 속여 유해한 승인을 받아내는 것이
// OWASP ASI09 가 명명한 공격 표면이고, 원문 우선 표시가 그에 대한 구조적 방어다.

import { Injectable, Logger } from '@nestjs/common';
import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
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
   * EP-APR-01 승인함 — **내 결정을 기다리는 것만** 센다(§6.6 원칙 3).
   * 나머지는 피드다. 이 구분이 없으면 배지 숫자가 의미를 잃고 승인함이 두 번째 받은편지함이 된다.
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
        throw new NervError(NERV_ERROR.PRECONDITION, '승인 항목을 찾을 수 없습니다.', {
          kind: 'not_found',
        });
      }
      if (approval.decision !== null) {
        throw new NervError(NERV_ERROR.PRECONDITION, '이미 결정된 항목입니다.', {
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
        throw new NervError(NERV_ERROR.PRECONDITION, '카드를 연 뒤 내용이 바뀌었습니다.', {
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
      throw new NervError(NERV_ERROR.PRECONDITION, '면제에는 사유가 필요합니다.', {
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
    throw new NervError(NERV_ERROR.FORBIDDEN, '요청자는 자기 요청을 승인할 수 없습니다.', {
      kind: 'self_approval',
    });
  }
}
