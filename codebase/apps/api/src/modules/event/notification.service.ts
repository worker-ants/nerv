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
  msg,
  NERV_ERROR,
  NERV_EVENT,
  NERV_EVENT_PHASE2,
  newId,
  NOTIFICATION_LEVELS,
  NOTIFICATION_RESUME_WINDOW_SECONDS,
  notificationState,
} from '@nerv/schema';
import type { NervEventName } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DECIDER_ROLES } from '../approval/approval-policy.js';
import { notificationImportance } from '@nerv/schema';
import { InjectDb } from '../../common/database.module.js';
import { cursorId, cursorTimestamp, decodeCursor, encodeCursor } from '../../common/cursor.js';
import { assertVocab } from '../../common/query-vocab.js';
import type { NervDb } from '../../common/database.module.js';
import {
  memberOfProjectSql,
  resolveMemberProject,
  scopeFilterSql,
} from '../../common/member-scope.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { isUniqueViolation } from '../../common/db-error.js';
import { requestAlreadyClosed } from './request-notifications.js';
import { EVENT_SUBJECT_COLUMNS, EVENT_SUBJECT_JOINS } from './event-subject.js';
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
  // **fail-open 격상**(2026-10-15 · 사람 결정 · REQ-API-319) — 게이트가 사실상 꺼졌다. admin 에게 중요 알림이다. 누군가의
  // 세션이 그 결정을 기다리며 멈춰 있지는 않아 critical 이 아니라 high 다(면제 `gate.bypassed` 와 같은 무게 · 같은 사람).
  // 풀림(`gate.failopen_cleared`)은 카탈로그에 없다 — 기록과 배너가 사라지는 것으로 충분하다
  [NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED]: 'high',
  // **미러 push 멈춤**(2026-10-16 · E21-S02 · codebase.md REQ-CB-063) — 미러 원격에 NERV 가 만들지 않은 커밋이 있다. admin 이 원격을
  // 고쳐야 push 가 다시 돈다. 그동안 미러는 낡지만 누군가의 세션이 멈추지는 않아 격상과 같은 high 다
  [NERV_EVENT_PHASE2.MIRROR_DIVERGED]: 'high',
  // **오프라인 큐 재전송 거절**(2026-10-16 · E21-S01 · NFR-05 · REQ-API-322) — 그 사람의 상태 보고 · 질문 · 증적이 서버에
  // 들어가지 않았다. 내 작업에 직접 영향이 있고 오늘 봐야 하는 일이라 중요다. 누군가의 결정을 기다리며 멈춘 세션은 없어
  // critical 은 아니다. 보고는 flush 한 번에 한 이벤트라 묶지 않는다(중요 등급은 묶지 않는다)
  [NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED]: 'high',
  // **지연 결재**(2026-10-15 · 사람 결정 · REQ-API-305) — 결정할 수 있는데 요청 알림을 받지 못한 사람(직군 자리 결재의
  // admin)에게 가는 첫 알림이다. 그 사람에게는 오늘 볼 일이라 중요다. 기본 큐 결재는 받는 사람이 없다(아래 라우팅)
  [NERV_EVENT.APPROVAL_OVERDUE]: 'high',
  // **critical 발견이 열리면 관여자에게 중요 알림**(2026-10-15 · E17-S01 · REQ-API-316) — 카탈로그는 `finding.opened`
  // (critical severity)만 적는다. 다른 심각도는 알림을 만들지 않는다(`tierFor` 가 거른다). 받는 사람은 관여자뿐이다
  [NERV_EVENT_PHASE2.FINDING_OPENED]: 'critical',
  // 발견 코멘트는 스펙 코멘트와 같은 무게다 — 사람이 남긴 말이고, 답을 기다린다
  [NERV_EVENT_PHASE2.FINDING_COMMENTED]: 'standard',
  [NERV_EVENT.SPEC_COMMENT_ADDED]: 'standard',
  [NERV_EVENT.SPEC_RECHECK_REQUESTED]: 'standard',
  // 발견 처분(2026-10-15 · REQ-API-316) — 이미 일어난 일이라 보통이다. 같은 라운드의 처분은 한 줄로 묶는다
  [NERV_EVENT_PHASE2.FINDING_RESOLVED]: 'standard',
  [NERV_EVENT.TASK_READY]: 'standard',
  // 결재 리마인더(2026-10-11 · REQ-API-296) — 결재 요청 자체가 이미 중요 알림이다. 리마인더까지 중요로 세면 같은 결재가
  // 배지를 두 번 올린다. 같은 결재의 리마인더는 한 줄로 묶는다(spec-workflow §2.6 "같은 승인 건은 1건으로")
  [NERV_EVENT.APPROVAL_REMINDED]: 'standard',
  // **결재 만료**(2026-10-15 · 사람 결정 · REQ-API-304) — 요청자에게 알린다. 결정을 기다리는 일이 아니라 이미 일어난
  // 일이라 보통이다(SLA 표의 채널이 다이제스트다). 라운드마다 한 이벤트라 묶지 않고 한 줄이다
  [NERV_EVENT.APPROVAL_EXPIRED]: 'standard',
  // 부른 사람만 받는다 — 결정을 기다리는 일은 아니라 배지를 올리지 않는다(REQ-API-178)
  [NERV_EVENT.INVITATION_DECLINED]: 'standard',
  [NERV_EVENT.SESSION_STARTED]: 'low',
  [NERV_EVENT.SESSION_COMPLETE]: 'low',
  [NERV_EVENT.TASK_CLAIMED]: 'low',
  [NERV_EVENT.TASK_DONE]: 'low',
};

export function tierOf(type: string): ImportanceTier | null {
  return NOTIFICATION_CATALOG[type as NervEventName] ?? null;
}

/**
 * **관여자에게도 가는 이벤트**(§6.1 ③ · 2026-10-15 · E17-S01 · REQ-API-316) — 카탈로그가 수신자를 작성자 · 담당자 ·
 * 스레드 참여자 · 리뷰 요청자로 적은 것이다. 역할 큐로 가던 것은 그대로 가고 관여자를 더한다.
 */
const INVOLVED_EVENTS: ReadonlySet<string> = new Set([
  NERV_EVENT.SPEC_APPROVED,
  NERV_EVENT.SPEC_REJECTED,
  NERV_EVENT.SPEC_COMMENT_ADDED,
  NERV_EVENT.TASK_BLOCKED,
  NERV_EVENT.TASK_REBRIEF_REQUIRED,
  NERV_EVENT_PHASE2.FINDING_OPENED,
  NERV_EVENT_PHASE2.FINDING_RESOLVED,
]);

/** 관여자에게만 가는 이벤트 — 카탈로그 수신자에 역할이 없다 */
const FINDING_EVENTS: ReadonlySet<string> = new Set([
  NERV_EVENT_PHASE2.FINDING_OPENED,
  NERV_EVENT_PHASE2.FINDING_RESOLVED,
]);

