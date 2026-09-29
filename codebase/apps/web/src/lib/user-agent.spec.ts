// 로그인된 기기의 이름 (2026-09-28 · REQ-WEB-284) — 브라우저 문자열은 서로를 흉내 내서 순서가 판정이다

import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './user-agent.js';

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0',
      'Edge',
      'Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      'Chrome',
      'macOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox', 'Linux'],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
      'Chrome',
      'Android',
    ],
    // 자동화 브라우저(E2E)도 크롬이다 — `\bChrome` 은 `HeadlessChrome` 안에서 맞지 않았다
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 HeadlessChrome/131.0 Safari/537.36',
      'Chrome',
      'macOS',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
      'Safari',
      'iPadOS',
    ],
  ])('%s', (ua, browser, os) => {
    expect(describeUserAgent(ua)).toEqual({ browser, os });
  });

  it('비었거나 모르는 문자열은 둘 다 null 이다 — 화면이 "알 수 없는 기기" 라 적는다', () => {
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null });
    expect(describeUserAgent('curl/8.7.1')).toEqual({ browser: null, os: null });
  });
});
