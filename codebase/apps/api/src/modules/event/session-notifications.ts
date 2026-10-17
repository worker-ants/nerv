// 되살아난 세션의 무응답 알림을 닫는다 (2026-10-16 · REQ-API-352)
//
// `session.stale` 알림(REQ-API-327)은 "내 세션이 멈췄다" 를 그 세션의 주인에게 알린다. 그런데 노트북이 잠들어 알림이 오고
// 다시 열어 같은 세션이 되살아나도(훅 · bootstrap 재개 — REQ-API-279) 그 알림은 안 읽음으로 남아 배지를 올렸다. 알릴
// 일은 이미 끝났다 — 세션은 다시 움직이고, 회수된 클레임은 되살아난 에이전트가 다시 잡는다.
//
// 결재 요청의 그림자 알림(REQ-API-176 · `request-notifications.ts`)과 같은 두 단계로 막는다. 되살리는 트랜잭션 안에서
// 그 세션의 안 읽은 무응답 알림을 읽음으로 바꾸고, 파생이 되살아남보다 늦으면 파생이 읽음으로 만든다. 지우지는 않는다 —
// 클레임이 회수됐다는 기록은 목록에 남는다.

import { NERV_EVENT } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';

/** 세션을 되살리는 트랜잭션에서 부른다 — 그 세션의 안 읽은 무응답 알림을 모든 수신자에게서 읽음으로 바꾼다 */
export async function closeStaleSessionNotifications(
  tx: Pick<NervDb, 'execute'>,
  sessionId: string,
): Promise<number> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    UPDATE notification n SET state = 'read', read_at = now(), batch_open = false
      FROM event e
     WHERE e.id = n.event_id
       AND e.type = ${NERV_EVENT.SESSION_STALE}
       AND e.subject_type = 'agent_session' AND e.subject_id = ${sessionId}
       AND n.state = 'unread'
    RETURNING n.id
  `);
  return rows.length;
}

/**
 * 파생 시점에 그 세션이 **이미 되살아났는가** — 되살아났으면 무응답 알림을 읽음으로 만든다. 무응답 이벤트가 아니면 `false`
 * 다.
 *
 * 이벤트 순서가 아니라 세션 행의 지금 상태로 본다. 무응답 전이는 워커가, 되살림은 API 가 내서 두 이벤트의 시각은 서로 다른
 * 시계다. 같은 세션이 되살아났다가 다시 멈춘 뒤 파생이 한꺼번에 돌면 두 알림이 다 안 읽음이 되지만, 둘 다 지금 사실(멈춰
 * 있다)을 알리고 다음 되살림이 함께 닫는다.
 */
export async function staleSessionRevived(
  db: Pick<NervDb, 'execute'>,
  event: { type: string; subject_id: string },
): Promise<boolean> {
  if (event.type !== NERV_EVENT.SESSION_STALE) return false;
  const { rows } = await db.execute<{ live: boolean }>(sql`
    SELECT (state IN ('pending', 'active', 'awaiting_input')) AS live
      FROM agent_session WHERE id = ${event.subject_id}
  `);
  return rows[0]?.live === true;
}