/**
 * **배치 키**(spec-workflow §6.3 · 2026-09-27 사람 결정 G2 · G3 · REQ-API-223).
 *
 * 보통 등급만 묶는다 — 중요 알림(승인 요청 · 스펙 승인 · 세션 무응답 …)은 헤더 배지가 세는 것이라,
 * 묶으면 몇 건이 왔는지 흐려진다. 같은 사람에게 같은 키가 오면 새 줄을 만들지 않고 열린 묶음에
 * 더한다. 키가 없으면(`null`) 한 건이 한 줄이다.
 */
export function batchKeyOf(event: {
  type: string;
  project_id: string;
  subject_id: string;
  payload?: Record<string, unknown> | null;
}): string | null {
  if (tierOf(event.type) !== 'standard') return null;
  switch (event.type) {
    case NERV_EVENT_PHASE2.FINDING_RESOLVED: {
      // 같은 라운드의 처분은 한 줄이다(§6.3 `review:{id}:resolutions`). 라운드를 모르는 옛 이벤트는 한 건이 한 줄이다
      const round = event.payload?.['review_session_id'];
      return typeof round === 'string' ? `review:${round}:resolutions` : null;
    }
    case NERV_EVENT.SPEC_RECHECK_REQUESTED:
      return `spec:${event.subject_id}:recheck`;
    case NERV_EVENT.SPEC_COMMENT_ADDED:
      return `spec:${event.subject_id}:comments`;
    case NERV_EVENT_PHASE2.FINDING_COMMENTED:
      return `finding:${event.subject_id}:comments`;
    case NERV_EVENT.TASK_READY:
      return `project:${event.project_id}:ready`;
    case NERV_EVENT.APPROVAL_REMINDED:
      return `approval:${event.subject_id}:reminder`;
    case NERV_EVENT.INVITATION_DECLINED:
      return `invitation:${event.subject_id}`;
    default:
      return null;
  }
}

/**
 * 이 알림을 **메일 요약에도** 넣는가(2026-10-11 · REQ-API-296). 기본은 넣는다. 결재 리마인더의 1회째(T+4h)만 앱 안에
 * 머문다 — SLA 표가 메일을 2회째(T+1d)부터 쓰라고 적었다(spec-workflow §2.6).
 */
function mailsNow(event: { type: string; payload?: Record<string, unknown> | null }): boolean {
  if (event.type !== NERV_EVENT.APPROVAL_REMINDED) return true;
  return Number(event.payload?.['level'] ?? 0) >= 2;
}

/** 파생할 이벤트 한 줄 — `route` 가 읽는 열 */
type RoutableEvent = {
  id: string;
  project_id: string;
  type: string;
  actor_user_id: string | null;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
};

/** 한 실행이 넘기는 페이지 상한 — 밀린 이력이 길어도 한 틱이 무한히 돌지 않게 한다 */
const MAX_PAGES = 20;

