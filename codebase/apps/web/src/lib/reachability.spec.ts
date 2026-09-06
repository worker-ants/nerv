// 플랫폼에 닿는가 — 배너 2단계의 ②를 켜는 스위치 (screens.md §1.3 · NFR-05)
//
// **문구·분기·폴백 폴링은 처음부터 다 있었고 켜는 곳만 없었다**(2026-09-06 대조):
// `setOffline` 호출부가 저장소에 0건이라 `offline` 은 영구히 false 였고, REST 가 죽어도
// 화면은 "실시간 갱신 중단" 만 말하며 캐시된 읽기 전용이라는 사실을 절대 알리지 않았다.
//
// 판정의 축이 이 파일의 전부다: **서버가 답했는가**. 4xx·5xx 는 답한 것이므로 닿은 것이다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, onReachabilityChange, resetReachabilityForTesting } from './api.js';

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ ok: status < 400 }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('플랫폼 도달 판정', () => {
  const seen: boolean[] = [];

  beforeEach(() => {
    resetReachabilityForTesting();
    seen.length = 0;
    onReachabilityChange((reachable) => seen.push(reachable));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetReachabilityForTesting();
  });

  it('fetch 가 거절하면 못 닿은 것이다 — 배너가 오프라인으로 격상한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(apiFetch('/me')).rejects.toThrow();
    expect(seen).toEqual([false]);
  });

  it('403 은 **답한 것**이다 — 권한 거절 하나가 화면을 오프라인으로 만들지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(403))),
    );
    await expect(apiFetch('/me')).rejects.toThrow();
    expect(seen).toEqual([true]);
  });

  it('취소는 단절이 아니다 — 화면을 떠날 때마다 배너가 깜빡이면 안 된다', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(abort)),
    );
    await expect(apiFetch('/me')).rejects.toThrow();
    expect(seen).toEqual([]);
  });

  it('값이 바뀔 때만 알린다 — 매 요청마다 setState 를 부르면 화면이 통째로 다시 그려진다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200))),
    );
    await apiFetch('/me');
    await apiFetch('/me');
    await apiFetch('/me');
    expect(seen).toEqual([true]);
  });

  it('되살아나면 다시 알린다 — 폴백 폴링이 그 순간을 잡는다', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/me')).rejects.toThrow();
    await apiFetch('/me');
    expect(seen).toEqual([false, true]);
  });
});
