// event → notification 라우팅 — 정본: docs/03-proposal/spec-workflow.md §6.2~6.3
//
// **에이전트 진행 이벤트는 알림을 만들지 않는다**(§6.3 말미). 도구 호출·파일 수정은 세션
// 모니터(S5)와 활동 피드에서 WebSocket 으로 흐를 뿐이다. 이걸 알림으로 만들면 세션 수십 개
// (NFR-04) 환경에서 승인함이 즉시 파괴된다.
//
// 그리고 **결정이 필요한 것만 승인함으로** 간다(§6.6 원칙 3). 나머지는 피드다.
// 이 파일이 하는 일은 그 선별이다.

import { Injectable, Logger } from '@nestjs/common';
import { NERV_EVENT, newId } from '@nerv/schema';
import type { NervEventName } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

/** 중요도 티어 — 채널·배칭 규칙을 이것이 결정한다(§6.2) */
export type ImportanceTier = 'critical' | 'high' | 'standard' | 'low';

/**
 * 알림 카탈로그 — spec-workflow §6.3 표 그대로.
 * 여기 **없는 이벤트는 알림을 만들지 않는다.** 기본값이 "안 만든다"인 것이 설계다.
 */
export const NOTIFICATION_CATALOG: Partial<Record<NervEventName, ImportanceTier>> = {
  [NERV_EVENT.APPROVAL_REQUESTED]: 'critical',
  [NERV_EVENT.QUESTION_CREATED]: 'critical',
  [NERV_EVENT.CLAIM_CONFLICT_BLOCKED]: 'critical',
  [NERV_EVENT.SPEC_REJECTED]: 'high',
  [NERV_EVENT.SPEC_APPROVED]: 'high',
  [NERV_EVENT.CLAIM_CONFLICT_WARN]: 'high',
  [NERV_EVENT.SESSION_STALE]: 'high',
  [NERV_EVENT.TASK_BLOCKED]: 'high',
  [NERV_EVENT.TASK_REBRIEF_REQUIRED]: 'high',
  [NERV_EVENT.GATE_BYPASSED]: 'high',
  [NERV_EVENT.SPEC_COMMENT_ADDED]: 'standard',
  [NERV_EVENT.SPEC_RECHECK_REQUESTED]: 'standard',
  [NERV_EVENT.TASK_READY]: 'standard',
  [NERV_EVENT.SESSION_STARTED]: 'low',
  [NERV_EVENT.SESSION_COMPLETE]: 'low',
  [NERV_EVENT.TASK_CLAIMED]: 'low',
  [NERV_EVENT.TASK_DONE]: 'low',
};

export function tierOf(type: string): ImportanceTier | null {
  return NOTIFICATION_CATALOG[type as NervEventName] ?? null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(@InjectDb() private readonly db: NervDb) {}

  /**
   * 아직 알림으로 파생되지 않은 event 를 처리한다 — 워커의 notification 잡이 부른다.
   *
   * **low 티어는 즉시 알림을 만들지 않는다**(§6.2 — 일일 다이제스트). 배지가 배경 활동으로
   * 덮이면 "내 결정을 기다리는 것"이 묻히고, 그 순간 승인함은 두 번째 받은편지함이 된다.
   */
  async route(input: { since?: Date | null; limit?: number } = {}): Promise<number> {
    const limit = input.limit ?? 200;
    const { rows: events } = await this.db.execute<{
      id: string;
      project_id: string;
      type: string;
      actor_user_id: string | null;
      subject_id: string;
      occurred_at: string;
    }>(sql`
      SELECT e.id, e.project_id, e.type, e.actor_user_id, e.subject_id, e.occurred_at::text AS occurred_at
        FROM event e
       WHERE NOT EXISTS (SELECT 1 FROM notification n WHERE n.event_id = e.id)
         ${input.since == null ? sql`` : sql`AND e.occurred_at > ${input.since.toISOString()}`}
       ORDER BY e.occurred_at
       LIMIT ${limit}
    `);

    let created = 0;
    for (const event of events) {
      const tier = tierOf(event.type);
      if (tier === null || tier === 'low') continue; // 카탈로그 밖 · 배경 활동은 알림이 아니다

      const recipients = await this.recipientsFor(event);
      for (const userId of recipients) {
        await this.db.execute(sql`
          INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state)
          VALUES (${newId()}, ${event.project_id}, ${userId}, ${event.id},
                  ${tier === 'critical' || tier === 'high' ? 'immediate' : 'digest'}::notification_importance,
                  'inapp', 'unread')
        `);
        created += 1;
      }
    }
    if (created > 0) this.logger.log(`알림 ${created}건 파생`);
    return created;
  }

  /**
   * 수신자 산출 — MVP 는 ①역할 기반과 ③관여만 쓴다.
   * ②워치·④지정은 Phase 2 다(워치 테이블이 없다 — screens.md §2.4 말미).
   * **행위자 자신에게는 보내지 않는다** — 자기가 한 일의 알림은 소음이다.
   */
  private async recipientsFor(event: {
    project_id: string;
    actor_user_id: string | null;
  }): Promise<string[]> {
    const { rows } = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT user_id FROM membership
       WHERE (project_id = ${event.project_id} OR project_id IS NULL)
         AND role IN ('admin', 'planner')
         ${event.actor_user_id === null ? sql`` : sql`AND user_id <> ${event.actor_user_id}`}
    `);
    return rows.map((r) => r.user_id);
  }

  /** 읽지 않은 알림 수 — 헤더 배지가 쓰는 값(FR-12) */
  async unreadCount(userId: string): Promise<number> {
    const { rows } = await this.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM notification WHERE user_id = ${userId} AND state = 'unread'`,
    );
    return rows[0]?.n ?? 0;
  }
}
