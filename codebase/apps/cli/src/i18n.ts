// CLI 로케일 — 정본: docs/04-mvp/importer.md §3.5
//
// 서버가 없어도 도는 명령이라(dry-run 은 `--server` 없이 완주한다) `Accept-Language` 가 없다.
// 그래서 환경변수를 본다: `NERV_LANG` 이 우선이고, 없으면 POSIX 의 `LC_ALL`/`LC_MESSAGES`/`LANG`.
//
// 한 프로세스에 로케일 하나다. 명령이 단발이라 도중에 바뀔 일이 없고, 번역기를 인자로
// 실어 나르는 비용만 늘어난다.

import { createTranslator, DEFAULT_LOCALE, isLocale } from '@nerv/schema';
import type { Translator } from '@nerv/schema';

/** `ko_KR.UTF-8` · `en-US` · `C` 등에서 앞쪽 언어 태그만 떼어낸다 */
export function localeFromEnv(env: NodeJS.ProcessEnv = process.env): 'ko' | 'en' {
  for (const name of ['NERV_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    const base = raw.split(/[._@-]/)[0]?.toLowerCase() ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

let translator: Translator | null = null;

/** 프로세스 로케일의 번역기. 처음 부를 때 환경변수를 읽는다 */
export function t(): Translator {
  translator ??= createTranslator(localeFromEnv());
  return translator;
}

/** 테스트가 로케일을 갈아끼운다 — 그러지 못하면 검사 대상이 기계마다 달라진다 */
export function setLocaleForTesting(locale: 'ko' | 'en' | null): void {
  translator = locale === null ? null : createTranslator(locale);
}