@Injectable()
export class NotificationService {
  /**
   * 지난 실행이 어디까지 봤는가(메모리). 워커는 advisory lock 을 쥔 한 프로세스라
   * 이 값이 곧 그 워커의 물마루다 — 재기동하면 비고, 그때는 최근 한 시간에서 시작한다(`resumePoint`).
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
    // 명시 `since` 는 호출자의 것이고, 없으면 지난 실행이 남긴 물마루에서 잇는다. 새로 뜬 워커는 물마루가 없다 —
    // 그때는 최근 한 시간만 다시 본다(REQ-API-317). 처음부터 훑으면 넓어진 규칙이 지난 이벤트에 소급된다
    let cursor: string = input.since?.toISOString() ?? this.cursor ?? (await this.resumePoint());
    let created = 0;

    // **창이 막히지 않게 앞으로 민다.** 예전에는 "알림 행이 없는 이벤트" 를 시각순 200건만
    // 읽고 끝냈다. 그런데 카탈로그 밖 이벤트(초안 자동 저장 등)·low 티어·수신자 0명은
    // `continue` 로 건너뛰며 **아무 표식도 남기지 않는다** — 그런 이벤트가 200건을 넘는
    // 순간 창이 그것들로 영구히 채워지고, 그 뒤의 `approval.requested` 는 다시는 읽히지
    // 않는다. 받은 요청 배지가 0 으로 굳고 사람은 결정 대기가 없다고 믿는다.
    //
    // 그래서 페이지를 넘긴다: 처리한 마지막 시각을 커서로 삼아 건너뛴 것들을 지나간다.
    // 두 조건을 함께 쓰는 것이 요점이다 — 시각 커서는 **전진**을, `NOT EXISTS` 는
    // **중복 방지**를 맡는다(재기동하면 최근 한 시간에서 다시 시작한다 — `resumePoint`).
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const at: string = cursor;
      const { rows: events }: { rows: RoutableEvent[] } = await this.db.execute<RoutableEvent>(sql`
        SELECT e.id, e.project_id, e.type, e.actor_user_id, e.subject_type, e.subject_id, e.payload,
               e.occurred_at::text AS occurred_at
          FROM event e
         WHERE NOT EXISTS (SELECT 1 FROM notification n WHERE n.event_id = e.id)
           -- 묶음에 더해진 이벤트는 그 줄의 event_id 가 아니다(줄은 마지막 이벤트를 가리킨다) — 여기서 본다
           AND NOT EXISTS (SELECT 1 FROM notification_batch_event b WHERE b.event_id = e.id)
           AND e.occurred_at > ${at}
         ORDER BY e.occurred_at
         LIMIT ${limit}
      `);
      if (events.length === 0) break;

      for (const event of events) {
        const tier = await this.tierFor(event);
        // 카탈로그 밖 · 배경 활동은 알림이 아니다 — 건너뛰되 **커서는 지나간다**
        if (tier !== null && tier !== 'low') {
          const recipients = await this.recipientsFor(event);
          // **이미 닫힌 요청의 알림은 읽은 채로 만든다**(REQ-API-176). 파생은 워커가 나중에 하므로
          // 그 사이 결정·답변이 먼저 나면, 닫는 쪽이 읽음으로 바꿀 행이 아직 없었다 — 그러면 처리된
          // 요청의 안 읽은 알림이 뒤늦게 생겨 배지를 올린다. 기록은 남기고 수에는 넣지 않는다
          // 이미 처분된 발견의 「열림」 알림도 같다 — 파생보다 처분이 먼저면 배지를 올릴 일이 끝났다(REQ-API-316)
          const closed =
            (await requestAlreadyClosed(this.db, event)) || (await this.findingClosed(event));
          const importance = tier === 'critical' || tier === 'high' ? 'immediate' : 'digest';
          // **사람이 고른 수준**(2026-09-27 · 사람 결정 N3 · REQ-API-219). 고른 수준 밖의 알림은
          // 버리지 않고 읽음으로 넣는다 — 닫힌 요청과 같은 방식이다. 받은 요청에는 닿지 않는다
          const quiet = await this.quietRecipients(event.project_id, recipients, importance);
          const batchKey = batchKeyOf(event);
          const loud: string[] = [];
          for (const userId of recipients) {
            const read = closed || quiet.has(userId);
            const added =
              batchKey === null
                ? await this.insertOne(event, userId, importance, read)
                : await this.addToBatch(event, userId, importance, read, batchKey, {
                    mailed: !mailsNow(event),
                  });
            if (!added) continue;
            if (!read) loud.push(userId);
            created += 1;
          }
          // **개인 룸으로 나가는 유일한 방송**(api.md §3.3). 이것이 없던 동안 `user:{id}` 룸과
          // `GET /sse/me` 는 열려 있기만 하고 아무것도 흘리지 않았다 — 종은 새로고침해야
          // 숫자가 바뀌었고, 다른 프로젝트 화면에 있던 사람은 자기 앞으로 온 승인 요청을
          // 실시간으로 받지 못했다(프로젝트 룸은 그가 join 한 프로젝트만 흘린다).
          //
          // 방송하는 것은 **원본 이벤트가 아니라 `notification.created`** 다. 원본을 개인
          // 룸에도 흘리면 프로젝트 룸에 이미 있는 사람이 같은 봉투를 두 번 받는다.
          // 읽음으로 넣은 사람에게는 흘리지 않는다 — 배지가 오르지 않을 알림으로 화면을 깨우지 않는다
          if (loud.length > 0 && !closed) await this.announce(event, loud);
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
   * **새로 뜬 워커가 어디서 잇는가**(2026-10-15 · REQ-API-317).
   *
   * 예전에는 커서가 비면 알림이 없는 이벤트를 **처음부터** 다시 훑었다. 대부분의 이벤트는 알림을 만들지 않으니(카탈로그 밖 ·
   * low · 수신자 0명) 그것은 이벤트 표 전체였고, 규칙이 넓어진 배포 뒤에는 지난 이벤트가 새 규칙으로 알림이 됐다 —
   * 2026-10-15 에 `finding.opened` · `finding.resolved` 가 카탈로그에 든 뒤 첫 실행이면 지난 리뷰의 발견 전부(clemvion
   * 리뷰 임포트처럼 수천 건)가 그랬다. 밀린 이력이 길면 그동안 새 결재 요청의 알림도 그 뒤에서 기다렸다.
   *
   * 이제 최근 `NOTIFICATION_RESUME_WINDOW_SECONDS`(한 시간)의 이벤트만 다시 본다. 재기동 직전 몇 분의 놓친 이벤트는
   * 여전히 파생되고(이미 만든 알림은 `NOT EXISTS` 와 유일 인덱스가 거른다), 창보다 오래된 이벤트는 규칙이 바뀌어도 알림이
   * 되지 않는다. 시각은 DB 의 것이다 — `occurred_at` 과 같은 시계로 잰다.
   *
   * 「알림을 만든 가장 나중 이벤트」를 물마루로 되살리는 안은 택하지 않았다. 조용한 프로젝트에서는 그 이벤트가 몇 시간 ·
   * 며칠 전일 수 있어 결국 창이 함께 필요하고, 창 안에서 더 좁히는 이득(한 시간 안의 새 규칙 이벤트 — 어차피 막 생긴 일이다)
   * 보다 대가가 크다: 이벤트 파티션을 읽어야 하고, 시각이 앞선 이벤트 하나가 시작점을 밀어 그 앞의 놓친 이벤트를 가린다.
   */
  private async resumePoint(): Promise<string> {
    const { rows } = await this.db.execute<{ at: string }>(sql`
      SELECT (now() - make_interval(secs => ${NOTIFICATION_RESUME_WINDOW_SECONDS}))::text AS at
    `);
    // 행은 언제나 하나다 — 없으면 앱의 시계로 같은 창을 잰다
    const at =
      rows[0]?.at ?? new Date(Date.now() - NOTIFICATION_RESUME_WINDOW_SECONDS * 1000).toISOString();
    this.logger.log(`알림 파생을 ${at} 뒤의 이벤트부터 잇는다`);
    return at;
  }

