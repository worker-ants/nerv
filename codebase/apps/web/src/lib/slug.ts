// 이름 → slug · key — **한 규칙**이다 (settings/projects · 조직 만들기 폼)
//
// 조직을 만드는 폼과 프로젝트를 만드는 폼이 같은 변환을 각자 적고 있었다. 첫 프로젝트를 조직과
// 함께 만들게 되면서(2026-09-24 · REQ-WEB-205) 세 자리가 됐다 — 규칙이 둘이 되는 순간 한쪽만
// 고쳐진다.
//
// **기본값을 줄 뿐 확정하지 않는다.** 한글만 적으면 ASCII 규칙에서 빈 값이 나오는데, slug 는
// 주소와 API 경로의 축(D-09)이라 기계가 뭉갠 값을 조용히 확정하면 나중에 되돌릴 수 없다.

/** `"Clemvion 본편"` → `"clemvion"` — 소문자·숫자·하이픈만 남긴다(빈 값일 수 있다) */
export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** `"clemvion-web"` → `"CLE"` — 표시 키의 머리(`<KEY>-T-…`)다 */
export function projectKeyFromSlug(slug: string): string {
  return slug.replace(/-/g, '').slice(0, 3).toUpperCase();
}
