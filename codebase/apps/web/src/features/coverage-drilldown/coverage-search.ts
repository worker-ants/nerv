// 구현 현황 드릴다운의 뷰 상태 — **주소에 있다**(screens.md §2.3a · REQ-WEB-315)
//
// 영역 → 문서 → 요구사항으로 내려간 자리와 건 거르기, 펼친 요구사항을 주소에 둔다. 커버리지 숫자를 누른 사람이 그 자리를
// 링크로 건넬 수 있어야 하고(D-09), 문서에 들어갔다가 뒤로 돌아오면 보던 자리가 그대로여야 한다.

/**
 * 거르기 넷 — 커버리지 산식의 증적 결손 · 빈 약속(spec-workflow §5.5)과 다시 검증 필요, 그리고 임포트 값.
 * 이름은 서버의 수와 같은 축이다: 거르는 판정은 서버가 행마다 준 표시이고 화면은 다시 판정하지 않는다(D-05).
 */
export const COVERAGE_FILTERS = [
  'evidence_missing',
  'empty_promises',
  'reverify',
  'import',
] as const;
export type CoverageFilter = (typeof COVERAGE_FILTERS)[number];

/** 영역에 들지 않은 스펙의 무리 — 영역 키가 없어서 주소에는 이 표시를 쓴다 */
export const NO_AREA = '-';

export interface CoverageSearch {
  /** 영역 문서의 키 · 영역 밖이면 `NO_AREA` */
  area?: string;
  /** 문서 키 — 이것이 있으면 요구사항 단계다 */
  spec?: string;
  filter?: CoverageFilter;
  /** 펼친 요구사항의 고정 ID */
  req?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export function validateCoverageSearch(search: Record<string, unknown>): CoverageSearch {
  const area = text(search['area']);
  const spec = text(search['spec']);
  const req = text(search['req']);
  const filter = text(search['filter']);
  return {
    ...(area === undefined ? {} : { area }),
    ...(spec === undefined ? {} : { spec }),
    // 어휘 밖 값은 버린다 — 거르지 않은 목록이 "아무것도 없다" 로 보이지 않게
    ...((COVERAGE_FILTERS as readonly string[]).includes(filter ?? '')
      ? { filter: filter as CoverageFilter }
      : {}),
    ...(req === undefined ? {} : { req }),
  };
}

/** 영역 · 문서 줄이 그 거르기로 몇 건인가 — 서버의 수(EP-COV-01)를 그대로 읽는다 */
export const FILTER_COUNT_FIELD: Record<CoverageFilter, string> = {
  evidence_missing: 'evidence_missing',
  empty_promises: 'empty_promises',
  reverify: 'reverify_required',
  import: 'imported_values',
};

/** 요구사항 줄이 그 거르기에 드는가 — 서버가 행마다 준 표시(EP-REQ-01 · REQ-API-312 · 313)만 읽는다 */
export function matchesFilter(row: Record<string, unknown>, filter: CoverageFilter): boolean {
  switch (filter) {
    case 'evidence_missing':
      return row['evidence_missing'] === true;
    case 'empty_promises':
      return row['empty_promise'] === true;
    case 'reverify':
      return row['reverify_required'] === true;
    case 'import':
      return row['impl_status_source'] === 'import';
  }
}
