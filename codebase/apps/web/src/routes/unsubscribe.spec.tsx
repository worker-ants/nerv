// 메일 요약을 로그인 없이 끄는 화면 (2026-09-28 · 사람 결정 EM8 · REQ-WEB-270)
//
// 여는 것만으로는 끄지 않는다(메일 보안 검사기가 링크를 미리 연다) · 로그인하지 않은 사람을 로그인으로 보내지
// 않는다 · 만료된 링크는 내 계정으로 가는 길을 보인다 — 셋을 본다.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

let posts: string[] = [];
/** 끄기 요청의 답 */
let reply: { status: number; json: unknown };

beforeEach(() => {
  posts = [];
  reply = { status: 200, json: { ok: true, unsubscribed: true } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && u.includes('/mail/unsubscribe/')) {
        posts.push(u);
        return { ok: reply.status < 400, status: reply.status, json: async () => reply.json };
      }
      // 로그인하지 않은 사람이다 — 이 화면은 로그인으로 되돌려 보내지 않아야 한다
      return {
        ok: false,
        status: 401,
        json: async () => ({ code: NERV_ERROR.UNAUTHENTICATED, message: 'unauthenticated' }),
      };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RealtimeProvider>
          <RouterProvider router={router as never} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return router;
}

describe('/unsubscribe/$token (REQ-WEB-270)', () => {
  it('여는 것만으로는 끄지 않는다 — 누르면 그 토큰으로 한 번 POST 하고, 로그인으로 보내지 않는다', async () => {
    const router = mount('/unsubscribe/tok-abc');
    const submit = await screen.findByTestId('unsubscribe-submit');
    expect(posts).toHaveLength(0);
    fireEvent.click(submit);
    await screen.findByTestId('unsubscribe-done');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatch(/\/api\/v1\/mail\/unsubscribe\/tok-abc$/);
    expect(router.state.location.pathname).toBe('/unsubscribe/tok-abc');
  });

  it('만료된 링크는 까닭과 내 계정으로 가는 길을 보인다', async () => {
    reply = {
      status: 409,
      json: {
        ok: false,
        code: NERV_ERROR.PRECONDITION,
        message: 'expired',
        details: { kind: 'not_found' },
        retry_after_s: null,
        next_actions: [],
      },
    };
    mount('/unsubscribe/tok-old');
    fireEvent.click(await screen.findByTestId('unsubscribe-submit'));
    const panel = await screen.findByTestId('unsubscribe-expired');
    expect(panel.textContent).toContain('7일');
    expect(screen.getByTestId('unsubscribe-to-account').getAttribute('href')).toBe(
      '/settings/account?tab=notifications',
    );
  });
});
