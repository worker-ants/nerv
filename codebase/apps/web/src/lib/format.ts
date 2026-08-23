// 표시 형식 — 화면 여러 곳이 같은 규약을 쓰도록 한곳에 모은다.
//
// **하트비트·알림은 상대 시각만** 쓴다(ui-wireframes §3.3). 절대 시각은 시간대·시계 오차로
// 오독을 만든다 — 에이전트가 다른 장비에서 도는 이 플랫폼에서는 특히 그렇다.
//
// 번역기를 인자로 받는다. 여기서 로케일을 직접 읽으면 이 함수는 React 밖에서 못 쓰고,
// 테스트도 로케일을 갈아끼우지 못한다 — 시간 표기는 순수 함수로 두는 편이 낫다.

import type { Translator } from '@nerv/schema';

/** "12초 전" · "3분 전" · "2시간 전" */
export function relativeTime(t: Translator, iso: string | null, now = Date.now()): string {
  if (iso === null) return t('time.never');
  const elapsed = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (elapsed < 60) return t('time.seconds_ago', { n: elapsed });
  if (elapsed < 3600) return t('time.minutes_ago', { n: Math.floor(elapsed / 60) });
  if (elapsed < 86_400) return t('time.hours_ago', { n: Math.floor(elapsed / 3600) });
  return t('time.days_ago', { n: Math.floor(elapsed / 86_400) });
}

/** 값이 없을 때 빈 문자열 대신 — 자리가 비면 표가 어긋나 보인다 */
export const DASH = '—';
