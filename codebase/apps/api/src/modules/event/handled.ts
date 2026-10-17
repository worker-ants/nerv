// 알림을 만들 때 · 다른 채널로 보낼 때 그 일이 **이미 처리됐는가** — 한 판정을 두 곳이 쓴다(2026-10-17)
//
// 알림 파생(`NotificationService.route`)은 이미 처리된 일의 알림을 읽은 채로 만들고(REQ-API-176 · 316 · 352), Slack 발신
// (`SlackJob`)은 보내기 직전에 같은 것을 물어 처리된 일은 보내지 않는다 — 크로스 채널 dedup(spec-workflow §6.4). 두 곳이
// 각자 판정하면 한쪽에만 새 경우가 더해진다. 예전에는 발견의 판정이 알림 서비스의 비공개 메서드였다.
import { NERV_EVENT_PHASE2 } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';
import { requestAlreadyClosed } from './request-notifications.js';
import { staleSessionRevived } from './session-notifications.js';

/** 이미 처분된 발견의 「열림」 — 파생보다 처분이 먼저면 알릴 일이 끝났다(REQ-API-316) */
export async function findingAlreadyClosed(
  db: Pick<NervDb, 'execute'>,
  event: { type: string; subject_id: string },
): Promise<boolean> {
  if (event.type !== NERV_EVENT_PHASE2.FINDING_OPENED) return false;
  const { rows } = await db.execute<{ closed: boolean }>(
    sql`SELECT (status <> 'open') AS closed FROM finding WHERE id = ${event.subject_id}`,
  );
  return rows[0]?.closed === true;
}

/** 닫힌 요청 · 처분된 발견 · 되살아난 세션 — 셋 중 하나면 그 이벤트로 사람을 부를 일이 없다 */
export async function alreadyHandled(
  db: Pick<NervDb, 'execute'>,
  event: { type: string; subject_id: string },
): Promise<boolean> {
  return (
    (await requestAlreadyClosed(db, event)) ||
    (await findingAlreadyClosed(db, event)) ||
    (await staleSessionRevived(db, event))
  );
}
