// 버전 기준 — 목록 · 트리 · 표 · 그래프 · 상세 · 검색이 문서마다 **어느 버전을 읽는가**
// (2026-09-27 사람 결정 · REQ-WEB-248 · 서버 REQ-API-193~196)
//
// 주소의 두 인자를 하나의 값으로 읽는다: `?baseline=<이름>`(기준선) · `?basis=latest`(최신).
// 둘 다 없으면 승인본(기본)이고, 기본은 주소에 남기지 않는다(REQ-WEB-163 의 규칙). 둘은 배타라
// 기준선이 있으면 `basis` 는 버린다 — 서버도 함께 받지 않는다(REQ-API-196).

import type { SpecViewBasis } from '@nerv/schema';

export interface ViewBasis {
  /** 기준선 이름 — 있으면 그 세트가 묶은 버전을 읽는다 */
  baseline?: string | undefined;
  /** 최신 — 문서마다 번호가 가장 큰 버전(승인본 위의 초안 · 검토 중 포함) */
  latest?: boolean | undefined;
}

const LATEST: Extract<SpecViewBasis, 'latest'> = 'latest';

/** 주소 → 버전 기준. 모르는 값은 버린다(기본으로 읽는다) */
export function readViewBasis(search: Record<string, unknown>): ViewBasis {
  const baseline = search['baseline'];
  if (typeof baseline === 'string' && baseline !== '') return { baseline };
  return search['basis'] === LATEST ? { latest: true } : {};
}

/** 버전 기준 → 주소 인자. 링크가 이것을 넘겨 문서를 옮겨도 기준이 유지된다 */
export function viewBasisSearch(view: ViewBasis): { baseline?: string; basis?: 'latest' } {
  if (view.baseline !== undefined && view.baseline !== '') return { baseline: view.baseline };
  return view.latest === true ? { basis: LATEST } : {};
}

/** 버전 기준 → API 질의(`&baseline=…` · `&basis=latest`) — 앞에 `&` 를 붙여 돌려준다 */
export function viewBasisQuery(view: ViewBasis): string {
  const search = viewBasisSearch(view);
  if (search.baseline !== undefined) return `&baseline=${encodeURIComponent(search.baseline)}`;
  return search.basis === undefined ? '' : `&basis=${search.basis}`;
}

/** 캐시 키의 한 칸 — 기준이 다르면 **다른 목록 · 다른 버전**이라 키가 달라야 한다 */
export function viewBasisKey(view: ViewBasis): string {
  const search = viewBasisSearch(view);
  if (search.baseline !== undefined) return `baseline:${search.baseline}`;
  return search.basis ?? '';
}

/** 캐시 키의 칸 → 버전 기준(`viewBasisKey` 의 역) — 문자열로 고른 값을 다시 펼칠 때 쓴다 */
export function viewBasisFromKey(key: string): ViewBasis {
  if (key.startsWith('baseline:')) return { baseline: key.slice('baseline:'.length) };
  return key === LATEST ? { latest: true } : {};
}

/** 기본(승인본)인가 */
export function isApprovedBasis(view: ViewBasis): boolean {
  return viewBasisKey(view) === '';
}

/**
 * **승인본 위에 새 버전이 진행 중인가**(REQ-WEB-249) — 가장 새 버전이 초안 · 검토 중이고 최신
 * 승인본보다 번호가 크다. 기준과 상관없이 서버가 줄마다 주는 세 값으로 판정한다(REQ-API-194).
 * 승인된 적 없는 문서는 여기 들지 않는다 — 그 문서는 이미 초안으로 보인다.
 */
export function hasNewerVersion(node: {
  latest_version_no?: number | null;
  latest_status?: string | null;
  approved_version_no?: number | null;
}): boolean {
  return (
    node.approved_version_no != null &&
    node.latest_version_no != null &&
    node.latest_version_no > node.approved_version_no &&
    (node.latest_status === 'draft' || node.latest_status === 'in_review')
  );
}

/** 상태 필터의 특별한 값 — "승인본 위에 새 버전이 진행 중인 문서"(REQ-WEB-249) */
export const NEWER_STATUS = 'newer';
