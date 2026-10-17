// 기다리던 세션을 깨운다 — 결재 결정 · 만료 · 에스컬레이션 결정이 같은 규칙을 쓴다
//   정본: api.md REQ-API-134 · 2026-10-16 사람 결정 D3(REQ-API-335)
//
// 클래스 밖의 함수로 둔다: ApprovalService(결정 · 만료)와 에스컬레이션 처리(review/escalation.ts — 카드가 다른 길로 닫힐 때)가
// 같은 트랜잭션 안에서 부른다. 두 곳이 각자 적으면 한쪽만 고쳐진다.

import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';
import { sqlArray } from '../../common/sql-array.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

/**
 * **세션을 붙잡는 결재인가**(`approval a2` 를 전제한다). 결정되지 않은 결재 가운데 둘은 기다림이 아니다.
 *
 * - **닫힌 라운드의 형제 슬롯**(2026-09-26). T3 의 한 슬롯이 거절되면 문서는 초안으로 가고 다른 슬롯은 결정 없이 남는다 — 그 슬롯이
 *   세션을 붙잡아 거절을 받고도 awaiting_input 에 머물렀다. 문서가 검토 중이 아닌 스펙 슬롯은 세지 않는다(만료도 같다).
 * - **기다리지 않는 에스컬레이션**(2026-10-16 · 사람 결정 D3). `blocking` 을 끈 처분의 카드는 서지만 세션은 일을 잇는다 — 그 카드가
 *   다른 결정이 세션을 깨우는 것을 막으면 기다리지 않겠다는 말이 거짓이 된다.
 */
export function holdsSessionSql(): ReturnType<typeof sql> {
  return sql`a2.decision IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM spec_version sv2
       WHERE a2.subject_type = 'spec_version' AND sv2.id = a2.subject_id
         AND sv2.status <> 'in_review'
    )
    AND NOT EXISTS (
      SELECT 1 FROM resolution r2
       WHERE a2.subject_type = 'escalation' AND r2.id = a2.subject_id AND NOT r2.blocking
    )`;
}

/**
 * **기다리던 세션을 깨운다** — 다른 대기 사유가 없을 때만(2026-09-07 · REQ-API-134). 열린 blocking 질문이나 세션을 붙잡는 다른
 * 결재(`holdsSessionSql`)가 있으면 그 세션은 여전히 사람을 기다리는 중이고, 여기서 `active` 로 돌려놓으면 S5 는 일하고 있는 세션으로
 * 그린다.
 */
export async function wakeWaitingSessionInTx(
  tx: Tx,
  sessionId: string,
  /** 지금 닫히는 결재 — 남은 대기로 세지 않는다 */
  closedApprovalIds: readonly string[],
): Promise<void> {
  await tx.execute(sql`
    UPDATE agent_session SET state = 'active'
     WHERE id = ${sessionId}
       AND state = 'awaiting_input'
       AND NOT EXISTS (
         SELECT 1 FROM question q
          WHERE q.agent_session_id = ${sessionId}
            AND q.status = 'open' AND q.urgency = 'blocking'
       )
       AND NOT EXISTS (
         SELECT 1 FROM approval a2
          WHERE a2.requested_by_session_id = ${sessionId}
            AND a2.id <> ALL(${sqlArray(closedApprovalIds, 'uuid')})
            AND ${holdsSessionSql()}
       )
  `);
}
