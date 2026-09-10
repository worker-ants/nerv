// 매뉴얼 장의 **id 만** — 본문 없이 목록이 필요한 곳을 위한 자리 (screens.md §2.10)
//
// `manual.ts` 는 장마다 md 본문을 `?raw` 로 물고 있다(로케일 둘 × 열 장). 그래서 그 파일을
// import 하는 것은 **매뉴얼 전문을 그 청크로 끌고 오는 일**이다 — `/help` 라우트에는 맞는
// 값이지만, "이 문자열이 장 id 인가" 하나를 묻는 자리에는 너무 비싸다.
//
// 목록을 여기 두고 `manual.ts` 가 그것을 쓰면 **정본은 하나인 채로** 본문 없이 물을 수 있다.
// 순서도 여기가 정한다 — 읽는 순서이자 이전·다음 링크의 순서다.

export const MANUAL_CHAPTER_IDS = [
  'start',
  'specs',
  'tasks',
  'sessions',
  'reviews',
  'inbox',
  'agents',
  'install',
  'settings',
  'shortcuts',
] as const;

export type ManualChapterId = (typeof MANUAL_CHAPTER_IDS)[number];

/**
 * 이 문자열이 매뉴얼의 장인가 — `user_guide` 증적이 갈 곳을 정할 때 쓴다(REQ-WEB-161).
 *
 * **짐작이 아니라 대조다.** 저장소마다 모양이 다른 테스트 이름과 달리 장 이름은 이 목록이
 * 정본이므로, 맞는 것만 링크로 만들고 나머지는 글자로 둔다.
 */
export function isManualChapter(value: string): value is ManualChapterId {
  return (MANUAL_CHAPTER_IDS as readonly string[]).includes(value);
}
