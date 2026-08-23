// CLI 로케일 — 환경변수 해석만 본다(카탈로그 정합은 `@nerv/schema` 쪽 테스트 소관).
//
// 서버가 없어도 도는 명령이라 `Accept-Language` 가 없다. 그래서 여기가 틀리면
// 로케일을 정할 다른 방법이 없다.

import { afterEach, describe, expect, it } from 'vitest';
import { localeFromEnv, setLocaleForTesting, t } from './i18n.js';

afterEach(() => setLocaleForTesting(null));

describe('환경변수 → 로케일', () => {
  it.each([
    [{ NERV_LANG: 'en' }, 'en'],
    [{ NERV_LANG: 'ko' }, 'ko'],
    [{ LANG: 'en_US.UTF-8' }, 'en'],
    [{ LANG: 'ko_KR.UTF-8' }, 'ko'],
    [{ LC_ALL: 'en_GB.UTF-8', LANG: 'ko_KR.UTF-8' }, 'en'],
    // NERV_LANG 이 POSIX 변수를 이긴다 — 이 도구만 다른 언어로 쓰고 싶을 수 있다
    [{ NERV_LANG: 'ko', LANG: 'en_US.UTF-8' }, 'ko'],
    [{ LANG: 'C' }, 'ko'],
    [{ LANG: '' }, 'ko'],
    [{}, 'ko'],
  ])('%o → %s', (env, expected) => {
    expect(localeFromEnv(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});

describe('번역기', () => {
  it('로케일을 갈아끼우면 출력이 바뀐다', () => {
    setLocaleForTesting('en');
    expect(t()('cli.report.none')).toBe('None.');
    setLocaleForTesting('ko');
    expect(t()('cli.report.none')).toBe('없음.');
  });

  it('리포트 문구도 값이 들어간다', () => {
    setLocaleForTesting('en');
    expect(t()('cli.reason.plan_total', { expected: 10, actual: 7 })).toBe(
      'plan_total mismatch — expected 10, got 7',
    );
  });
});
