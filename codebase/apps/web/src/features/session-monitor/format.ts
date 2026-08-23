// 세션 카드의 표기 규약 — 정본: ui-wireframes §3.3 · screens.md §2.6
//
// 두 가지가 규약이다.
//   ① **하트비트는 상대 시각만** 쓴다. 절대 시각은 시간대·시계 오차로 오독을 만든다
//   ② 리스 잔여 카운트다운은 **클라이언트 시계**가 한다 — 서버는 남은 초를 한 번 주고,
//      매초 묻지 않는다(screens.md §1.4 말미)

// 상대 시각은 세션 카드만 쓰는 규약이 아니다(알림·작업 목록도 같은 표기를 쓴다) —
// 정의는 lib/format 에 있고 여기서는 이 모듈의 소비자를 위해 다시 내보낸다.
export { relativeTime } from '../../lib/format.js';

/** 리스 잔여 "mm:ss" — 만료면 "만료" */
export function leaseRemaining(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds <= 0) return '만료';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** diff 통계 "+218 −34" (§3.3) */
export function diffStat(added: number, removed: number): string {
  return `+${added} −${removed}`;
}

/**
 * 신원 3요소 — `도현 · mac-02 · claude-code`.
 * 좁은 화면은 `mac-02/claude-code` 로 줄이고 hostname 은 고정폭으로 쓴다(§3.3).
 */
export function identity(
  card: { user_name: string; hostname: string; agent_type: string },
  compact = false,
): string {
  return compact
    ? `${card.hostname}/${card.agent_type}`
    : `${card.user_name} · ${card.hostname} · ${card.agent_type}`;
}
