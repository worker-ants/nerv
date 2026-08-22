// E08-S01 — 연결 상태 배너 2단계 (screens.md §1.3 · REQ-WEB-002)
//
// 두 상태를 구분하는 것이 이 함수의 전부이고, 그 구분이 사용자의 행동을 바꾼다:
// WS 만 끊긴 것이면 계속 써도 되고(폴링이 돈다), 플랫폼이 끊긴 것이면 쓰기를 멈춰야 한다.

import { describe, expect, it } from 'vitest';
import { connectionBanner, FALLBACK_POLL_MS } from './realtime.js';

describe('연결 상태 배너', () => {
  it('연결돼 있으면 배너가 없다 — 정상은 조용하다', () => {
    expect(connectionBanner('connected', false)).toBeNull();
  });

  it('WS 만 끊기면 폴링 안내다 — 읽기는 계속된다', () => {
    expect(connectionBanner('disconnected', false)).toContain('폴링');
  });

  it('플랫폼이 끊기면 오프라인으로 격상한다 — WS 상태와 무관하게', () => {
    expect(connectionBanner('connected', true)).toContain('오프라인');
    expect(connectionBanner('disconnected', true)).toContain('오프라인');
  });

  it('폴백 폴링 간격은 하트비트보다 짧다 — 끊긴 동안에도 화면이 늙지 않게', () => {
    expect(FALLBACK_POLL_MS).toBeLessThan(60_000);
  });
});
