// 요청의 그림자 알림을 요청과 함께 닫는다 (2026-09-24 — UI/UX 검토 · REQ-API-176)
//
// 결재 요청과 질문은 **두 곳에서 센다** — 받은 요청(행동하는 곳)과 알림(그림자 · screens.md §2.9 ③).
// 받은 요청에서 카드를 처리하면 받은 요청 배지는 줄었지만 알림 배지는 그대로였다: 결정 경로
// 어디에서도 그 알림을 읽음으로 바꾸지 않았다. 역할 큐의 다른 승인자가 먼저 처리해도 내 알림은
// 여전히 "승인 요청" 이었고, 누르면 이미 없는 카드를 찾아 받은 요청으로 갔다. 사람은 두 배지를
// 매번 따로 비워야 했다 — 알림 배지가 다시 "지울 수 없는 숫자" 가 되는 길이다.
//
// 그래서 **요청이 닫히는 트랜잭션 안에서** 그 요청이 만든 알림을 모든 수신자에게서 읽음으로
// 바꾼다. 알림 파생은 워커가 나중에 하므로(`NotificationService.derive`) 파생보다 결정이 먼저면
// 여기서 바꿀 행이 아직 없다 — 그 틈은 파생이 "이미 닫힌 요청이면 읽음으로 만든다" 로 막는다.

import { NERV_EVENT } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';

/** 요청을 여는 이벤트 — 그 알림이 요청의 그림자다 */
export const REQUEST_OPENING_EVENTS = {
  approval: NERV_EVENT.APPROVAL_REQUESTED,
  question: NERV_EVENT.QUESTION_CREATED,
} as const;

export async function closeRequestNotifications(
  tx: Pick<NervDb, 'execute'>,
  subjectType: keyof typeof REQUEST_OPENING_EVENTS,
  subjectId: string,
): Promise<number> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    UPDATE notification n SET state = 'read', read_at = now()
      FROM event e
     WHERE e.id = n.event_id
       AND e.type = ${REQUEST_OPENING_EVENTS[subjectType]}
       AND e.subject_id = ${subjectId}
       AND n.state = 'unread'
    RETURNING n.id
  `);
  return rows.length;
}

/**
 * 파생 시점에 그 요청이 **이미 닫혔는가** — 닫혔으면 알림을 읽음으로 만든다(배지에 들지 않게).
 * 요청을 여는 이벤트가 아니면 `false` 다.
 */
export async function requestAlreadyClosed(
  db: Pick<NervDb, 'execute'>,
  event: { type: string; subject_id: string },
): Promise<boolean> {
  if (event.type === REQUEST_OPENING_EVENTS.approval) {
    const { rows } = await db.execute<{ closed: boolean }>(
      sql`SELECT (decision IS NOT NULL) AS closed FROM approval WHERE id = ${event.subject_id}`,
    );
    return rows[0]?.closed === true;
  }
  if (event.type === REQUEST_OPENING_EVENTS.question) {
    const { rows } = await db.execute<{ closed: boolean }>(
      sql`SELECT (status <> 'open') AS closed FROM question WHERE id = ${event.subject_id}`,
    );
    return rows[0]?.closed === true;
  }
  return false;
}
