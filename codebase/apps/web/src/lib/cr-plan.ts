// 변경 요청을 승인하면 함께 할 일 — 한 줄 문구 (2026-10-16 사람 결정 · screens.md REQ-WEB-321 · api.md REQ-API-351)
//
// 받은 요청의 CR 카드와 스펙 화면의 [바로 승인] 창이 같은 문장을 쓴다. 승인한 **뒤**의 토스트도 여기서 한 문장을 만든다
// (2026-10-17 사람 결정 · REQ-WEB-339) — 무엇을 할지 보인 자리와 무엇을 했는지 알리는 자리가 같은 말을 쓴다. 두 곳이 따로 쓰면 "카드는 기본값을 말하는데 창은
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

/**
 * **승인이 한 일**(2026-10-17 사람 결정 · REQ-WEB-339 · api.md REQ-API-359). 승인 응답의 `change_request`(한 건 결정 · 바로 승인)나
 * 일괄 응답의 항목마다의 `change_request` 를 모은 것이다. 변경 요청을 확정한 승인이 하나도 없으면 null 이다 — 그때 토스트는
 * 예전 문장 그대로다.
 */
export interface CrOutcomeSum {
  /** 확정한 변경 요청의 수 */
  crs: number;
  created: number;
  archived: number;
  /** 그 가운데 고른 것이 없어 기본값을 적용한 것이 있는가 */
  defaulted: boolean;
}

/** 응답 하나 · 여럿의 `change_request` 를 모은다 — 칸이 없는 것(변경 요청이 아닌 승인 · 실패한 항목)은 건너뛴다 */
export function crOutcomeSum(results: readonly unknown[]): CrOutcomeSum | null {
  const outcomes = results.flatMap((result) => {
    const cr = (result as Row | null)?.['change_request'];
    return cr !== null && typeof cr === 'object' ? [cr as Row] : [];
  });
  if (outcomes.length === 0) return null;
  return {
    crs: outcomes.length,
    created: outcomes.reduce((n, cr) => n + count(cr['created_tasks']), 0),
    archived: outcomes.reduce((n, cr) => n + count(cr['archived_tasks']), 0),
    defaulted: outcomes.some((cr) => cr['actions_source'] === 'default'),
  };
}

/** 토스트에 붙이는 한 문장 — 만든 작업 수(0 이어도 적는다), 보관했으면 그 수, 기본값이었으면 그 사실 */
export function crOutcomeText(t: Translator, sum: CrOutcomeSum): string {
  const parts = [t('cr.result.created', { n: sum.created })];
  if (sum.archived > 0) parts.push(t('cr.result.archived', { n: sum.archived }));
  if (sum.defaulted) parts.push(t('cr.result.default'));
  return parts.join(' ');
}

/** 토스트 문장 끝에 붙인다 — 변경 요청이 아니면 그대로다 */
export function withCrOutcome(t: Translator, message: string, results: readonly unknown[]): string {
  const sum = crOutcomeSum(results);
  return sum === null ? message : `${message} ${crOutcomeText(t, sum)}`;
}
