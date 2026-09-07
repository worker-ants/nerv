// 표시 형식 — 화면 여러 곳이 같은 규약을 쓰도록 한곳에 모은다.
//
// **하트비트·알림은 상대 시각만** 쓴다(ui-wireframes §3.3). 절대 시각은 시간대·시계 오차로
// 오독을 만든다 — 에이전트가 다른 장비에서 도는 이 플랫폼에서는 특히 그렇다.
//
// 번역기를 인자로 받는다. 여기서 로케일을 직접 읽으면 이 함수는 React 밖에서 못 쓰고,
// 테스트도 로케일을 갈아끼우지 못한다 — 시간 표기는 순수 함수로 두는 편이 낫다.

import { blockedReasonLabelKey, isBlockedReason } from '@nerv/schema';
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

/**
 * 막힘 사유를 **사람 말로**(2026-09-07 · REQ-WEB-143).
 *
 * 두 화면이 각자 틀리고 있었다. 보드 카드는 식별자를 그대로 찍어 `awaiting_answer` 라
 * 적었고 — 그것은 코드의 이름이지 사람의 말이 아니다 — 상세는 반대로 **어휘 밖의 값에도**
 * 문구 키를 만들어 붙여, 2026-09-06 이전에 저장된 자유 텍스트 사유가 `blocked.…` 라는
 * 키 문자열로 화면에 새어 나왔다(번역기의 마지막 폴백은 키 자체다).
 *
 * 규칙은 하나다 — **어휘면 라벨, 어휘 밖이면 원문 그대로.** 사람이 적어 둔 사유가 있는데
 * 그것을 못 보게 하는 것이 둘 중 더 나쁘고, 어느 쪽이든 화면에 키가 뜨는 일은 없다.
 * 어휘 판정의 정본은 `@nerv/schema` 의 `isBlockedReason()` 이다(REQ-CB-006).
 */
export function blockedReasonText(t: Translator, value: unknown): string {
  if (isBlockedReason(value)) return t(blockedReasonLabelKey(value));
  return typeof value === 'string' ? value : '';
}
