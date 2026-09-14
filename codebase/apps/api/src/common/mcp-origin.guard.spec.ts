// REQ-CB-013 — POST /mcp 의 Origin 검증은 전단(nginx·Ingress) 차단 여부와 무관하게
// 앱 가드가 최종 강제한다. 규칙 정본: docs/04-mvp/codebase.md §2.4·§6.3
//
// 2026-09-13 부터 대조 대상이 **둘**이다(`NERV_API_URL` · `NERV_WEB_URL` — REQ-CB-036).
// 규칙은 그대로다: 헤더 없으면 통과, 있으면 우리 오리진 중 하나와 정확히 같아야 통과.

import { describe, expect, it } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { McpOriginGuard } from './mcp-origin.guard.js';
import { originOf } from './origins.js';

const API = 'https://api.nerv.example.com';
const WEB = 'https://app.nerv.example.com';
const guard = new McpOriginGuard(API, WEB);

describe('McpOriginGuard', () => {
  it('Origin 헤더가 없으면 통과시킨다 — 비브라우저 클라이언트(에이전트)', () => {
    expect(guard.check(undefined)).toBe(true);
    expect(guard.check('')).toBe(true);
  });

  it('NERV_API_URL 과 같은 오리진이면 통과시킨다', () => {
    expect(guard.check(API)).toBe(true);
  });

  it('**NERV_WEB_URL 과 같은 오리진도 통과시킨다** — 화면이 사는 곳이 다른 호스트일 수 있다', () => {
    expect(guard.check(WEB)).toBe(true);
  });

  it('둘 다 아니면 NERV_FORBIDDEN 으로 막는다', () => {
    expect(() => guard.check('https://evil.example.com')).toThrowError(
      expect.objectContaining({ code: NERV_ERROR.FORBIDDEN }),
    );
  });

  it('거절 문구는 허용 오리진 둘을 싣는다 — 운영자가 어느 값을 고칠지 알아야 한다', () => {
    try {
      guard.check('https://evil.example.com');
      expect.unreachable();
    } catch (error) {
      expect((error as { details?: { expected?: string[] } }).details?.expected).toEqual([
        API,
        WEB,
      ]);
    }
  });

  it('호스트가 같아도 스킴·포트가 다르면 막는다', () => {
    expect(() => guard.check('http://api.nerv.example.com')).toThrow();
    expect(() => guard.check('https://api.nerv.example.com:8443')).toThrow();
  });

  it('경로가 붙은 값은 오리진만 비교한다', () => {
    const g = new McpOriginGuard(`${API}/some/path`, WEB);
    expect(g.check(API)).toBe(true);
  });

  it('두 이름이 같은 값이면 허용 오리진은 하나다 — 같은 주소를 두 번 적지 않는다', () => {
    const g = new McpOriginGuard(API, API);
    expect(g.check(API)).toBe(true);
    try {
      g.check('https://evil.example.com');
      expect.unreachable();
    } catch (error) {
      expect((error as { details?: { expected?: string[] } }).details?.expected).toEqual([API]);
    }
  });

  it('파싱 불가한 Origin 은 막는다', () => {
    expect(() => guard.check('not-a-url')).toThrow();
    expect(originOf('not-a-url')).toBeNull();
  });
});
