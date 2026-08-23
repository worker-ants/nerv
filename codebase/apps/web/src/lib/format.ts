// 표시 형식 — 화면 여러 곳이 같은 규약을 쓰도록 한곳에 모은다.
//
// **하트비트·알림은 상대 시각만** 쓴다(ui-wireframes §3.3). 절대 시각은 시간대·시계 오차로
// 오독을 만든다 — 에이전트가 다른 장비에서 도는 이 플랫폼에서는 특히 그렇다.

/** "12초 전" · "3분 전" · "2시간 전" */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (iso === null) return '기록 없음';
  const elapsed = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (elapsed < 60) return `${elapsed}초 전`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}분 전`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)}시간 전`;
  return `${Math.floor(elapsed / 86_400)}일 전`;
}

/** 값이 없을 때 빈 문자열 대신 — 자리가 비면 표가 어긋나 보인다 */
export const DASH = '—';
