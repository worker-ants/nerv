// 런타임 설정 로더 — 4.1 §2.3 3단계 (정본: docs/04-mvp/codebase.md §5.2d)
//
// **이 스위트가 지키는 것은 폴백이다.** 3단계는 "가를 수 있게 한다" 이지 "가른다" 가
// 아니므로, 파일이 없거나 값이 비거나 못 읽는 배치에서는 **한 줄도 바뀌지 않아야 한다** —
// 그때의 값이 같은 오리진(상대 경로)이다. 개발 루프가 매일 그 경로를 지난다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_PATH, apiBase, loadRuntimeConfig, resetRuntimeConfigForTesting } from './config.js';

/** `fetch` 의 자리에 세우는 최소 응답 — 로더가 보는 것은 ok·json 둘뿐이다. */
function respond(body: unknown, init: { ok?: boolean } = {}): typeof fetch {
  return vi.fn(async () =>
    Promise.resolve({
      ok: init.ok ?? true,
      json: async () => Promise.resolve(body),
    }),
  ) as unknown as typeof fetch;
}

/** 개발 루프의 실제 응답 — Vite 는 모르는 경로에 index.html 을 **200 으로** 준다. */
function respondHtml(): typeof fetch {
  return vi.fn(async () =>
    Promise.resolve({
      ok: true,
      json: async () => Promise.reject(new SyntaxError('Unexpected token <')),
    }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  resetRuntimeConfigForTesting();
  vi.restoreAllMocks();
});

describe('loadRuntimeConfig', () => {
  it('설정이 준 주소를 쓴다 — 배포가 놓은 파일 하나가 화면의 API 주소다', async () => {
    await loadRuntimeConfig(respond({ api_url: 'https://api.nerv.example.com' }));
    expect(apiBase()).toBe('https://api.nerv.example.com');
  });

  it('화면과 같은 오리진에서 읽는다 — 설정을 읽으러 다른 곳에 묻지 않는다', async () => {
    const fetchImpl = respond({ api_url: 'https://api.nerv.example.com' });
    await loadRuntimeConfig(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(CONFIG_PATH, { cache: 'no-store' });
  });

  it('경로·끝 슬래시는 오리진으로 정규화한다 — 서버의 허용 목록과 같은 규칙이다', async () => {
    await loadRuntimeConfig(respond({ api_url: 'https://api.nerv.example.com/v1/' }));
    expect(apiBase()).toBe('https://api.nerv.example.com');
  });

  it('**파일이 없으면 같은 오리진이다** — 그것이 지금까지의 동작이다', async () => {
    await loadRuntimeConfig(respond({}, { ok: false }));
    expect(apiBase()).toBe('');
  });

  it('**개발 루프의 200 짜리 HTML 도 폴백이다** — Vite 는 모르는 경로에 index.html 을 준다', async () => {
    await loadRuntimeConfig(respondHtml());
    expect(apiBase()).toBe('');
  });

  it('키가 없거나 값이 비면 같은 오리진이다 — 앞문이 빈 값을 그대로 내어 주는 배치가 그것이다', async () => {
    await loadRuntimeConfig(respond({}));
    expect(apiBase()).toBe('');
    await loadRuntimeConfig(respond({ api_url: '' }));
    expect(apiBase()).toBe('');
  });

  it('네트워크가 죽어도 화면은 뜬다 — 설정 실패는 폴백이지 오류가 아니다', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    await expect(loadRuntimeConfig(fetchImpl)).resolves.toEqual({ apiBase: '' });
  });

  it('**스킴 없는 값은 버리고 한 줄 남긴다** — 조용히 같은 오리진으로 돌면 원인이 없다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await loadRuntimeConfig(respond({ api_url: 'api.nerv.example.com:8080' }));
    expect(apiBase()).toBe('');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('api.nerv.example.com:8080');
  });
});
