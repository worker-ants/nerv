// E08-S01 — 연결 상태 두 단계 (screens.md §1.3 · REQ-WEB-002 · REQ-WEB-235)
//
// 두 상태를 구분하는 것이 이 함수들의 전부이고, 그 구분이 사용자의 행동을 바꾼다:
// WS 만 끊긴 것이면 계속 써도 되고(폴링이 돈다), 플랫폼이 끊긴 것이면 쓰기를 멈춰야 한다.
// 그래서 **알리는 무게도 다르다**(2026-09-26 개정 — 사람 결정 D8): 앞의 것은 헤더의 작은 표시, 뒤의 것은 배너다.

import { createTranslator } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { connectionBanner, connectionMark, FALLBACK_POLL_MS } from './realtime.js';

// 테스트는 한국어 화면을 검사한다 — 로케일이 고정돼야 검사 대상이 기계마다 달라지지 않는다
const ko = createTranslator('ko');

describe('헤더의 연결 표시 (REQ-WEB-002)', () => {
  it('붙어 있거나 아직 붙는 중이면 아무것도 세우지 않는다 — 정상은 조용하다', () => {
    expect(connectionMark('connected', false)).toBeNull();
    expect(connectionMark('connecting', false)).toBeNull();
  });

  it('실시간만 끊기면 호박 점이다 — 폴링으로 일은 계속된다', () => {
    expect(connectionMark('disconnected', false)).toBe('ws');
  });

  it('플랫폼이 끊기면 오프라인이다 — WS 상태와 무관하게', () => {
    expect(connectionMark('connected', true)).toBe('offline');
    expect(connectionMark('disconnected', true)).toBe('offline');
  });
});

describe('배너는 오프라인에만 선다 (REQ-WEB-235)', () => {
  it('실시간만 끊긴 것은 배너가 아니다 — 멀쩡히 도는 화면을 한 줄 밀지 않는다', () => {
    expect(connectionBanner(ko, false)).toBeNull();
  });

  it('오프라인이면 언제 받은 내용인지를 말한다 — "캐시된" 만으로는 1분 전인지 한 시간 전인지 모른다', () => {
    expect(connectionBanner(ko, true)).toContain('오프라인');
    expect(connectionBanner(ko, true, new Date(2026, 8, 25, 9, 5).getTime())).toContain(
      '09:05 에 받은 것',
    );
  });

  it('폴백 폴링 간격은 하트비트보다 짧다 — 끊긴 동안에도 화면이 늙지 않게', () => {
    expect(FALLBACK_POLL_MS).toBeLessThan(60_000);
  });
});
