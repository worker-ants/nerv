// NERV_* 에러 코드 — 정본: docs/03-proposal/agent-integration.md §2.7 (봉투·의미)
//                     docs/04-mvp/api.md §1.4 (HTTP 상태 매핑)
//
// REST 와 MCP 가 **같은 코드 체계**를 쓴다 — REST 전용 코드를 신설하지 않는다.
// HTTP 상태 매핑 구현(nerv-exception.filter.ts)과 구조화 에러 봉투는 E03-S04 소관이고,
// 이 파일은 코드 어휘의 선언만 갖는다(REQ-CB-006 이 참조하는 정본).

export const NERV_ERROR = {
  /** 세션 쿠키 없음·만료, PAT 폐기·만료 → 401 */
  UNAUTHENTICATED: 'NERV_UNAUTHENTICATED',
  /** 역할 미충족, PAT 권한 부족, 지시자≠승인자 위반 → 403 */
  FORBIDDEN: 'NERV_FORBIDDEN',
  /** zod 스키마 위반 → 400 / 본문 지문 불일치·게이트 미충족·멱등 키 본문 불일치 → 409 */
  PRECONDITION: 'NERV_PRECONDITION',
  /** 클레임 scope 겹침 block 판정 → 409 */
  CONFLICT_SCOPE: 'NERV_CONFLICT_SCOPE',
  /** 리스 만료 후 상태 변경 시도 → 409 */
  LEASE_EXPIRED: 'NERV_LEASE_EXPIRED',
  /** 다른 사용자가 초안 편집 리스 보유 → 409 */
  DRAFT_LEASED: 'NERV_DRAFT_LEASED',
  /** A3 액션이 pending Approval 을 만들고 대기 진입 → 202 */
  APPROVAL_REQUIRED: 'NERV_APPROVAL_REQUIRED',
  /** A4(사람 전용) 액션 요청 → 403, details.web_url 딥링크 동반 */
  HUMAN_ONLY: 'NERV_HUMAN_ONLY',
  /** 쿼터 초과 → 429, retry_after_s + Retry-After 헤더 병행 */
  RATE_LIMIT: 'NERV_RATE_LIMIT',
  /** 의존 구성요소 장애 → 503 */
  UNAVAILABLE: 'NERV_UNAVAILABLE',
} as const;

export type NervErrorCode = (typeof NERV_ERROR)[keyof typeof NERV_ERROR];

export const NERV_ERROR_CODES = Object.values(NERV_ERROR) as readonly NervErrorCode[];
