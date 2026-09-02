// 편집의 기준 지문 — 무엇을 보고 썼는가 (api.md §1.4g · REQ-API-006)
//
// 규칙 자체는 한 줄인데 그 한 줄을 틀리면 낙관적 동시성이 통째로 무력해진다. 그래서
// 화면 컴포넌트 안이 아니라 여기에 둔다 — 함수로 있으면 테스트가 규칙을 직접 본다.
//
// **실제로 있었던 결함**: 첫 저장 전까지 라이브 쿼리의 `content_hash` 를 기준으로 보냈다.
// 그 쿼리는 `spec.draft_updated` 로 무효화·재조회되므로 남이 같은 초안을 저장하면 내
// 기준이 **상대의 새 지문으로 갱신된다.** 내 화면의 본문은 옛 내용 그대로인데 다음 저장은
// 최신 지문을 실어 보내 서버의 비교-교환을 통과한다 — §1.4g 가 막으려던 "두 편집자 중
// 한쪽 글이 사라지는" 일이 그 자리에서 재현됐다. 서버는 받은 지문대로 정확히 판정했다;
// 틀린 것은 **무엇을 보낼지 고르는 쪽**이었다.

export interface EditBasis {
  /** 내 저장이 성공해 받은 새 지문(있으면 이것이 가장 최신의 내 기준이다) */
  saved: string | null;
  /** 문서를 연 시점의 지문 — 재조회가 이 값을 밀어내지 않는다 */
  opened: string | null;
  /** 라이브 쿼리의 현재 지문 */
  live: string | null;
}

/**
 * 저장이 실어 보낼 기준 지문.
 *
 * 우선순위: 내가 방금 저장한 값 → 내가 연 값 → (아직 아무것도 모르면) 라이브 값.
 * 라이브 값이 마지막인 것이 요점이다 — 그 값은 남의 저장으로 바뀔 수 있다.
 */
export function baseHashFor(basis: EditBasis): string | null {
  return basis.saved ?? basis.opened ?? basis.live;
}

/**
 * 내가 연 뒤로 남이 저장했는가.
 *
 * 편집 중일 때만 뜻이 있다 — 읽고만 있으면 최신을 보는 것이 정상이고 알릴 일이 아니다.
 * 참이면 지금 저장은 409 로 막힌다. 막히기 전에 말해 주는 것이 이 값의 용도다.
 */
export function changedByOthers(input: {
  editing: boolean;
  opened: string | null;
  live: string | null;
}): boolean {
  if (!input.editing || input.opened === null || input.live === null) return false;
  return input.opened !== input.live;
}
