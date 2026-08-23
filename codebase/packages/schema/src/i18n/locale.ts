// 로케일 — 정본: docs/04-mvp/codebase.md §3.4
//
// 기본값이 한국어인 이유는 취향이 아니라 **폴백 규칙** 때문이다. 카탈로그의 원본이 ko 이고
// (문구를 처음 쓰는 곳이 거기다), 다른 로케일은 그 키 집합을 타입으로 강제받는다.
// 그래서 "번역이 없는 키"라는 상태가 존재할 수 없다 — 컴파일이 먼저 막는다.

export const LOCALES = ['ko', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ko';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * `Accept-Language` 협상. 표면 셋이 같은 규칙을 써야 한다 —
 * 웹이 `ko-KR` 을 보내는데 API 가 `ko` 만 알아들으면 화면 절반이 영어로 남는다.
 *
 * q 값을 존중하되(`en;q=0.9, ko;q=0.8` 이면 en), 아는 로케일이 하나도 없으면 기본값이다.
 * `ko-KR` 처럼 지역이 붙은 태그는 앞쪽 서브태그로 떨어뜨려 맞춘다.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (typeof header !== 'string' || header.trim() === '') return DEFAULT_LOCALE;

  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...rest] = part.trim().split(';');
      const q = rest.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)).find((m) => m !== null)?.[1];
      return {
        tag: tag.trim().toLowerCase(),
        // q 가 없으면 1.0. 같은 q 끼리는 헤더에 적힌 순서를 지킨다
        q: q === undefined ? 1 : Number.parseFloat(q),
        index,
      };
    })
    .filter((entry) => entry.tag !== '' && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => (b.q === a.q ? a.index - b.index : b.q - a.q));

  for (const { tag } of ranked) {
    if (tag === '*') return DEFAULT_LOCALE;
    const base = tag.split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
