// 본문 안의 자리 — 헤딩·앵커·줄 (screens.md §2.4 · §3.3 · REQ-WEB-215)
//
// 긴 스펙(clemvion `data-model` 50,685px — 화면 56장)을 읽는 사람은 스크롤바 말고는 절 사이를 오갈
// 수단이 없었다. 헤딩에 id 가 없어 스킬이 권하는 `…/SUD-AREA-PLAY#3` 링크는 문서 머리에 떨어졌고,
// 사전 검토 지적과 코멘트의 앵커는 글자일 뿐 눌리지 않았다(2026-09-24 UI/UX 검토 SPEC-05).
//
// **헤딩에 id 를 박지 않는다.** 본문 DOM 은 ProseMirror 의 것이라 밖에서 속성을 쓰면 그것이 되돌리거나
// 문서를 다시 읽는다. 대신 md 의 헤딩 **순서**가 화면의 헤딩 순서와 같다는 사실을 쓴다 — 앵커를
// md 에서 몇 번째 헤딩인지로 풀고, 그 번째 헤딩 요소로 스크롤한다. slug 는 서버와 같은 함수다.

import { headingSlug } from '@nerv/schema';

export interface MdHeading {
  level: number;
  text: string;
  slug: string;
}

/** md 의 ATX 헤딩 — 코드 울타리 안의 `#` 는 헤딩이 아니다 */
export function markdownHeadings(md: string): MdHeading[] {
  const out: MdHeading[] = [];
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker !== null) {
      const kind = marker[1]![0]!;
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      const text = heading[2] ?? '';
      out.push({ level: heading[1]!.length, text, slug: headingSlug(text) });
    }
  }
  return out;
}

/**
 * **본문 첫 줄의 제목을 뷰어에서만 뺀다**(OBS-04). 스펙은 머리에 고정 제목을 두는데 본문도 대개
 * `# 같은 제목` 으로 시작해, 첫 화면 위쪽에 같은 제목이 크기만 달리해 두 번 섰다. 소스 탭과 md
 * 원본은 그대로다 — 제목이 다르면 아무것도 빼지 않는다.
 */
export function dropLeadingTitle(md: string, title: string): string {
  const match = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(md);
  if (match === null) return md;
  const norm = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(match[1] ?? '') === norm(title) ? md.slice(match[0].length) : md;
}

/**
 * 앵커 → 몇 번째 헤딩인가(없으면 -1).
 *
 * slug 가 맞으면 그것이다. 숫자만 온 앵커(`#3` · `#3.2` · `#§3`)는 **절 번호**로 읽는다 — 스킬이
 * `[게임플레이 §3](…#3)` 을 권하고, 사람이 절을 번호로 부르는 것은 흔하다. 그 번호로 시작하는
 * 첫 헤딩이 답이다.
 */
export function headingIndex(headings: readonly MdHeading[], anchor: string): number {
  let raw = anchor.replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 잘못된 인코딩은 적힌 그대로 본다
  }
  if (raw === '') return -1;
  const bySlug = headings.findIndex((h) => h.slug === raw || h.slug === headingSlug(raw));
  if (bySlug >= 0) return bySlug;
  const numbered = /^§?\s*(\d+(?:\.\d+)*)\.?$/.exec(raw);
  if (numbered === null) return -1;
  const no = numbered[1]!;
  return headings.findIndex((h) => {
    const text = h.text.replace(/^§\s*/, '').trim();
    return text === no || text.startsWith(`${no}.`) || text.startsWith(`${no} `);
  });
}

/** 앵커가 가리키는 헤딩 요소 — 본문 뷰어(`root`) 안의 그 번째 헤딩 */
export function headingElement(
  root: ParentNode | null,
  headings: readonly MdHeading[],
  anchor: string,
): HTMLElement | null {
  if (root === null) return null;
  const index = headingIndex(headings, anchor);
  if (index < 0) return null;
  return (
    (root.querySelectorAll('h1, h2, h3, h4, h5, h6')[index] as HTMLElement | undefined) ?? null
  );
}
