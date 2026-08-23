// 번역기 — 정본: docs/04-mvp/codebase.md §3.4
//
// 이 파일이 가진 것은 두 가지뿐이다: **자리표시자 치환**과 **타입**.
// 그 이상(지연 로드·네임스페이스·백엔드 플러그인)은 넣지 않는다 — 카탈로그가 두 개뿐이고
// 표면이 셋(웹·API·CLI)이라, 표면마다 다른 초기화가 필요한 물건이 오히려 비용이다.
//
// 타입이 하는 일이 핵심이다. 문구 안의 `{name}` 을 타입 수준에서 뽑아내므로
// `t('error.conflict_scope')` 처럼 인자를 빠뜨리면 **컴파일이 막는다**. 런타임에
// `{key}` 가 그대로 찍히는 사고는 이 프로젝트에 존재할 수 없다.

import { DEFAULT_LOCALE } from './locale.js';
import type { Locale } from './locale.js';

/** 문구에서 `{자리표시자}` 이름만 뽑는다 */
export type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never;

export type PlaceholderValues = Record<string, string | number>;

/** 자리표시자가 없으면 인자 자체를 받지 않는다 — 빈 객체를 넘기는 관례를 만들지 않는다 */
export type ArgsFor<S extends string> = [Placeholders<S>] extends [never]
  ? []
  : [values: { [K in Placeholders<S>]: string | number }];

/**
 * 카탈로그 한 벌의 계약. 원본(ko)이 키를 정하고 다른 로케일은 `Catalog` 로 **같은 키 집합**을
 * 강제받는다 — 빠뜨리거나 남는 키는 컴파일 에러다.
 *
 * 자리표시자가 서로 맞는지(`{key}` 를 en 이 빠뜨리지 않았는지)는 타입으로 표현할 수 없어
 * 테스트가 본다(`i18n.spec.ts`). 둘 다 있어야 한다 — 타입은 키를, 테스트는 내용을 지킨다.
 */
export type Catalog<Source extends Record<string, string>> = Record<keyof Source & string, string>;

export interface Translate<Source extends Record<string, string>> {
  <K extends keyof Source & string>(
    key: K,
    ...args: Source[K] extends string ? ArgsFor<Source[K]> : []
  ): string;
}

/** `{name}` 치환. 값이 없는 자리표시자는 **비워 두지 않고 그대로 남긴다** — 조용히 사라지면 못 찾는다 */
export function interpolate(template: string, values: PlaceholderValues | undefined): string {
  if (values === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * 카탈로그 묶음에서 번역기를 만든다.
 *
 * 폴백은 한 단계다: 요청 로케일에 키가 없으면 기본 로케일, 거기에도 없으면 **키 자체**를
 * 돌려준다. 빈 문자열을 돌려주면 화면에 구멍이 뚫리고 아무도 원인을 못 찾는다 —
 * 키가 보이면 최소한 어디를 고쳐야 하는지는 알 수 있다.
 */
export function makeTranslator<Source extends Record<string, string>>(
  catalogs: Record<Locale, Record<string, string>>,
  locale: Locale,
): Translate<Source> {
  const primary = catalogs[locale];
  const fallback = catalogs[DEFAULT_LOCALE];
  return ((key: string, values?: PlaceholderValues) =>
    interpolate(primary[key] ?? fallback[key] ?? key, values)) as Translate<Source>;
}
