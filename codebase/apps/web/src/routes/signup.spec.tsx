// 가입 → 조직 만들기 (screens.md §2.1)
//
// **처음 켠 서버에서 사람이 멈추지 않아야 한다.** 계정이 없으면 로그인 화면에서 가입으로,
// 소속이 없으면 온보딩에서 조직 만들기로 이어진다 — 어느 화면도 막다른 길이 아니다.

import { LocaleProvider } from '../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 소속이 하나도 없는 사람 — 가입 직후의 상태다 */
const NO_MEMBERSHIP = {
  id: 'u-1',
  email: 'first@example.com',
  display_name: '처음',
  memberships: [],
};

function renderAt(path: string): void {
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
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const json = path.includes('/me')
        ? NO_MEMBERSHIP
        : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('가입 (2026-08-27 신설 · 사람 결정)', () => {
  it('로그인 화면이 가입으로 가는 길을 보인다 — 계정이 없는 서버의 첫 걸음이다', async () => {
    renderAt('/login');
    await waitFor(() => expect(screen.getByTestId('signup-link')).toBeDefined());
    expect(screen.getByTestId('signup-link').getAttribute('href')).toBe('/signup');
  });

  it('가입 화면은 셸 밖이다 — 조직이 없으면 헤더의 두 select 가 가리킬 것이 없다', async () => {
    renderAt('/signup');
    await waitFor(() => expect(screen.getByText('가입하기')).toBeDefined());
    expect(screen.queryByTestId('org-switcher')).toBeNull();
    expect(screen.queryByTestId('project-switcher')).toBeNull();
  });
});

describe('소속이 없으면 조직을 만든다', () => {
  it('온보딩이 기다리라고만 하지 않는다 — 처음 켠 서버에는 그 관리자가 없다', async () => {
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByTestId('org-name')).toBeDefined());
    expect(screen.getByText('① 조직 만들기')).toBeDefined();
    expect(screen.getByRole('button', { name: '조직 만들기' })).toBeDefined();
  });

  it('초대를 기다리는 길도 함께 적는다 — 조직이 갈라지면 스펙도 갈라진다', async () => {
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByTestId('org-name')).toBeDefined());
    expect(screen.getByText(/초대를 받으세요/)).toBeDefined();
    expect(screen.getByText('first@example.com')).toBeDefined();
  });
});
