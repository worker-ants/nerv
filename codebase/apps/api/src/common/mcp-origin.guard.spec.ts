// REQ-CB-013 — POST /mcp 의 Origin 검증은 전단(nginx·Ingress) 차단 여부와 무관하게
// 앱 가드가 최종 강제한다. 규칙 정본: docs/04-mvp/codebase.md §2.4·§6.3

import { describe, expect, it } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { McpOriginGuard, originOf } from './mcp-origin.guard.js';

const guard = new McpOriginGuard('https://nerv.example.com');

describe('McpOriginGuard', () => {
  it('Origin 헤더가 없으면 통과시킨다 — 비브라우저 클라이언트(에이전트)', () => {
    expect(guard.check(undefined)).toBe(true);
    expect(guard.check('')).toBe(true);
  });

  it('NERV_PUBLIC_URL 과 같은 오리진이면 통과시킨다', () => {
    expect(guard.check('https://nerv.example.com')).toBe(true);
  });

  it('다른 오리진이면 NERV_FORBIDDEN 으로 막는다', () => {
    expect(() => guard.check('https://evil.example.com')).toThrowError(
      expect.objectContaining({ code: NERV_ERROR.FORBIDDEN }),
    );
  });

  it('호스트가 같아도 스킴·포트가 다르면 막는다', () => {
    expect(() => guard.check('http://nerv.example.com')).toThrow();
    expect(() => guard.check('https://nerv.example.com:8443')).toThrow();
  });

  it('경로가 붙은 값은 오리진만 비교한다', () => {
    const g = new McpOriginGuard('https://nerv.example.com/some/path');
    expect(g.check('https://nerv.example.com')).toBe(true);
  });

  it('파싱 불가한 Origin 은 막는다', () => {
    expect(() => guard.check('not-a-url')).toThrow();
    expect(originOf('not-a-url')).toBeNull();
  });
});
