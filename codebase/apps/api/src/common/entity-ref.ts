// 식별자 참조 — **키와 UUID 를 둘 다 받는다** (api.md §1.4b)
//
// 도구마다 기준이 달랐다: `nerv_spec_get` 의 `spec_id` 는 키(`SPC-CWC-007`)를 받고
// `nerv_spec_draft_upsert` 의 `spec_id` 는 UUID 를 받았다. 같은 이름이 다른 것을 뜻하면
// 에이전트는 **실패로 배운다** — 실제로 그랬다(실측 2026-08-29: 한 세션이 `spec get` 두 번,
// `draft upsert` 한 번을 틀리고 나서야 "upsert 는 UUID 를 받는군요"라고 적었다).
//
// 더 나쁜 것은 `nerv_spec_get` 이 **자기 출력을 자기 입력에 못 넣는다**는 것이었다: 입력은
// 키인데 응답의 `spec_id` 는 UUID다.
//
// 그래서 규칙을 하나로 만든다. **참조는 키든 UUID 든 받는다.** 사람과 로그와 화면이 쓰는
// 것은 키이므로 키가 정본이고, UUID 는 내부 식별자다 — 어느 쪽을 받아도 같은 것을 가리키면
// 그것으로 충분하다.

/** UUID(v4·v7 등 버전 무관) 모양인가 — 값의 **형태**로 가른다. */
export function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export interface EntityRef {
  /** UUID 로 보이면 그 값 — 아니면 null */
  id: string | null;
  /** UUID 가 아니면 그 값(고정 ID) — UUID 면 null */
  key: string | null;
}

/**
 * 문자열 하나를 참조로 읽는다.
 *
 * 빈 문자열은 "안 준 것"이라 둘 다 null 이다 — 호출한 쪽이 필수 여부를 정한다.
 */
export function entityRef(value: string | undefined | null): EntityRef {
  const raw = (value ?? '').trim();
  if (raw === '') return { id: null, key: null };
  return looksLikeUuid(raw) ? { id: raw, key: null } : { id: null, key: raw };
}