  /**
   * 묶지 않는 알림 — 한 건이 한 줄이다.
   *
   * **한 이벤트 · 한 사람 · 한 행**(2026-09-27 · REQ-API-222 · REQ-DB-029). `route` 의 `NOT EXISTS` 는
   * 읽는 순간의 판단이라, 파생이 겹치면 둘 다 "없다" 고 보고 같은 알림을 두 번 넣을 수 있었다.
   * 유일 인덱스가 둘째 행을 막고, 여기서는 들어갔는지를 돌려준다.
   */
  private async insertOne(
    event: { id: string; project_id: string },
    userId: string,
    importance: 'immediate' | 'digest',
    read: boolean,
  ): Promise<boolean> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state, read_at)
      VALUES (${newId()}, ${event.project_id}, ${userId}, ${event.id},
              ${importance}::notification_importance,
              'inapp', ${read ? 'read' : 'unread'}::notification_state,
              ${read ? sql`now()` : sql`NULL`})
      ON CONFLICT (event_id, user_id) DO NOTHING
      RETURNING id
    `);
    return rows.length > 0;
  }

  /**
   * **열린 묶음에 더한다**(2026-09-27 · 사람 결정 G2 · REQ-API-223 · REQ-DB-030).
   *
   * 같은 사람 · 같은 키의 열린 줄이 있으면 건수를 올리고 맨 위로 올린다(`last_at`). 줄은 마지막
   * 이벤트를 가리킨다 — 누가 · 언제가 가장 최근의 것이다. 없으면 새 줄을 연다. 열린 줄은 키마다
   * 하나라(`notification_open_batch`) 파생이 겹쳐도 둘째는 같은 줄에 더해진다.
   *
   * **상태가 다른 열린 줄은 닫고 새로 연다.** 수준 밖이라 읽음으로 들어온 묶음(REQ-API-219)에 안 읽은
   * 알림을 더하면 읽은 줄이 다시 안 읽음이 되고, 반대면 조용해야 할 알림이 배지에 잡힌다.
   *
   * 이벤트를 묶음에 적는 것(`notification_batch_event`)이 멱등 키다. 같은 이벤트가 이미 이 사람의
   * 묶음에 있으면 유일 위반으로 트랜잭션 전체가 되돌아가 건수도 오르지 않는다.
   */
  private async addToBatch(
    event: { id: string; project_id: string },
    userId: string,
    importance: 'immediate' | 'digest',
    read: boolean,
    batchKey: string,
    /**
     * **메일 요약에 넣지 않는다**(2026-10-11 · REQ-API-296). 결재 리마인더의 1회째(T+4h)는 앱 안에만 알린다 — 그 줄을
     * 이미 보낸 것으로 표시해(`delivered_at`) 요약이 건너뛰게 한다. 2회째가 같은 줄에 더해지면 `last_at` 이 그보다
     * 뒤라 다음 요약에 든다.
     */
    options: { mailed?: boolean } = {},
  ): Promise<boolean> {
    const state = read ? 'read' : 'unread';
    const delivered = options.mailed === true ? sql`now()` : sql`NULL`;
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE notification SET batch_open = false
           WHERE user_id = ${userId} AND batch_key = ${batchKey} AND batch_open
             AND state <> ${state}::notification_state
        `);
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state,
                                    read_at, batch_key, batch_size, last_at, batch_open, delivered_at)
          VALUES (${newId()}, ${event.project_id}, ${userId}, ${event.id},
                  ${importance}::notification_importance,
                  'inapp', ${state}::notification_state, ${read ? sql`now()` : sql`NULL`},
                  ${batchKey}, 1, now(), true, ${delivered})
          ON CONFLICT (user_id, batch_key) WHERE batch_open DO UPDATE
             SET batch_size = notification.batch_size + 1,
                 last_at = now(),
                 event_id = EXCLUDED.event_id
          RETURNING id
        `);
        const id = rows[0]?.id;
        if (id === undefined) throw new Error(`묶음 줄을 열지 못했다 — key=${batchKey}`);
        await tx.execute(sql`
          INSERT INTO notification_batch_event (notification_id, event_id, user_id)
          VALUES (${id}, ${event.id}, ${userId})
        `);
      });
      return true;
    } catch (err) {
      // 이미 이 사람의 묶음에 든 이벤트다(겹친 파생) — 되돌렸으므로 건수도 그대로다
      if (isUniqueViolation(err)) return false;
      throw err;
    }
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
   * 나머지 이벤트는 역할 큐다. **③관여는 2026-10-15 에 들어왔다**(E17-S01 · REQ-API-316) — 카탈로그가 작성자 ·
   * 담당자 · 스레드 참여자 · 리뷰 요청자로 적은 이벤트는 역할 큐에 그 사람들을 더한다(`involvedTargets`). ②워치는
   * 아직이다(워치 테이블이 없다 — E17-S02 · screens.md §2.4 말미).
   */
  private async recipientsFor(event: {
    project_id: string;
    actor_user_id: string | null;
    type: string;
    subject_type?: string;
    subject_id: string;
    payload?: Record<string, unknown> | null;
  }): Promise<string[]> {
    if (event.type === NERV_EVENT.APPROVAL_OVERDUE) return this.escalationTargets(event);
    // **격상은 admin 에게만**(2026-10-15 · REQ-API-319) — 정책을 고칠 수 있는 사람이다. 역할 큐(admin · planner)로 보내면
    // 고칠 수 없는 사람의 배지가 오른다
    if (event.type === NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED) return this.adminTargets(event);
    // 미러 원격을 고칠 사람도 admin 이다(REQ-CB-063)
    if (event.type === NERV_EVENT_PHASE2.MIRROR_DIVERGED) return this.adminTargets(event);
    // **오프라인 큐의 실패는 보고한 사람에게 간다**(2026-10-16 · REQ-API-322). 행위자 제외 규칙의 예외다 — 행위자는 그 사람의
    // 플러그인이고, 알릴 사람은 그 쓰기가 들어가지 않은 줄 모르는 그 사람이다. 지금 멤버가 아니면 목록이 거른다(REQ-API-211)
    if (event.type === NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED) {
      return event.actor_user_id === null ? [] : [event.actor_user_id];
    }
    if (event.type === NERV_EVENT.APPROVAL_EXPIRED) {
      // **요청자에게 알린다**(2026-10-15 · REQ-API-304) — 다시 낼지 정할 사람이다. 행위자(없다)가 아니라 payload 가 든다
      const requester = event.payload?.['requested_by_user_id'];
      return typeof requester === 'string' ? [requester] : [];
    }
    if (event.type === NERV_EVENT.APPROVAL_REMINDED) {
      // **리마인더는 그 결재 요청을 받는 사람에게 간다**(2026-10-11 · REQ-API-296) — 라우팅은 요청과 한 벌이고, 뺄
      // 사람은 리마인더의 행위자(없다)가 아니라 그 결재를 요청한 사람이다
      const requester = event.payload?.['requested_by_user_id'];
      const asRequest = {
        ...event,
        actor_user_id: typeof requester === 'string' ? requester : null,
      };
      return (await this.approvalTargets(asRequest)) ?? this.roleQueue(asRequest);
    }
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
    if (event.type === NERV_EVENT.INVITATION_DECLINED) {
      // **부른 사람에게만** 간다 — 역할 큐로 흩뿌리면 초대와 무관한 사람들이 남의 초대 결과를 읽는다
      const inviter = event.payload?.['invited_by_user_id'];
      return typeof inviter === 'string' && inviter !== event.actor_user_id ? [inviter] : [];
    }
    if (event.type === NERV_EVENT.SPEC_RECHECK_REQUESTED) {
      const owners = await this.specOwnerTargets(event);
      if (owners !== null) return owners;
    }
    if (INVOLVED_EVENTS.has(event.type)) {
      const involved = await this.involvedTargets(event);
      // 발견 이벤트는 카탈로그 수신자가 관여자뿐이다 — 역할 큐로 흩뿌리면 열린 critical 마다 admin · planner 전원이 받는다
      const queue = FINDING_EVENTS.has(event.type) ? [] : await this.roleQueue(event);
      // 겹치면 한 번이다 — 같은 이벤트 · 같은 사람은 한 줄(유일 인덱스가 겹친 파생도 막는다)
      return [...new Set([...queue, ...involved])];
    }
    return this.roleQueue(event);
  }

  /**
   * 이 이벤트가 알림을 만드는 등급 — 카탈로그(`tierOf`)를 따르되 **열린 발견은 critical 만**이다(§6.3 `finding.opened`
   * (critical severity) · REQ-API-316). 심각도는 이벤트가 아니라 발견 행에서 읽는다 — 그 값이 진실이고, 옛 이벤트에도 맞다.
   */
  private async tierFor(event: {
    type: string;
    subject_id: string;
  }): Promise<ImportanceTier | null> {
    const tier = tierOf(event.type);
    if (tier === null || event.type !== NERV_EVENT_PHASE2.FINDING_OPENED) return tier;
    const { rows } = await this.db.execute<{ severity: string }>(
      sql`SELECT severity::text AS severity FROM finding WHERE id = ${event.subject_id}`,
    );
    return rows[0]?.severity === 'critical' ? tier : null;
  }

  /** 열림 알림의 발견이 이미 처분됐는가 — 그 밖의 이벤트면 거짓이다 */
  private async findingClosed(event: { type: string; subject_id: string }): Promise<boolean> {
    if (event.type !== NERV_EVENT_PHASE2.FINDING_OPENED) return false;
    const { rows } = await this.db.execute<{ closed: boolean }>(
      sql`SELECT (status <> 'open') AS closed FROM finding WHERE id = ${event.subject_id}`,
    );
    return rows[0]?.closed === true;
  }

  /**
   * **관여자**(§6.1 ③ — 내가 작성 · 클레임 · 코멘트한 대상의 후속 이벤트 · 2026-10-15 · E17-S01 · REQ-API-316).
   *
   * 카탈로그(§6.3)가 수신자로 적은 사람을 표 없이 쓸 수 있는 열에서 찾는다. 워치(②)는 테이블이 없어 아직이다(E17-S02).
   *
   * | 이벤트 | 관여자 |
   * | --- | --- |
   * | `spec.approved` · `spec.rejected` | 그 스펙 버전의 작성자 |
   * | `spec.comment_added` | 본문 코멘트면 같은 문서 · 같은 앵커의 열린 코멘트를 쓴 사람(스레드), 리뷰 결정 「코멘트」면 그 버전의 작성자 |
   * | `task.blocked` | 작업 담당자 |
   * | `task.rebrief_required` | 작업 담당자 + 활성 클레임을 가진 사람(세션 소유자) |
   * | `finding.opened` · `finding.resolved` | 그 발견을 관찰한 라운드의 작업(과 발견에서 만든 작업)의 담당자 · 그 라운드를 제출한 세션의 사람(리뷰 요청자) · 발견이 가리키는 스펙 버전의 작성자 |
   *
   * **행위자 자신은 뺀다** — 자기가 한 일의 알림은 소음이다. **지금 그 프로젝트의 멤버만** 받는다 — 문서를 쓴 뒤 프로젝트를
   * 떠난 사람에게 알림을 남기면 볼 수 없는 프로젝트의 키 · 제목이 그 사람에게 간다(조직 경계는 REQ-API-125 와 같다).
   */
  private async involvedTargets(event: {
    project_id: string;
    actor_user_id: string | null;
    type: string;
    subject_type?: string;
    subject_id: string;
    payload?: Record<string, unknown> | null;
  }): Promise<string[]> {
    const candidates = this.involvedSql(event);
    if (candidates === null) return [];
    const { rows } = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT x.user_id
        FROM (${candidates}) x
        JOIN project p ON p.id = ${event.project_id}
       WHERE x.user_id IS NOT NULL
         ${event.actor_user_id === null ? sql`` : sql`AND x.user_id <> ${event.actor_user_id}`}
         AND EXISTS (SELECT 1 FROM membership m
                      WHERE m.user_id = x.user_id AND m.org_id = p.org_id
                        AND (m.project_id = p.id OR m.project_id IS NULL))
    `);
    return rows.map((r) => r.user_id);
  }

  /** 이벤트마다 관여자를 고르는 질의(`user_id` 한 열) — 관여자가 없는 이벤트면 `null` */
  private involvedSql(event: {
    type: string;
    subject_type?: string;
    subject_id: string;
    payload?: Record<string, unknown> | null;
  }): SQL | null {
    const subject = event.subject_id;
    const versionAuthor = sql`SELECT author_user_id AS user_id FROM spec_version WHERE id = ${subject}`;
    switch (event.type) {
      case NERV_EVENT.SPEC_APPROVED:
      case NERV_EVENT.SPEC_REJECTED:
        return versionAuthor;
      case NERV_EVENT.SPEC_COMMENT_ADDED: {
        // 리뷰 결정 「코멘트」는 대상이 스펙 버전이다 — 검토를 낸 문서가 초안으로 돌아왔으니 그 작성자가 관여자다
        if (event.subject_type === 'spec_version') return versionAuthor;
        const comment = event.payload?.['comment_id'];
        if (typeof comment !== 'string') return null;
        // 스레드 = 같은 문서 · 같은 앵커의 열린 코멘트. 처분된 코멘트는 끝난 대화다
        return sql`
          SELECT c.author_user_id AS user_id
            FROM spec_comment c JOIN spec_comment me ON me.id = ${comment}
           WHERE c.spec_id = me.spec_id AND c.anchor = me.anchor AND c.status = 'open'`;
      }
      case NERV_EVENT.TASK_BLOCKED:
        return sql`SELECT assignee_user_id AS user_id FROM task WHERE id = ${subject}`;
      case NERV_EVENT.TASK_REBRIEF_REQUIRED:
        return sql`
          SELECT assignee_user_id AS user_id FROM task WHERE id = ${subject}
          UNION
          SELECT user_id FROM claim WHERE task_id = ${subject} AND status = 'active'`;
      case NERV_EVENT_PHASE2.FINDING_OPENED:
      case NERV_EVENT_PHASE2.FINDING_RESOLVED:
        return sql`
          WITH f AS (SELECT * FROM finding WHERE id = ${subject}),
               rounds AS (
                 SELECT rs.task_id, rs.agent_session_id FROM review_session rs
                  WHERE rs.id IN (SELECT o.review_session_id FROM finding_occurrence o
                                   WHERE o.finding_id = ${subject})
                     OR rs.id = (SELECT last_session_id FROM f))
          SELECT t.assignee_user_id AS user_id FROM task t
           WHERE t.id IN (SELECT task_id FROM rounds) OR t.id = (SELECT promoted_task_id FROM f)
          UNION
          SELECT s.user_id FROM agent_session s WHERE s.id IN (SELECT agent_session_id FROM rounds)
          UNION
          SELECT sv.author_user_id AS user_id FROM spec_version sv
           WHERE sv.id = coalesce((SELECT spec_version_id FROM f),
                                  (SELECT r.current_version_id FROM requirement r
                                    WHERE r.id = (SELECT requirement_id FROM f)))`;
      default:
        return null;
    }
  }

  /**
   * **재확인 요청은 그 문서의 주인에게 간다**(2026-09-07 · REQ-API-150 · api.md §3.3 룸 표가
   * "대상 문서 owner" 라 적은 자리다).
   *
   * 역할 큐로 흩뿌리던 동안 recheck 1,336건이 admin·planner 의 목록을 채웠고, 결정이 필요한
   * 19건이 그 안에 묻혔다. 문서에 주인 역할이 없으면(`owner_role IS NULL`) 기본 큐로 간다 —
   * 아무에게도 가지 않는 것보다 낫다.
   *
   * **주인이 행위자뿐이면 아무에게도 보내지 않는다**(2026-09-27 · REQ-API-150 개정). 행위자(승인한
   * 사람 · REQ-API-221)를 뺀 결과가 비었다고 기본 큐로 넘기면, 자기 문서가 참조하는 문서를 승인할
   * 때마다 admin · planner 의 목록이 찬다 — 주인이 없는 것과 주인이 자기뿐인 것은 다르다.
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
    `);
    if (rows.length === 0) return null;
    return rows.map((r) => r.user_id).filter((id) => id !== event.actor_user_id);
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
   * **지연 결재를 누구에게 알리나**(2026-10-15 · 사람 결정 · REQ-API-305) — **결정할 수 있는데 아직 알림을 받지 못한
   * 사람**에게만. 결정할 수 있는 사람은 `assertMayDecide` 가 정한다: 지정 결재는 그 사람과 admin, 직군 자리 결재는 그
   * 역할과 admin, 기본 큐는 `approval:decide` 를 가진 역할. 요청 알림은 지정된 사람 · 그 역할 · 기본 큐에 갔으므로(위
   * `approvalTargets` · `roleQueue`) 받지 못한 사람은 **지정 · 직군 자리 결재의 admin** 뿐이다 — 그 역할을 함께 가진
   * admin 은 이미 받았다. 기본 큐 결재는 admin · planner 가 모두 받았으므로 아무에게도 보내지 않는다(카드와 개요의
   * "지연" 표시가 그 자리다). 요청자는 뺀다 — 리마인더와 같다.
   */
  private async escalationTargets(event: {
    project_id: string;
    subject_id: string;
    payload?: Record<string, unknown> | null;
  }): Promise<string[]> {
    const { rows } = await this.db.execute<{
      assignee_user_id: string | null;
      assignee_role: string | null;
      requested_by_user_id: string;
    }>(sql`
      SELECT assignee_user_id, assignee_role::text AS assignee_role, requested_by_user_id
        FROM approval WHERE id = ${event.subject_id} AND project_id = ${event.project_id}
    `);
    const approval = rows[0];
    if (approval === undefined) return [];
    if (approval.assignee_user_id === null && approval.assignee_role === null) return [];
    // 조직 경계는 요청 알림과 같다(REQ-API-125) — 조직 단위 멤버십은 그 조직의 것만 센다
    const { rows: admins } = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT m.user_id FROM membership m
        JOIN project p ON p.id = ${event.project_id}
       WHERE m.org_id = p.org_id
         AND (m.project_id = p.id OR m.project_id IS NULL)
         AND m.role = 'admin'
         AND m.user_id <> ${approval.requested_by_user_id}
         ${approval.assignee_user_id === null ? sql`` : sql`AND m.user_id <> ${approval.assignee_user_id}`}
         -- 그 역할을 함께 가진 admin 은 요청 알림을 이미 받았다
         ${
           approval.assignee_role === null
             ? sql``
             : sql`AND NOT EXISTS (
                 SELECT 1 FROM membership r
                  WHERE r.user_id = m.user_id AND r.org_id = p.org_id
                    AND (r.project_id = p.id OR r.project_id IS NULL)
                    AND r.role = ${approval.assignee_role}::member_role)`
         }
    `);
    return admins.map((r) => r.user_id);
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
  /** 그 프로젝트의 admin(조직 단위 admin 포함) — 행위자는 뺀다. 조직 경계는 역할 큐와 같다(REQ-API-125) */
  private async adminTargets(event: {
    project_id: string;
    actor_user_id: string | null;
  }): Promise<string[]> {
    const { rows } = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT m.user_id FROM membership m
        JOIN project p ON p.id = ${event.project_id}
       WHERE m.org_id = p.org_id
         AND (m.project_id = p.id OR m.project_id IS NULL)
         AND m.role = 'admin'
         ${event.actor_user_id === null ? sql`` : sql`AND m.user_id <> ${event.actor_user_id}`}
    `);
    return rows.map((r) => r.user_id);
  }

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
    /**
     * **범위로 좁힌다**(2026-09-27 · 사람 결정 N1 · REQ-API-214). 프로젝트(slug 또는 UUID ·
     * `org` 가 slug 의 한정자) 또는 조직 하나 — 없으면 지금처럼 모든 조직이다.
     */
    project?: string | null;
    org?: string | null;
  }): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
    const scopeFilter = await scopeFilterSql(this.db, input.userId, {
      project: input.project ?? null,
      org: input.org ?? null,
    });
    const stateFilter =
      input.state == null
        ? // **묶음에 접힌 줄은 빼고 본다**(2026-09-27 · REQ-API-225 · 마이그레이션 0038). 쌓여 있던 안 읽은
          // 보통 알림을 묶음으로 접을 때 나머지 줄을 지우지 않고 `archived` 로 두었다 — 그 이벤트는 남긴
          // 줄의 묶음에 들어 있다. `state=archived` 로 물으면 그 줄들이 나온다
          sql` AND n.state <> 'archived'`
        : // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
          sql` AND n.state = ${assertVocab([input.state], notificationState.enumValues, 'state')[0]}::notification_state`;
    const importanceFilter =
      input.importance == null
        ? sql``
        : sql` AND n.importance = ${assertVocab([input.importance], notificationImportance.enumValues, 'importance')[0]}::notification_importance`;
    // **커서는 (last_at, id) 다**(§1.6 · REQ-API-124 · 2026-09-27 REQ-API-224). 예전 주석은 "같은 시각의
    // 행을 건너뛸 수 있지만 감수한다" 였는데, REQ-API-083 이 이 목록에도 "겹치지도 빠뜨리지도
    // 않는 다음 쪽" 을 이미 약속하고 있었다 — 감수는 요구사항과 어긋난 채였다.
    // 한 이벤트가 여러 수신자에게 파생되면 같은 시각이 여럿이다. 순서는 **마지막으로 더해진 시각**이다 —
    // 묶음에 알림이 더해지면 그 줄이 맨 위로 온다(묶지 않은 알림은 만든 시각과 같다).
    const cursor = decodeCursor(input.before ?? undefined);
    const cursorAt = cursorTimestamp(cursor?.[0]);
    const cursorRowId = cursorId(cursor?.[1]);
    const legacyAt = cursor === null ? cursorTimestamp(input.before) : null;
    const beforeFilter =
      cursorAt !== null && cursorRowId !== null
        ? sql` AND (n.last_at, n.id) < (${cursorAt}::timestamptz, ${cursorRowId}::uuid)`
        : legacyAt !== null
          ? sql` AND n.last_at < ${legacyAt}::timestamptz`
          : sql``;
    const limit = Math.min(input.limit ?? 50, 200);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT n.id, n.state::text AS state, n.importance::text AS importance,
             n.channel::text AS channel,
             -- 커서가 이 값을 그대로 싣는다 — **정밀도를 드라이버에 맡기지 않는다**(이벤트 피드와 같은 규칙).
             -- 파생 알림은 한 이벤트에서 같은 ms 안에 여럿 생기므로, µs 가 잘리면 그 무리의
             -- 일부가 어느 쪽 부등호에도 걸리지 않는 창에 빠져 **영영 나오지 않는다**.
             n.created_at::text AS created_at,
             n.read_at, n.event_id,
             -- **묶음**(2026-09-27 · 사람 결정 G2 · REQ-API-224). 몇 건이 이 줄에 들었는지 · 처음(created_at)과
             -- 마지막(last_at) · 무엇 때문인지(최근 10건). 묶지 않은 알림은 1 · 같은 두 시각 · 빈 목록이다
             n.batch_key, n.batch_size, n.last_at::text AS last_at,
             coalesce(bc.causes, '[]'::json) AS batch_causes,
             e.type AS event_type, e.subject_type::text AS subject_type, e.subject_id,
             e.to_state, e.is_agent, e.occurred_at,
             u.display_name AS actor_name,
             p.slug AS project_slug, p.name AS project_name,
             -- **어느 조직의 일인가**(2026-09-24 · REQ-API-170). 이 목록은 조직을 가로지르는데
             -- 조직을 싣지 않아, 두 조직에 같은 slug 가 있으면 화면이 둘을 가를 수 없었다
             (SELECT o.slug FROM organization o WHERE o.id = p.org_id) AS org_slug,
             (SELECT o.name FROM organization o WHERE o.id = p.org_id) AS org_name,
             -- **무엇에 대한 알림인가**(2026-09-24 · REQ-API-181). 스펙·작업 주체만 조인해서 가장 무거운
             -- 알림(결재 요청 · 에이전트 질문)이 키도 제목도 없이 "승인 요청" 만 반복했다 — 대상 조각은
             -- 이벤트 피드와 같다(event-subject.ts). version_no 는 알림이 diff 주소를 만드는 칸이다
             -- (REQ-API-159 · REQ-WEB-163): 대상이 스펙 버전이 아닌 알림(재검토 요청은 subject 가 spec
             -- 이다)은 NULL 이고, 그때 화면은 본문으로 간다 — **없는 것과 1 은 다르다.**
             ${EVENT_SUBJECT_COLUMNS},
             -- **그 요청이 닫혔는가**(2026-09-24 · REQ-API-176). 승인 요청·질문 알림은 받은 요청의
             -- 그림자인데, 누가 먼저 처리해도 행은 여전히 "승인 요청" 이라고 말했다 — 누르면 이미
             -- 없는 카드를 찾아갔다. 결정(승인·거절·코멘트) 또는 답변·취소와 그것을 한 사람을 싣는다
             coalesce(ap.decision::text,
                      CASE WHEN qq.status <> 'open' THEN qq.status::text END) AS resolution,
             coalesce(adu.display_name, qdu.display_name) AS resolved_by
        FROM notification n
        JOIN project p ON p.id = n.project_id
   LEFT JOIN event e ON e.id = n.event_id
   LEFT JOIN "user" u ON u.id = e.actor_user_id
   ${EVENT_SUBJECT_JOINS}
   LEFT JOIN approval ap ON ap.id = e.subject_id AND e.subject_type = 'approval'
   LEFT JOIN "user" adu ON adu.id = ap.decided_by_user_id
   LEFT JOIN question qq ON qq.id = e.subject_id AND e.subject_type = 'question'
   LEFT JOIN "user" qdu ON qdu.id = qq.answered_by_user_id
   -- 원인은 **묶음 줄에만** 모은다 — 최근 10건과, 재검토면 원인 문서 · 작업 준비면 그 작업의 키
   LEFT JOIN LATERAL (
     SELECT json_agg(c ORDER BY c.occurred_at DESC) AS causes
       FROM (
         SELECT ce.id AS event_id, ce.occurred_at, cu.display_name AS actor_name, ce.is_agent,
                cs.key AS because_key, ct.key AS task_key
           FROM notification_batch_event be
           JOIN event ce ON ce.id = be.event_id
      LEFT JOIN "user" cu ON cu.id = ce.actor_user_id
      LEFT JOIN spec cs ON cs.id = (ce.payload ->> 'because_of')::uuid
      LEFT JOIN task ct ON ct.id = ce.subject_id AND ce.subject_type = 'task'
          WHERE be.notification_id = n.id
          ORDER BY ce.occurred_at DESC
          LIMIT 10
       ) c
   ) bc ON n.batch_key IS NOT NULL
       WHERE n.user_id = ${input.userId}${stateFilter}${importanceFilter}${beforeFilter}${scopeFilter}
         -- 보관한 프로젝트의 알림은 숨긴다 — 딥링크가 닿는 곳이 목록에서 치운 자리다
         AND p.archived_at IS NULL
         -- **지금 멤버인 프로젝트의 알림만**(2026-09-27 · REQ-API-211). 행은 만들 때의 멤버에게
         -- 남아서, 프로젝트에서 빠진 사람이 그 프로젝트의 키와 제목을 계속 읽었다
         AND ${memberOfProjectSql(input.userId)}
       ORDER BY n.last_at DESC, n.id DESC
       LIMIT ${limit + 1}
    `);
    // 한 건 더 받아 **다음 쪽이 있는지**를 안다 — 총계를 세면 매 요청이 전량 스캔이다
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items,
      next_cursor:
        rows.length > limit && last !== undefined
          ? encodeCursor([String(last['last_at']), String(last['id'])])
          : null,
    };
  }

  /** EP-NTF-02 — 읽음 처리. 남의 알림을 읽음 처리할 수 없게 user_id 를 조건에 둔다. */
  async markRead(input: { userId: string; notificationId: string }): Promise<{ ok: true }> {
    // 목록에 보이지 않는 알림은 읽음 처리도 하지 않는다 — 셋(목록 · 수 · 처리)이 같은 범위를 본다(REQ-API-211)
    await this.db.execute(sql`
      UPDATE notification n SET state = 'read', read_at = now(), batch_open = false
        FROM project p
       WHERE n.id = ${input.notificationId} AND n.user_id = ${input.userId} AND n.state = 'unread'
         AND p.id = n.project_id AND p.archived_at IS NULL
         AND ${memberOfProjectSql(input.userId)}
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
   *
   * **목록 · 배지와 같은 범위만 바꾼다**(2026-09-27 · REQ-API-212). 보관한 프로젝트와 빠진
   * 프로젝트의 알림까지 읽음으로 바꿔서, 돌려준 건수가 배지 수보다 컸고 프로젝트를 되살리면
   * 그 알림이 이미 읽혀 있었다.
   */
  async markAllRead(input: {
    userId: string;
    /** 범위 — 목록과 같은 뜻이다(REQ-API-214) */
    project?: string | null;
    org?: string | null;
    /** 화면의 "중요" 필터 — 보이는 것만 바꾼다(2026-09-27 · 사람 결정 N4 · REQ-API-216) */
    importance?: string | null;
    /**
     * 기준 시각 — 화면이 받은 가장 새 알림의 시각. 그 뒤에 온 알림은 그대로 둔다: 누르는 사이에
     * 온 알림까지 바꾸면 사람은 본 적 없는 알림을 잃는다. 알아볼 수 없는 값은 400 이다.
     */
    until?: string | null;
  }): Promise<{ ok: true; marked: number }> {
    const scopeFilter = await scopeFilterSql(this.db, input.userId, {
      project: input.project ?? null,
      org: input.org ?? null,
    });
    const importanceFilter =
      input.importance == null
        ? sql``
        : sql` AND n.importance = ${assertVocab([input.importance], notificationImportance.enumValues, 'importance')[0]}::notification_importance`;
    let untilFilter = sql``;
    if (input.until != null) {
      const at = cursorTimestamp(input.until);
      if (at === null) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
          kind: 'invalid_input',
          field: 'until',
        });
      }
      // 묶음은 **마지막으로 더해진 시각**으로 본다(2026-09-27 · REQ-API-224) — 화면이 받은 뒤에 더해진
      // 알림이 있는 줄은 그 사람이 아직 보지 못한 것을 담고 있다
      untilFilter = sql` AND n.last_at <= ${at}::timestamptz`;
    }
    const { rows } = await this.db.execute<{ id: string }>(sql`
      UPDATE notification n SET state = 'read', read_at = now(), batch_open = false
        FROM project p
       WHERE n.user_id = ${input.userId} AND n.state = 'unread'
         AND p.id = n.project_id AND p.archived_at IS NULL
         AND ${memberOfProjectSql(input.userId)}${scopeFilter}${importanceFilter}${untilFilter}
      RETURNING n.id
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
         -- 목록과 같은 조건이다(REQ-API-211) — 빠진 프로젝트의 알림을 세면 지울 수 없는 수가 남는다
         AND ${memberOfProjectSql(userId)}
    `);
    return { count: rows[0]?.n ?? 0, immediate: rows[0]?.immediate ?? 0 };
  }

  /**
   * 이 알림을 **읽음으로 넣을** 사람들 — 그 프로젝트의 수준이 `none` 이거나, `important` 인데 알림이
   * 중요 등급이 아닌 사람(2026-09-27 · 사람 결정 N3 · REQ-API-219). 행이 없으면 `all` 이다.
   */
  private async quietRecipients(
    projectId: string,
    recipients: readonly string[],
    importance: 'immediate' | 'digest',
  ): Promise<Set<string>> {
    if (recipients.length === 0) return new Set();
    const { rows } = await this.db.execute<{ user_id: string; level: string }>(sql`
      SELECT user_id, level::text AS level FROM notification_preference
       WHERE project_id = ${projectId}
         AND user_id IN (${sql.join(
           recipients.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
    `);
    return new Set(
      rows
        .filter((r) => r.level === 'none' || (r.level === 'important' && importance === 'digest'))
        .map((r) => r.user_id),
    );
  }

  /**
   * EP-NTF-06 — **프로젝트의 알림 수준을 고른다**(2026-09-27 · 사람 결정 N3 · REQ-API-220).
   *
   * 내가 속한 프로젝트 하나로 풀고(REQ-API-213), `all` 이면 행을 지운다 — 기본값을 행으로 남기지
   * 않는다. 이미 받은 알림은 건드리지 않는다: 수준은 **앞으로 올 알림**의 약속이다.
   */
  async setLevel(input: {
    userId: string;
    project: string;
    org?: string | null;
    level: string;
  }): Promise<{ ok: true; project_id: string; level: string }> {
    const level = assertVocab([input.level], NOTIFICATION_LEVELS, 'level')[0]!;
    const picked = await resolveMemberProject(this.db, input.userId, {
      project: input.project,
      org: input.org ?? null,
    });
    if (level === 'all') {
      await this.db.execute(sql`
        DELETE FROM notification_preference
         WHERE user_id = ${input.userId} AND project_id = ${picked.id}
      `);
    } else {
      await this.db.execute(sql`
        INSERT INTO notification_preference (user_id, project_id, level, updated_at)
        VALUES (${input.userId}, ${picked.id}, ${level}::notification_level, now())
        ON CONFLICT (user_id, project_id)
        DO UPDATE SET level = EXCLUDED.level, updated_at = now()
      `);
    }
    return { ok: true, project_id: picked.id, level };
  }

  /**
   * EP-NTF-05 — **범위별 안 읽은 수**(2026-09-27 · 사람 결정 N1 · REQ-API-215).
   *
   * 알림 화면의 범위 칸이 조직 → 프로젝트마다 이 수를 보인다. 불러온 쪽만 세면 "더 보기" 뒤의
   * 알림이 빠지므로 서버가 센다(REQ-WEB-131 · 185). **알림이 없는 프로젝트도 0 으로 넣는다** —
   * 내가 속한 프로젝트가 칸에서 사라지면 "그 프로젝트의 알림은 어디서 보나" 를 다시 찾게 된다.
   * 조건은 목록 · 배지와 같다(보관 · 멤버십) — 합계가 EP-NTF-04 와 같아야 한다.
   */
  async scopes(userId: string): Promise<{
    items: Record<string, unknown>[];
    total: { unread: number; immediate: number };
  }> {
    const { rows } = await this.db.execute<{
      org_slug: string;
      org_name: string;
      project_id: string;
      project_slug: string;
      project_name: string;
      unread: number;
      immediate: number;
      level: string;
    }>(sql`
      SELECT o.slug AS org_slug, o.name AS org_name,
             p.id AS project_id, p.slug AS project_slug, p.name AS project_name,
             count(n.id)::int AS unread,
             count(n.id) FILTER (WHERE n.importance = 'immediate')::int AS immediate,
             -- 그 프로젝트의 알림 수준(행이 없으면 all · REQ-API-220) — 칸과 설정이 같은 값을 본다
             coalesce(pref.level::text, 'all') AS level
        FROM project p
        JOIN organization o ON o.id = p.org_id
   LEFT JOIN notification n
          ON n.project_id = p.id AND n.user_id = ${userId} AND n.state = 'unread'
   LEFT JOIN notification_preference pref
          ON pref.project_id = p.id AND pref.user_id = ${userId}
       WHERE p.archived_at IS NULL
         AND ${memberOfProjectSql(userId)}
       GROUP BY o.slug, o.name, p.id, p.slug, p.name, pref.level
       ORDER BY o.slug, p.name, p.slug
    `);
    return {
      items: rows,
      total: {
        unread: rows.reduce((sum, r) => sum + r.unread, 0),
        immediate: rows.reduce((sum, r) => sum + r.immediate, 0),
      },
    };
  }
}
