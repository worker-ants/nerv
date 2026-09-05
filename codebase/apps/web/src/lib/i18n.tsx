// 웹의 로케일 — 정본: docs/04-mvp/screens.md §1.7
//
// 카탈로그는 `@nerv/schema` 에 있다(웹·API·CLI 공용). 여기 있는 것은 **웹에서만 필요한 것**
// 셋뿐이다: 로케일을 어떻게 정하나 · 어떻게 기억하나 · 서버에 어떻게 알리나.
//
// 고르는 순서: 사용자가 고른 값 → 브라우저 언어 → 기본값(ko).
// 사용자가 한 번 고르면 그 선택이 이긴다 — 브라우저 언어가 바뀌었다고 화면 언어가 저 혼자
// 바뀌면, 고른 적 있다는 사실이 배신당한다.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createTranslator, DEFAULT_LOCALE, isLocale, LOCALES } from '@nerv/schema';
import type { Locale, Translator } from '@nerv/schema';

const STORAGE_KEY = 'nerv.locale';

/** 사용자가 고른 로케일. 없으면 null — "브라우저를 따른다"는 뜻이다 */
function storedLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    // 사생활 보호 모드처럼 localStorage 가 막힌 환경도 있다 — 그때는 브라우저 언어를 따른다
    return null;
  }
}

function browserLocale(): Locale {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.split('-')[0]?.toLowerCase() ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function initialLocale(): Locale {
  return storedLocale() ?? browserLocale();
}

/**
 * 서버에 보낼 `Accept-Language`. 화면과 응답이 **같은 언어**여야 한다 —
 * 버튼은 영어인데 에러 토스트만 한국어로 뜨면 그건 절반만 된 i18n 이다.
 */
let currentLocale: Locale = DEFAULT_LOCALE;
export function acceptLanguageHeader(): string {
  return currentLocale === DEFAULT_LOCALE
    ? currentLocale
    : `${currentLocale},${DEFAULT_LOCALE};q=0.8`;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Translator;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface LocaleProviderProps {
  children: React.ReactNode;
  /**
   * 로케일을 고정한다. 감지(저장값 → 브라우저 → 기본값)를 건너뛴다 —
   * **테스트가 어느 언어를 검사하는지 말할 수 있어야** 한다. 브라우저 언어에 따라
   * 검사 대상이 바뀌면 그 테스트는 기계마다 다른 것을 확인하게 된다.
   */
  locale?: Locale;
}

export function LocaleProvider({
  children,
  locale: fixed,
}: LocaleProviderProps): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => fixed ?? initialLocale());

  // 모듈 권한의 값도 같이 옮긴다 — apiFetch 는 React 밖에서 헤더를 만든다
  currentLocale = locale;

  useEffect(() => {
    // 스크린리더와 브라우저의 하이픈 규칙이 이 속성을 읽는다 — 안 맞으면 한국어를 영어처럼 읽는다
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    currentLocale = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 저장이 막혀도 이번 세션 동안은 바뀐 채로 쓴다 — 되돌려 놓는 것이 더 나쁘다
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: createTranslator(locale) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  // Provider 밖에서 부르면 조용히 기본 로케일로 넘어가지 않는다 — 그러면 화면 일부만
  // 언어 전환을 따르지 않는 버그가 되고, 그건 눈으로 찾기 어렵다
  // eslint-disable-next-line no-restricted-syntax -- 개발자 오류 — 화면에 뜨지 않는다(REQ-CB-022)
  if (ctx === null) throw new Error('LocaleProvider 안에서만 쓸 수 있습니다.');
  return ctx;
}

/** 화면이 쓰는 것은 대개 이것 하나다 */
export function useT(): Translator {
  return useLocaleContext().t;
}

export function useLocale(): { locale: Locale; setLocale: (next: Locale) => void } {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
}

/** 언어 이름은 **그 언어로** 적는다 — 읽을 수 없는 언어로 적힌 선택지는 고를 수 없다 */
// eslint-disable-next-line no-restricted-syntax -- 언어 이름은 그 언어로 적는다 — 번역 대상이 아니다(REQ-CB-022)
export const LOCALE_LABEL: Record<Locale, string> = { ko: '한국어', en: 'English' };

export { LOCALES };
export type { Locale };
