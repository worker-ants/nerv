// 헤딩 → 앵커 slug — **서버와 화면이 같은 함수를 쓴다** (D-09 · screens.md §3.3)
//
// 코멘트 앵커 · 사전 검토 지적의 앵커 · 검색 결과의 앵커 · 본문 링크의 `#…` 가 모두 이 규약이다.
// 2026-09-24 까지는 서버(`embedding.service.ts`)에만 있어서, 화면은 앵커를 **글자로만** 보였고
// 누를 수 없었다 — 같은 규약을 두 곳에 적으면 한쪽만 고쳐지는 날 앵커가 어디로도 가지 않는다
// (UI/UX 검토 SPEC-05 · REQ-WEB-215).

/** 헤딩 글자 → slug. 대소문자를 접고, 강조·코드 표기를 벗기고, 빈칸을 `-` 로 잇는다. */
export function headingSlug(heading: string): string {
  return (
    heading
      .toLowerCase()
      // `_` 는 지우지 않는다 — 이 저장소의 헤딩에는 `nerv_spec_get` 같은 식별자가 흔하고,
      // 밑줄을 지우면 앵커가 원문에 없는 문자열이 된다(강조 표기보다 식별자가 우선이다).
      .replace(/[`*~[\]()]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  );
}
