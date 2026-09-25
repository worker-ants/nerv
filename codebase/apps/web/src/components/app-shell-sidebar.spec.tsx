// 상시 사이드바 — 왼쪽 열은 모든 화면에서 같다 (2026-09-25 사람 결정 D1 · REQ-WEB-225)
//
// 왼쪽 열이 라우트마다 세 모양이었다(NAV-06). 프로젝트 화면에서는 탭과 트리, 홈·받은 요청·알림·설정에서는
// 열이 통째로 사라져 본문이 가운데로 뛰었고, 도움말에서는 같은 폭의 다른 열(차례)이 섰다. 조직과 프로젝트는
// 헤더의 드롭다운 둘이었고, 헤더의 [프로젝트] 링크와 사이드바의 [개요]가 같은 곳을 가리키며 함께 켜졌다
// (NAV-05). 이 스위트가 지키는 것: 열이 어느 화면에서나 같은 한 벌로 서고 화면을 옮겨도 다시 그려지지
// 않는다 · 헤더는 지금 자리(조직 › 프로젝트 › 화면)를 말한다 · 받은 요청·알림은 열의 전역 구역에 한 번만
// 선다 · 도움말의 차례는 열 안에서 펼쳐진다.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { MANUAL_CHAPTERS } from '../lib/manual.js';
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

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (/\/orgs\/[^/]+\/projects/.test(u))
        return ok([
          { id: 'p-1', slug: 'clemvion', name: 'Clemvion' },
          { id: 'p-2', slug: 'sudoku', name: 'Sudoku' },
        ]);
      if (u.endsWith('/me'))
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'nerv', org_name: 'NERV', project_slug: null, roles: ['admin'] },
          ],
        });
      if (u.includes('/approvals?state=pending'))
        return ok({ items: [], next_cursor: null, total: 5, actionable_total: 3 });
      if (u.includes('/me/notifications/unread-count')) return ok({ count: 9, immediate: 2 });
      return ok({ items: [], summary: {}, next_cursor: null, memberships: [], count: 0 });
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

/** 사이드바가 서는 폭(`md`)이라고 말한다 — jsdom 에는 `matchMedia` 가 없어 기본은 좁은 화면이다 */
function stubWide(): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(min-width: 48rem)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const rail = (): Promise<HTMLElement> => screen.findByTestId('nav-rail');
const header = (): HTMLElement => document.querySelector('header')!;

