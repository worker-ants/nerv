// event → notification 라우팅 — 정본: docs/03-proposal/spec-workflow.md §6.2~6.3
//
// **에이전트 진행 이벤트는 알림을 만들지 않는다**(§6.3 말미). 도구 호출·파일 수정은 세션
// 모니터(S5)와 활동 피드에서 WebSocket 으로 흐를 뿐이다. 이걸 알림으로 만들면 세션 수십 개
// (NFR-04) 환경에서 받은 요청이 즉시 파괴된다.
//
// 그리고 **결정이 필요한 것만 받은 요청으로** 간다(§6.6 원칙 3). 나머지는 피드다.
// 이 파일이 하는 일은 그 선별이다.

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  EVENTS_CHANNEL,
  NERV_EVENT,
  NERV_EVENT_PHASE2,
  newId,
  notificationState,
} from '@nerv/schema';
import type { NervEventName } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { DECIDER_ROLES } from '../approval/approval-policy.js';
import { notificationImportance } from '@nerv/schema';
import { InjectDb } from '../../common/database.module.js';
import { cursorId, cursorTimestamp, decodeCursor, encodeCursor } from '../../common/cursor.js';
import { assertVocab } from '../../common/query-vocab.js';
import type { NervDb } from '../../common/database.module.js';
import { ValkeyService } from './valkey.service.js';

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
  // 발견 코멘트는 스펙 코멘트와 같은 무게다 — 사람이 남긴 말이고, 답을 기다린다
  [NERV_EVENT_PHASE2.FINDING_COMMENTED]: 'standard',
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

/** 한 실행이 넘기는 페이지 상한 — 밀린 이력이 길어도 한 틱이 무한히 돌지 않게 한다 */
const MAX_PAGES = 20;

