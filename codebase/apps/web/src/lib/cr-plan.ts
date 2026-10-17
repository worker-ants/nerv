// 변경 요청을 승인하면 함께 할 일 — 한 줄 문구 (2026-10-16 사람 결정 · screens.md REQ-WEB-321 · api.md REQ-API-351)
//
// 받은 요청의 CR 카드와 스펙 화면의 [바로 승인] 창이 같은 문장을 쓴다. 두 곳이 따로 쓰면 "카드는 기본값을 말하는데 창은
// 골라 둔 것만 한다고 말한다" 같은 어긋남이 생긴다. 수는 서버가 센 값이다 — 기본값이 무엇인지(파생 · 재검증은 만들고 보관은
// 하지 않는다)도 서버가 정하고 화면은 그 수를 옮긴다.

import type { Translator } from '@nerv/schema';
import type { Row } from './queries.js';

/** 승인하면 할 일 — `chosen` 이 거짓이면 수는 기본값이다(아무도 고르지 않았다) */
export interface CrPlan {
  chosen: boolean;
  derive: number;
  reverify: number;
  cancel: number;
  /** 보관 제안의 수 — 기본값에 들지 않아 고르려면 CR 화면으로 간다 */
  cancelSuggestions: number;
}

const count = (value: unknown): number =>
  Array.isArray(value) ? value.length : typeof value === 'number' ? value : 0;

/** 받은 요청 카드(EP-APR-01 의 `cr_planned` · `cr_impact`)에서 */
export function crPlanOfCard(card: Row): CrPlan | null {
  const planned = (card['cr_planned'] ?? null) as Row | null;
  if (planned === null) return null;
  const impact = (card['cr_impact'] ?? {}) as Row;
  return {
    // 칸이 없으면(옛 응답) 예전처럼 골라 둔 것으로 읽는다
    chosen: planned['chosen'] !== false,
    derive: count(planned['derive']),
    reverify: count(planned['reverify']),
    cancel: count(planned['cancel']),
    cancelSuggestions: count(impact['cancel_suggestions']),
  };
}

/** CR 단건(EP-CR-02 의 `planned_actions` · `impact.suggestions`)에서 — `planned_actions` 가 null 이면 기본값이다 */
export function crPlanOfDetail(cr: Row): CrPlan {
  const planned = (cr['planned_actions'] ?? null) as Row | null;
  const suggestions = ((cr['impact'] as Row | undefined)?.['suggestions'] ?? {}) as Row;
  const cancelSuggestions = count(suggestions['cancel']);
  if (planned === null) {
    return {
      chosen: false,
      derive: count(suggestions['derive']),
      reverify: count(suggestions['reverify']),
      cancel: 0,
      cancelSuggestions,
    };
  }
  return {
    chosen: true,
    derive: count(planned['derive']),
    reverify: count(planned['reverify']),
    cancel: count(planned['cancel']),
    cancelSuggestions,
  };
}

/**
 * 한 줄 — 골라 둔 것이 있으면 그것(빈 선택이면 "아무것도 하지 않기로"), 없으면 기본값의 수. 기본값에 들지 않는 보관 제안이
 * 있으면 그것은 CR 화면에서 고른다는 말을 붙인다
 */
export function crPlanText(t: Translator, plan: CrPlan): string {
  const create = plan.derive + plan.reverify;
  if (plan.chosen) {
    return create + plan.cancel > 0
      ? t('inbox.card.cr_planned', { create, cancel: plan.cancel })
      : t('inbox.card.cr_chosen_none');
  }
  const parts: string[] = [];
  if (create > 0) {
    parts.push(t('inbox.card.cr_default', { derive: plan.derive, reverify: plan.reverify }));
  }
  if (plan.cancelSuggestions > 0) {
    parts.push(t('inbox.card.cr_unplanned', { n: plan.cancelSuggestions }));
  }
  return parts.length === 0 ? t('inbox.card.cr_no_suggestions') : parts.join(' ');
}