describe('왼쪽 열은 모든 화면에서 같다 (NAV-06)', () => {
  it.each(['/', '/inbox', '/notifications', '/settings/workspace', '/help', '/p/clemvion/tasks'])(
    '%s 에도 조직 · 전역 · 프로젝트 · 설정·도움말이 같은 자리에 있다',
    async (path) => {
      mount(path);
      const nav = await rail();
      await waitFor(() => expect(within(nav).getByTestId('org-switcher')).toBeDefined());
      expect(within(nav).getByRole('navigation', { name: '전역 메뉴' })).toBeDefined();
      expect(within(nav).getByTestId('rail-home').getAttribute('href')).toBe('/');
      expect(within(nav).getByTestId('rail-inbox').getAttribute('href')).toBe('/inbox');
      expect(within(nav).getByTestId('rail-notifications').getAttribute('href')).toBe(
        '/notifications',
      );
      await waitFor(() => expect(within(nav).getByTestId('project-new-link')).toBeDefined());
      expect(within(nav).getByTestId('rail-settings')).toBeDefined();
      expect(within(nav).getByTestId('rail-help').getAttribute('href')).toBe('/help');
    },
  );

  it('화면을 옮겨도 열은 다시 그려지지 않는다 — 본문이 가운데로 뛰지 않는다', async () => {
    const router = mount('/');
    const first = await rail();
    await act(() => router.navigate({ to: '/p/$proj/tasks', params: { proj: 'clemvion' } }));
    await waitFor(() => expect(screen.getByTestId('rail-project-current')).toBeDefined());
    expect(screen.getByTestId('nav-rail')).toBe(first);
    await act(() => router.navigate({ to: '/inbox' }));
    await waitFor(() => expect(screen.queryByTestId('rail-project-current')).toBeNull());
    expect(screen.getByTestId('nav-rail')).toBe(first);
  });

  it('프로젝트 화면이면 그 프로젝트만 펼친다 — 다른 프로젝트는 한 줄씩, 누르면 간다', async () => {
    mount('/p/sudoku/tasks');
    const nav = await rail();
    const current = await within(nav).findByTestId('rail-project-current');
    await waitFor(() => expect(current.textContent).toContain('Sudoku'));
    const tabs = within(nav).getByRole('navigation', { name: '프로젝트' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual([
      '/p/sudoku',
      '/p/sudoku/specs',
      '/p/sudoku/tasks',
      '/p/sudoku/sessions',
      '/p/sudoku/reviews',
    ]);
    expect(within(nav).getByTestId('rail-project-clemvion').getAttribute('href')).toBe(
      '/p/clemvion',
    );
  });
});

describe('헤더는 지금 자리를 말한다 (NAV-05)', () => {
  it('프로젝트 화면 — 조직 › 프로젝트 › 화면', async () => {
    mount('/p/clemvion/tasks');
    const crumbs = await screen.findByRole('navigation', { name: '지금 위치' });
    await waitFor(() => expect(within(crumbs).getByTestId('crumb-org').textContent).toBe('NERV'));
    // 조직은 글자다 — 헤더에서 `/` 로 가는 길은 로고 하나다
    expect(within(crumbs).getByTestId('crumb-org').tagName).toBe('SPAN');
    await waitFor(() =>
      expect(within(crumbs).getByTestId('crumb-project').textContent).toBe('Clemvion'),
    );
    expect(within(crumbs).getByTestId('crumb-project').getAttribute('href')).toBe('/p/clemvion');
    const here = within(crumbs).getByTestId('crumb-screen');
    expect(here.textContent).toBe('작업');
    expect(here.getAttribute('aria-current')).toBe('page');
  });

  it('조직 범위 화면에는 프로젝트 칸이 없다', async () => {
    mount('/inbox');
    const crumbs = await screen.findByRole('navigation', { name: '지금 위치' });
    expect(within(crumbs).getByTestId('crumb-screen').textContent).toBe('받은 요청');
    expect(within(crumbs).queryByTestId('crumb-project')).toBeNull();
  });

  it('고르는 자리는 헤더에 없다 — 조직 전환기도 프로젝트 선택기도 [프로젝트] 링크도', async () => {
    mount('/p/clemvion/tasks');
    await rail();
    expect(within(header()).queryByTestId('org-switcher')).toBeNull();
    expect(screen.queryByTestId('project-switcher')).toBeNull();
    expect(within(header()).queryByRole('link', { name: '프로젝트' })).toBeNull();
  });
});

describe('받은 요청·알림은 한 자리에 선다', () => {
  it('사이드바의 전역 구역이 두 수를 든다', async () => {
    mount('/');
    const nav = await rail();
    await waitFor(() => expect(within(nav).getByTestId('rail-inbox-badge').textContent).toBe('3'));
    await waitFor(() =>
      expect(within(nav).getByTestId('rail-notification-badge').textContent).toBe('2'),
    );
  });

  it('사이드바가 서는 폭이면 헤더에는 같은 수가 또 서지 않는다', async () => {
    stubWide();
    mount('/');
    const nav = await rail();
    await waitFor(() => expect(within(nav).getByTestId('rail-inbox-badge').textContent).toBe('3'));
    expect(within(header()).queryByTestId('inbox-badge')).toBeNull();
    expect(within(header()).queryByTestId('notification-badge')).toBeNull();
  });

  it('서랍으로 접힌 폭에서는 헤더에 남는다 — 숫자는 열기 전에 보인다(REQ-WEB-164)', async () => {
    mount('/');
    await waitFor(() => expect(within(header()).getByTestId('inbox-badge').textContent).toBe('3'));
  });
});

describe('도움말의 차례는 사이드바에 펼쳐진다 (NAV-14)', () => {
  it('도움말에서는 [도움말] 아래에 장 전부가 선다', async () => {
    mount('/help/tasks');
    const nav = await rail();
    const toc = within(nav).getByTestId('manual-toc');
    const links = within(toc).getAllByRole('link');
    expect(links).toHaveLength(MANUAL_CHAPTERS.length);
    expect(links.map((a) => a.getAttribute('href'))).toContain('/help/tasks');
    expect(
      links.find((a) => a.getAttribute('href') === '/help/tasks')?.getAttribute('aria-current'),
    ).toBe('page');
  });

  it('다른 화면에서는 차례 대신 "이 화면 도움말" 한 줄이다', async () => {
    mount('/p/clemvion/tasks');
    const nav = await rail();
    expect(within(nav).queryByTestId('manual-toc')).toBeNull();
    expect(within(nav).getByTestId('drawer-help-this-screen').getAttribute('href')).toBe(
      '/help/tasks',
    );
  });
});
