// 로그인된 기기의 이름 — user agent 에서 브라우저와 운영체제만 읽는다 (2026-09-28 · REQ-WEB-284)
//
// 서버는 받은 문자열을 그대로 저장한다. 사람이 알아볼 것은 "맥의 크롬" 정도라 둘만 뽑는다 — 버전까지 적으면
// 같은 기기가 업데이트마다 다른 기기처럼 읽힌다. 못 알아보면 null 이고, 화면은 "알 수 없는 기기" 라 적는다.

export interface DeviceName {
  browser: string | null;
  os: string | null;
}

/** 순서가 판정이다 — Edge · Opera 는 Chrome 을, Chrome 은 Safari 를 문자열에 함께 적는다 */
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\b(?:Headless)?Chrome\/|\bCriOS\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPhone\b/, 'iOS'],
  [/\biPad\b/, 'iPadOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export function describeUserAgent(ua: string | null): DeviceName {
  if (ua === null || ua.trim() === '') return { browser: null, os: null };
  const pick = (table: readonly [RegExp, string][]): string | null =>
    table.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  return { browser: pick(BROWSERS), os: pick(SYSTEMS) };
}