@Injectable()
export class NotificationService {
  /**
   * 지난 실행이 어디까지 봤는가(메모리). 워커는 advisory lock 을 쥔 한 프로세스라
   * 이 값이 곧 그 워커의 물마루다 — 재기동하면 비고, 그때는 밀린 것부터 다시 훑는다.
   */
  private cursor: string | null = null;

  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectDb() private readonly db: NervDb,
    /**
     * 방송은 **선택**이다. 알림 행은 이미 DB 에 있고 화면은 재조회로 그것을 본다 —
     * 방송 유실이 알림 유실은 아니다(D-14). 테스트가 Valkey 없이 이 서비스를 세울 수
     * 있는 이유이기도 하다.
     */
    @Optional() private readonly valkey: ValkeyService | null = null,
  ) {}

  /**
   * 아직 알림으로 파생되지 않은 event 를 처리한다 — 워커의 notification 잡이 부른다.
   *
   * **low 티어는 즉시 알림을 만들지 않는다**(§6.2 — 일일 다이제스트). 배지가 배경 활동으로
   * 덮이면 "내 결정을 기다리는 것"이 묻히고, 그 순간 받은 요청은 두 번째 받은편지함이 된다.
   */
  async route(input: { since?: Date | null; limit?: number } = {}): Promise<number> {
    const limit = input.limit ?? 200;
    // 명시 `since` 는 호출자의 것이고, 없으면 지난 실행이 남긴 물마루에서 잇는다
    let cursor: string | null = input.since?.toISOString() ?? this.cursor;
    let created = 0;

    // **창이 막히지 않게 앞으로 민다.** 예전에는 "알림 행이 없는 이벤트" 를 시각순 200건만
    // 읽고 끝냈다. 그런데 카탈로그 밖 이벤트(초안 자동 저장 등)·low 티어·수신자 0명은
    // `continue` 로 건너뛰며 **아무 표식도 남기지 않는다** — 그런 이벤트가 200건을 넘는
    // 순간 창이 그것들로 영구히 채워지고, 그 뒤의 `approval.requested` 는 다시는 읽히지
    // 않는다. 받은 요청 배지가 0 으로 굳고 사람은 결정 대기가 없다고 믿는다.
    //
    // 그래서 페이지를 넘긴다: 처리한 마지막 시각을 커서로 삼아 건너뛴 것들을 지나간다.
    // 두 조건을 함께 쓰는 것이 요점이다 — 시각 커서는 **전진**을, `NOT EXISTS` 는
    // **중복 방지**를 맡는다(재기동하면 커서가 비고, 그때는 밀린 것부터 다시 훑는다).
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const at: string | null = cursor;
      const { rows: events } = await this.db.execute<{
        id: string;
        project_id: string;
        type: string;
        actor_user_id: string | null;
        subject_id: string;
        payload: Record<string, unknown> | null;
        occurred_at: string;
      }>(sql`
        SELECT e.id, e.project_id, e.type, e.actor_user_id, e.subject_id, e.payload,
               e.occurred_at::text AS occurred_at
          FROM event e
         WHERE NOT EXISTS (SELECT 1 FROM notification n WHERE n.event_id = e.id)
           ${at == null ? sql`` : sql`AND e.occurred_at > ${at}`}
         ORDER BY e.occurred_at
         LIMIT ${limit}
      `);
      if (events.length === 0) break;

      for (const event of events) {
        const tier = tierOf(event.type);
        // 카탈로그 밖 · 배경 활동은 알림이 아니다 — 건너뛰되 **커서는 지나간다**
        if (tier !== null && tier !== 'low') {
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
          // **개인 룸으로 나가는 유일한 방송**(api.md §3.3). 이것이 없던 동안 `user:{id}` 룸과
          // `GET /sse/me` 는 열려 있기만 하고 아무것도 흘리지 않았다 — 종은 새로고침해야
          // 숫자가 바뀌었고, 다른 프로젝트 화면에 있던 사람은 자기 앞으로 온 승인 요청을
          // 실시간으로 받지 못했다(프로젝트 룸은 그가 join 한 프로젝트만 흘린다).
          //
          // 방송하는 것은 **원본 이벤트가 아니라 `notification.created`** 다. 원본을 개인
          // 룸에도 흘리면 프로젝트 룸에 이미 있는 사람이 같은 봉투를 두 번 받는다.
          if (recipients.length > 0) await this.announce(event, recipients);
        }
        cursor = event.occurred_at;
      }
      if (events.length < limit) break;
    }

    // 명시 `since` 로 부른 호출은 물마루를 옮기지 않는다 — 그것은 호출자의 질의다
    if (input.since == null) this.cursor = cursor;
    if (created > 0) this.logger.log(`알림 ${created}건 파생`);
    return created;
  }

  /**
   * 수신자들의 개인 룸으로 `notification.created` 를 흘린다.
   *
   * 봉투의 `subject_*` 는 **원인이 된 이벤트**를 가리킨다 — 받은 쪽이 "무엇 때문에 온
   * 알림인가" 를 알아야 어느 화면을 다시 읽을지 정할 수 있다.
   *
   * 실패는 삼킨다. 알림 행은 이미 DB 에 있고 화면은 재조회로 그것을 본다(D-14).
   */
  private async announce(
    event: { id: string; project_id: string; type: string; occurred_at: string },
    recipients: string[],
  ): Promise<void> {
    if (this.valkey === null) return;
    const envelope = {
      id: newId(),
      type: NERV_EVENT.NOTIFICATION_CREATED,
      project_id: event.project_id,
      subject_type: 'event',
      subject_id: event.id,
      subject_key: event.type,
      // 알림을 만든 것은 사람이 아니라 서버다 — 행위자가 없다
      actor_user_id: null,
      is_agent: false,
      // 봉투의 시각은 ISO 8601 이다(§3.3) — `timestamptz::text` 는 Postgres 표기라
      // 그대로 실으면 받는 쪽의 Date 파싱이 브라우저마다 갈린다
      occurred_at: new Date(event.occurred_at).toISOString(),
      recipient_user_ids: recipients,
    };
    await this.valkey.publish(EVENTS_CHANNEL, JSON.stringify(envelope));
  }

  /**
   * 수신자 산출. **행위자 자신에게는 보내지 않는다** — 자기가 한 일의 알림은 소음이다.
   *
   * 승인 요청은 **지정을 본다**(2026-09-02 사람 결정). 결재 경로(EP-APR)는 처음부터
   * `assignee_user_id`·`assignee_role` 을 보는데 알림만 보지 않아서 둘이 어긋나 있었다:
   * 지정 승인자가 designer·qa 면 자기 앞으로 온 카드의 알림을 **못 받았고**, admin·planner
   * 전원은 자기가 결정할 수 없는 카드의 알림을 받았다. 결정할 수 없는 카드의 알림은
   * 알림 자체를 못 믿게 만들고, 그러면 받은 요청이 파괴된다(§6.6 원칙 3).
   *
   * 나머지 이벤트는 역할 큐다. ②워치·④지정 확장은 Phase 2 다(워치 테이블이 없다 —
   * screens.md §2.4 말미).
   */
  private async recipientsFor(event: {
    project_id: string;
    actor_user_id: string | null;
    type: string;
    subject_id: string;
    payload?: Record<string, unknown> | null;
  }): Promise<string[]> {
    if (event.type === NERV_EVENT.APPROVAL_REQUESTED) {
      const targeted = await this.approvalTargets(event);
      // 지정이 없는 승인 요청만 역할 큐로 내려간다
      if (targeted !== null) return targeted;
    }
    if (
      event.type === NERV_EVENT.CLAIM_CONFLICT_BLOCKED ||
      event.type === NERV_EVENT.CLAIM_CONFLICT_WARN
    ) {
      return this.conflictTargets(event);
    }
    if (event.type === NERV_EVENT.SPEC_RECHECK_REQUESTED) {
      const owners = await this.specOwnerTargets(event);
      if (owners !== null) return owners;
    }
    return this.roleQueue(event);
  }

  /**
   * **재확인 요청은 그 문서의 주인에게 간다**(2026-09-07 · REQ-API-150 · api.md §3.3 룸 표가
   * "대상 문서 owner" 라 적은 자리다).
   *
   * 역할 큐로 흩뿌리던 동안 recheck 1,336건이 admin·planner 의 목록을 채웠고, 결정이 필요한
   * 19건이 그 안에 묻혔다. 문서에 주인 역할이 없으면(`owner_role IS NULL`) 기본 큐로 간다 —
   * 아무에게도 가지 않는 것보다 낫다.
   */
  private async specOwnerTargets(event: {
    project_id: string;
    actor_user_id: string | null;
    subject_id: string;
  }): Promise<string[] | null> {
    const { rows } = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT m.user_id
        FROM spec s
        JOIN project p ON p.id = s.project_id
        JOIN membership m ON m.org_id = p.org_id
         AND (m.project_id = p.id OR m.project_id IS NULL)
         AND m.role = s.owner_role
       WHERE s.id = ${event.subject_id} AND s.owner_role IS NOT NULL
         ${event.actor_user_id === null ? sql`` : sql`AND m.user_id <> ${event.actor_user_id}`}
    `);
    return rows.length === 0 ? null : rows.map((r) => r.user_id);
  }

  /**
   * 겹침을 알려야 할 사람은 **먼저 잡고 있던 쪽**이다(2026-09-07 · REQ-API-128).
   *
   * 막힌 쪽은 409 로 이미 안다 — 그쪽에 알림을 또 보내는 것은 소음이다. 모르는 것은
   * 자기 범위에 남이 부딪혔다는 사실이고, 그것을 모르면 조정이 일어나지 않는다.
   * 역할 큐로 흩뿌리지 않는 이유도 같다: admin·planner 는 이 겹침의 당사자가 아니다.
   */
  private conflictTargets(event: {
    actor_user_id: string | null;
    payload?: Record<string, unknown> | null;
  }): string[] {
    const payload = event.payload ?? {};
    const raw = Array.isArray(payload['overlaps'])
      ? (payload['overlaps'] as unknown[])
      : payload['overlap'] === undefined
        ? []
        : [payload['overlap']];
    const holders = raw
      .map((o) => (o as { user_id?: unknown }).user_id)
      .filter((id): id is string => typeof id === 'string' && id !== event.actor_user_id);
    return [...new Set(holders)];
  }

  /**
   * 지정 승인자 또는 지정 역할 큐. 둘 다 없으면 `null` 을 돌려 역할 큐로 넘긴다.
   *
   * 지정된 사람이 행위자 자신이면 빈 배열이다 — 자기가 올리고 자기가 받는 알림은 소음이고,
   * 그 카드는 어차피 받은 요청 목록에 있다.
   */
  private async approvalTargets(event: {
    project_id: string;
    actor_user_id: string | null;
    subject_id: string;
  }): Promise<string[] | null> {
    const { rows } = await this.db.execute<{
      assignee_user_id: string | null;
      assignee_role: string | null;
    }>(sql`
      SELECT assignee_user_id, assignee_role::text AS assignee_role
        FROM approval WHERE id = ${event.subject_id} AND project_id = ${event.project_id}
    `);
    const approval = rows[0];
    if (approval === undefined) return null;

    if (approval.assignee_user_id !== null) {
      return approval.assignee_user_id === event.actor_user_id ? [] : [approval.assignee_user_id];
    }
    if (approval.assignee_role !== null) {
      // **조직 경계**(2026-09-07 · REQ-API-125). `project_id IS NULL` 은 "조직 단위 멤버십" 인데
      // 어느 조직인지를 보지 않으면 **다른 조직의** 같은 역할 보유자에게 이 프로젝트의 스펙
      // 키·제목이 알림으로 간다. `assertMembership`(2026-08-24)·자기 승인 admin 판정(09-02)이
      // 같은 자리에서 같은 실수를 했다 — 판정마다 따로 고쳐 온 것이 이 결함의 모양이다.
      const { rows: members } = await this.db.execute<{ user_id: string }>(sql`
        SELECT DISTINCT m.user_id FROM membership m
          JOIN project p ON p.id = ${event.project_id}
         WHERE m.org_id = p.org_id
           AND (m.project_id = p.id OR m.project_id IS NULL)
           AND m.role = ${approval.assignee_role}::member_role
           ${event.actor_user_id === null ? sql`` : sql`AND m.user_id <> ${event.actor_user_id}`}
      `);
      return members.map((r) => r.user_id);
    }
    return null;
  }

  /**
   * 지정이 없을 때의 기본 수신자 — **그 조직의** `approval:decide` 보유 역할(REQ-API-125·136).
   *
   * 목록을 여기 적지 않는다(2026-09-07). `('admin','planner')` 를 하드코딩하고 있었는데
   * 바로 옆 `approval.service` 의 주석은 "역할 큐 목록을 여기 다시 적지 않는다" 고 적어
   * 두고 있었다 — 두 벌이면 역할이 늘 때 한쪽만 고쳐지고, 그때 새 역할은 알림을 못 받는다.
   *
   * 조직 단위 멤버십(`project_id IS NULL`)은 조직을 함께 봐야 한다 — 보지 않으면 A 조직의
   * planner 가 B 조직 프로젝트의 알림을 받는다(FR-14 의 경계가 여기서 샜다).
   */
  private async roleQueue(event: {
    project_id: string;
    actor_user_id: string | null;
  }): Promise<string[]> {
    const { rows } = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT m.user_id FROM membership m
        JOIN project p ON p.id = ${event.project_id}
       WHERE m.org_id = p.org_id
         AND (m.project_id = p.id OR m.project_id IS NULL)
         AND m.role::text IN (${sql.join(
           DECIDER_ROLES.map((r) => sql`${r}`),
           sql`, `,
         )})
         ${event.actor_user_id === null ? sql`` : sql`AND m.user_id <> ${event.actor_user_id}`}
    `);
    return rows.map((r) => r.user_id);
  }

  /** 읽지 않은 알림 수 — 헤더 배지가 쓰는 값(FR-12) */
  /**
   * EP-NTF-01 — 인앱 피드.
   *
   * `notification` 행에는 제목도 본문도 없다 — 참조(event_id)만 있다. 알림 문구를 행에 굳혀
   * 저장하면 같은 사실이 두 곳에 남고 이벤트가 정정돼도 알림은 옛 문구를 계속 말한다.
   * 그래서 표시 내용은 **조회 시점에 event 에서 만든다**(D-10 — 진실은 event 한 곳).
   */
  /**
   * EP-NTF-01 — 알림 목록.
   *
   * **커서가 없으면 목록은 벽이다**(2026-09-03 신설 · REQ-API-083). 상한은 처음부터 있었는데
   * 컨트롤러도 웹도 `limit` 을 넘기지 않아 언제나 최신 50건이었고, 그 뒤로 가는 길이 없었다 —
   * 실측(2026-09-03): 한 사람의 안 읽은 알림이 479건인데 **429건은 웹에서 도달 불가**였다.
   * 헤더 배지는 진짜 수를 보이고 목록은 50 에서 끝나므로, 화면이 자기 배지와 어긋난다.
   */
  async list(input: {
    userId: string;
    /** 어휘 판정은 아래 `assertVocab` 이 한다 — 표면이 접으면 여기까지 오지 않는다(REQ-API-126) */
    state?: string | null;
    limit?: number;
    /** 이 시각보다 **앞선** 것 — 목록의 마지막 항목이 다음 쪽의 시작이다 */
    before?: string | null;
    /**
     * **등급으로 나눠 본다**(2026-09-07 · REQ-API-149). 서버는 티어로 immediate/digest 를
     * 갈라 저장하는데 표면이 그 축을 받지 않아, 결정이 필요한 19건이 배경 활동 1,336건에
     * 묻혔다(FR-12 가 배지에 요구하는 것이 정확히 그 구별이다).
     */
    importance?: string | null;
  }): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
    const stateFilter =
      input.state == null
        ? sql``
        : // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
          sql` AND n.state = ${assertVocab([input.state], notificationState.enumValues, 'state')[0]}::notification_state`;
    const importanceFilter =
      input.importance == null
        ? sql``
        : sql` AND n.importance = ${assertVocab([input.importance], notificationImportance.enumValues, 'importance')[0]}::notification_importance`;
    // **커서는 (created_at, id) 다**(§1.6 · REQ-API-124). 예전 주석은 "같은 시각의 행을
    // 건너뛸 수 있지만 감수한다" 였는데, REQ-API-083 이 이 목록에도 "겹치지도 빠뜨리지도
    // 않는 다음 쪽" 을 이미 약속하고 있었다 — 감수는 요구사항과 어긋난 채였다.
    // 한 이벤트가 여러 수신자에게 파생되면 같은 `created_at` 이 여럿이다.
    const cursor = decodeCursor(input.before ?? undefined);
    const cursorAt = cursorTimestamp(cursor?.[0]);
    const cursorRowId = cursorId(cursor?.[1]);
    const legacyAt = cursor === null ? cursorTimestamp(input.before) : null;
    const beforeFilter =
      cursorAt !== null && cursorRowId !== null
        ? sql` AND (n.created_at, n.id) < (${cursorAt}::timestamptz, ${cursorRowId}::uuid)`
        : legacyAt !== null
          ? sql` AND n.created_at < ${legacyAt}::timestamptz`
          : sql``;
    const limit = Math.min(input.limit ?? 50, 200);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT n.id, n.state::text AS state, n.importance::text AS importance,
             n.channel::text AS channel, n.created_at, n.read_at, n.event_id,
             e.type AS event_type, e.subject_type::text AS subject_type, e.subject_id,
             e.to_state, e.is_agent, e.occurred_at,
             u.display_name AS actor_name,
             p.slug AS project_slug, p.name AS project_name,
             s.key AS spec_key, s.title AS spec_title, t.key AS task_key, t.title AS task_title
        FROM notification n
        JOIN project p ON p.id = n.project_id
   LEFT JOIN event e ON e.id = n.event_id
   LEFT JOIN "user" u ON u.id = e.actor_user_id
   LEFT JOIN spec_version sv ON sv.id = e.subject_id AND e.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = coalesce(sv.spec_id, CASE WHEN e.subject_type = 'spec' THEN e.subject_id END)
   LEFT JOIN task t ON t.id = e.subject_id AND e.subject_type = 'task'
       WHERE n.user_id = ${input.userId}${stateFilter}${importanceFilter}${beforeFilter}
         -- 보관한 프로젝트의 알림은 숨긴다 — 딥링크가 닿는 곳이 목록에서 치운 자리다
         AND p.archived_at IS NULL
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ${limit + 1}
    `);
    // 한 건 더 받아 **다음 쪽이 있는지**를 안다 — 총계를 세면 매 요청이 전량 스캔이다
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items,
      next_cursor:
        rows.length > limit && last !== undefined
          ? encodeCursor([String(last['created_at']), String(last['id'])])
          : null,
    };
  }

  /** EP-NTF-02 — 읽음 처리. 남의 알림을 읽음 처리할 수 없게 user_id 를 조건에 둔다. */
  async markRead(input: { userId: string; notificationId: string }): Promise<{ ok: true }> {
    await this.db.execute(sql`
      UPDATE notification SET state = 'read', read_at = now()
       WHERE id = ${input.notificationId} AND user_id = ${input.userId} AND state = 'unread'
    `);
    return { ok: true };
  }

  /**
   * EP-NTF-03 — **일괄 읽음**(REQ-WEB-137).
   *
   * 실측 2026-09-04: 안 읽은 알림이 695건이었다. 한 건씩 지우는 것이 유일한 길이면 그
   * 배지는 **지울 수 없는 숫자**가 되고, 지울 수 없는 배지는 곧 읽지 않는 배지가 된다.
   *
   * 몇 건을 읽었는지 돌려준다 — 화면이 "몇 개를 치웠다" 를 말할 수 있어야 사람이 방금
   * 무슨 일이 일어났는지 안다. 조용히 0 이 되는 목록은 사고처럼 보인다.
   */
  async markAllRead(input: { userId: string }): Promise<{ ok: true; marked: number }> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      UPDATE notification SET state = 'read', read_at = now()
       WHERE user_id = ${input.userId} AND state = 'unread'
      RETURNING id
    `);
    return { ok: true, marked: rows.length };
  }

  /**
   * 헤더 배지의 수.
   *
   * **목록과 같은 조건으로 센다**(REQ-WEB-035 — 배지 수 = 안읽음 목록 수). 보관한
   * 프로젝트를 목록에서만 빼고 여기서 빼지 않으면 "안 읽음 3"인데 목록은 비어 있는
   * 상태가 되고, 그때 배지는 지울 수 없는 숫자가 된다.
   */
  /**
   * 읽지 않은 수 — **둘로 준다**(2026-09-07 · REQ-API-149).
   *
   * 배지가 전체 unread 를 세면 실측 767건 중 결정이 필요한 99건이 그 안에 묻힌다(FR-12).
   * 서버는 티어로 이미 갈라 저장하고 있었다 — 표면이 그 축을 돌려주지 않았을 뿐이다.
   * 전체 수도 함께 준다: 목록은 둘 다 보이고, 배지는 앞엣것만 쓴다.
   */
  async unreadCount(userId: string): Promise<{ count: number; immediate: number }> {
    const { rows } = await this.db.execute<{ n: number; immediate: number }>(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE notif.importance = 'immediate')::int AS immediate
        FROM notification notif
        JOIN project p ON p.id = notif.project_id
       WHERE notif.user_id = ${userId} AND notif.state = 'unread' AND p.archived_at IS NULL
    `);
    return { count: rows[0]?.n ?? 0, immediate: rows[0]?.immediate ?? 0 };
  }
}
