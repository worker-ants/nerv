// 첨부 내려주기의 CSP — api.md §2.10 (REQ-API-070)
//
// **한 낱말이 이 정책의 전부다.** `allow-scripts` 는 html 시안을 그리게 하고,
// `allow-same-origin` 이 곁에 오는 순간 그 문서는 앱과 같은 오리진이 되어 업로드된
// html 이 곧 앱의 XSS 가 된다 — dev 는 웹과 API 가 같은 오리진으로 보이고(vite 프록시)
// 배치도 앞문 하나를 지나므로, 그 격리는 여기 이 문자열 하나에 걸려 있다.
//
// 그래서 이 스위트가 지키는 것은 "돌아간다" 가 아니라 **주지 않기로 한 것**이다.
// 정책은 헤더 문자열이라 화면에서 잴 수 없고, 실수는 조용하다(더해도 아무것도 깨지지
// 않고 다음 사람은 그것을 의도로 읽는다).

import { describe, expect, it } from 'vitest';
import { ALLOWED_TYPES, attachmentCsp } from './attachment.service.js';

describe('html — 격리 안에서 그린다', () => {
  const csp = attachmentCsp('text/html');

  it('스크립트를 연다 — 이것이 없으면 시안은 빈 화면이다', () => {
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain("script-src 'unsafe-inline'");
  });

  it('오리진은 열지 않는다', () => {
    expect(csp).not.toContain('allow-same-origin');
  });

  it('격리를 벗는 낱말 셋도 없다', () => {
    for (const token of ['allow-forms', 'allow-top-navigation', 'allow-popups-to-escape-sandbox']) {
      expect(csp).not.toContain(token);
    }
  });

  it("열지 않은 것은 default-src 'none' 을 물려받는다", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('object-src');
  });

  it('charset 이 붙어 와도 같은 정책이다 — 형식 판정이 문자열 비교로 갈리지 않는다', () => {
    expect(attachmentCsp('text/html; charset=utf-8')).toBe(csp);
    expect(attachmentCsp('TEXT/HTML')).toBe(csp);
  });
});

describe('나머지 형식 — 잠긴 채다', () => {
  // **SVG 가 이 표의 이유다** — 이미지로 위장한 스크립트가 더 어려운 경우이고,
  // 시안을 그리는 데 스크립트가 필요하지도 않다.
  it.each(Object.keys(ALLOWED_TYPES).filter((type) => type !== 'text/html'))('%s', (type) => {
    expect(attachmentCsp(type)).toBe("sandbox; default-src 'none'");
  });

  it('화이트리스트 밖의 값도 잠긴 쪽이 기본이다', () => {
    expect(attachmentCsp('application/octet-stream')).toBe("sandbox; default-src 'none'");
    expect(attachmentCsp('')).toBe("sandbox; default-src 'none'");
  });
});
