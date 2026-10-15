// 이메일 바꾸기 링크의 결과 화면 (2026-10-15 · 사람 결정 · REQ-WEB-314 · api.md REQ-API-310)
//
// 메일의 링크는 인증 스택을 거쳐 `/email-change` 로 온다 — 옛 주소의 승인이면 `?step=approved`, 새 주소의 확인이면
// `?step=done`, 쓸 수 없는 링크면 `&error=<코드>` 가 붙는다. 새 주소의 메일함은 로그인하지 않은 기기에서 열리기
// 쉬워서 이 화면은 셸 밖이고, 로그인했는지에 따라 다음 걸음이 다르다.

import { cleanup, render, screen } from '@testing-library/react';
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

/** 이 브라우저가 로그인해 있는가 — `/me` 의 답을 바꾼다 */
let signedIn = false;

beforeEach(() => {
  localStorage.clear();
  signedIn = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/me') && signedIn) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'u-1',
            email: 'next@example.com',
            display_name: '지민',
            memberships: [],
          }),
        };
      }
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

describe('/email-change — 링크의 결과 (REQ-WEB-314)', () => {
  it('옛 주소에서 승인하면 새 주소의 메일함을 열라고 적는다 — 로그인하지 않았어도 로그인으로 되돌려 보내지 않는다', async () => {
    const router = mount('/email-change?step=approved');
    const card = await screen.findByTestId('email-change-approved');
    expect(card.textContent).toContain('새 주소로 확인 메일을 보냈습니다');
    expect(card.textContent).toContain('60분');
    expect(router.state.location.pathname).toBe('/email-change');
    expect(screen.queryByTestId('user-menu')).toBeNull();
  });

  it('바뀐 뒤 로그인하지 않은 브라우저면 새 주소로 다시 로그인하라고 적고 로그인으로 보낸다', async () => {
    mount('/email-change?step=done');
    const card = await screen.findByTestId('email-change-done');
    expect(card.textContent).toContain('새 주소로 다시 로그인하세요');
    expect(screen.getByTestId('email-change-to-login').getAttribute('href')).toBe('/login');
  });

  it('바뀐 뒤 그 사람으로 로그인한 브라우저면 로그인이 그대로라고 적고 내 계정으로 보낸다', async () => {
    signedIn = true;
    mount('/email-change?step=done');
    expect((await screen.findByTestId('email-change-to-account')).getAttribute('href')).toBe(
      '/settings/account',
    );
    expect(screen.getByTestId('email-change-done').textContent).toContain(
      '이 브라우저는 로그인 상태 그대로이고',
    );
  });

  it('쓸 수 없는 링크면 그 까닭과 다시 요청하는 곳을 적는다', async () => {
    mount('/email-change?step=approved&error=INVALID_TOKEN');
    const card = await screen.findByTestId('email-change-invalid');
    expect(card.getAttribute('data-error')).toBe('INVALID_TOKEN');
    expect(card.textContent).toContain('내 계정에서 다시 요청하세요');
    expect(screen.queryByTestId('email-change-approved')).toBeNull();
  });

  it('다른 계정으로 로그인한 브라우저에서 열었으면 로그아웃하고 다시 열라고 적는다', async () => {
    mount('/email-change?step=done&error=INVALID_USER');
    expect((await screen.findByTestId('email-change-invalid')).textContent).toContain(
      '다른 계정으로 로그인한 브라우저입니다',
    );
  });
});
