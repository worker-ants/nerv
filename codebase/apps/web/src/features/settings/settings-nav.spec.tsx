// 설정을 범위로 묶는다 — 조직 · 프로젝트 · 나 (2026-09-25 — 사람 결정 D1 · UI/UX 검토 SET-06 · NAV-10 · SET-07 · REQ-WEB-227)
//
// 설정은 "설정" 한 낱말과 탭 넷이었다. 탭마다 범위가 달랐는데(토큰은 나 · 조직·프로젝트와 멤버는 조직 · 게이트는
// 프로젝트) 탭 줄은 말하지 않았고, 토큰 탭은 내 것과 조직 전체의 것을 섞었다. `/settings` 는 둘째 칸에 착지했고,
// 게이트 정책의 대상은 주소에 없어 프로젝트에서 곧장 갈 수 없었으며, 조직을 바꾸면 설정을 떠나 홈으로 튕겼다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const ORG_ADMIN = {
  id: 'u-1',
  display_name: '관리자',
  memberships: [
    { org_slug: 'default', org_name: 'Default', project_slug: null, roles: ['admin'] },
    { org_slug: 'acme', org_name: 'Acme', project_slug: null, roles: ['viewer'] },
  ],
};
const DEVELOPER = {
  id: 'u-2',
  display_name: '도현',
  memberships: [
    { org_slug: 'default', org_name: 'Default', project_slug: 'clemvion', roles: ['developer'] },
  ],
};

let calls: string[] = [];

function stub(me: unknown): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      const json = /\/orgs\/[^/]+\/projects/.test(u)
        ? [
            { id: 'p-1', slug: 'clemvion', name: 'Clemvion' },
            { id: 'p-2', slug: 'sudoku', name: '스도쿠' },
          ]
        : /\/projects\/(clemvion|sudoku)$/.test(u)
          ? {
              id: 'p-x',
              slug: u.split('/').at(-1),
              name: u.endsWith('sudoku') ? '스도쿠' : 'Clemvion',
            }
          : u.endsWith('/me')
            ? me
            : /\/orgs\/[^/]+\/(members|tokens)/.test(u) || u.endsWith('/me/tokens')
              ? []
              : { items: [], summary: {}, next_cursor: null, memberships: [], count: 0 };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  localStorage.setItem('nerv.last-project.default', 'clemvion');
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string, me: unknown = ORG_ADMIN) {
  stub(me);
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

/** 사이드바의 [설정] 아래 목록 — 넓은 폭의 자리다 */
const railNav = async (): Promise<HTMLElement> =>
  within(await screen.findByTestId('nav-rail')).findByTestId('settings-nav');

describe('설정의 항목은 범위로 묶인다 (SET-06)', () => {
  it('무리는 조직 → 프로젝트 → 나 순서이고, 무리마다 이름이 있다', async () => {
    mount('/settings/members');
    const nav = await railNav();
    await waitFor(() => expect(within(nav).getByTestId('settings-nav-org-tokens')).toBeDefined());
    expect(
      within(nav)
        .getAllByTestId(/^settings-group-/)
        .map((g) => g.textContent),
    ).toEqual(['조직', '프로젝트', '나 · 모든 조직']);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual([
      '/settings/org',
      '/settings/members',
      '/settings/org-tokens',
      // 프로젝트 — 프로젝트 목록이 먼저다(2026-09-26 · REQ-WEB-242)
      '/settings/projects',
      '/settings/gates',
      // 나 — 내 계정이 먼저다(2026-09-25 · REQ-WEB-229)
      '/settings/account',
      '/settings/tokens',
    ]);
    expect(within(nav).getByTestId('settings-nav-members').getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('연동은 Phase 2 — 항목만 비활성으로 보인다', async () => {
    mount('/settings/members');
    const nav = await railNav();
    const integrations = within(nav).getByText('연동').closest('[aria-disabled]');
    expect(integrations?.getAttribute('aria-disabled')).toBe('true');
    expect(integrations?.tagName).not.toBe('A');
  });

  it('조직 admin 이 아니면 조직 전체 토큰을 그리지 않는다 (REQ-WEB-168)', async () => {
    mount('/settings/members', DEVELOPER);
    const nav = await railNav();
    await waitFor(() => expect(within(nav).getByTestId('settings-nav-members')).toBeDefined());
    expect(within(nav).queryByTestId('settings-nav-org-tokens')).toBeNull();
  });

  it('설정 밖에서는 펼치지 않는다 — 도움말의 차례와 같은 규칙', async () => {
    mount('/inbox');
    const rail = await screen.findByTestId('nav-rail');
    await within(rail).findByTestId('rail-settings');
    expect(within(rail).queryByTestId('settings-nav')).toBeNull();
  });

  it('상단에 어느 조직의 설정인지 적혀 있다', async () => {
    mount('/settings/members');
    await waitFor(() =>
      expect(screen.getByTestId('settings-heading').textContent).toBe('설정 — Default'),
    );
  });

  it('/settings 는 첫 무리의 첫 항목(조직 정보)을 연다', async () => {
    const router = mount('/settings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/org'));
    expect(await screen.findByRole('heading', { name: 'Default 조직 정보' })).toBeDefined();
  });

  // 조직과 프로젝트를 나눴다(2026-09-26 · REQ-WEB-242) — 옛 주소는 새 주소로 보낸다
  it('옛 주소 /settings/workspace 는 조직 정보로, ?new=1 이면 프로젝트 만들기로 간다', async () => {
    const router = mount('/settings/workspace');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/org'));
    cleanup();
    const again = mount('/settings/workspace?new=1');
    await waitFor(() => expect(again.state.location.href).toBe('/settings/projects?new=1'));
  });
});

describe('조직 전체 토큰은 조직 묶음의 자기 화면이다 (REQ-WEB-227 · 168)', () => {
  it('내 토큰 화면은 조직 admin 에게 그리로 가는 길만 남긴다', async () => {
    mount('/settings/tokens');
    const pointer = await screen.findByTestId('org-tokens-pointer');
    expect(within(pointer).getByRole('link').getAttribute('href')).toBe('/settings/org-tokens');
    expect(screen.queryByTestId('org-token-project')).toBeNull();
  });

  it('조직 admin 이 아니면 부르지도 않고, 누가 볼 수 있는지 말한다', async () => {
    mount('/settings/org-tokens', DEVELOPER);
    expect(await screen.findByTestId('read-only-notice')).toBeDefined();
    await waitFor(() => expect(calls.some((u) => u.endsWith('/me'))).toBe(true));
    expect(calls.some((u) => /\/orgs\/[^/]+\/tokens/.test(u))).toBe(false);
  });
});

describe('게이트 정책의 대상은 주소에 산다 (NAV-10)', () => {
  it('?project= 로 그 프로젝트가 골라져 온다', async () => {
    mount('/settings/gates?project=sudoku');
    await waitFor(() =>
      expect((screen.getByTestId('gates-project') as HTMLSelectElement).value).toBe('sudoku'),
    );
    expect(await screen.findByRole('heading', { name: /스도쿠/ })).toBeDefined();
  });

  it('고르면 주소가 바뀐다 — 이력은 쌓지 않는다', async () => {
    const router = mount('/settings/gates?project=sudoku');
    const select = (await screen.findByTestId('gates-project')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('sudoku'));
    const before = router.history.length;
    fireEvent.change(select, { target: { value: 'clemvion' } });
    await waitFor(() => expect(router.state.location.search).toEqual({ project: 'clemvion' }));
    expect(router.history.length).toBe(before);
  });

  it('이 조직에 없는 프로젝트면 기억한 프로젝트로 떨어진다', async () => {
    mount('/settings/gates?project=ghost');
    await waitFor(() =>
      expect((screen.getByTestId('gates-project') as HTMLSelectElement).value).toBe('clemvion'),
    );
  });

  it('프로젝트 메뉴의 [설정]이 그 프로젝트를 실어 간다', async () => {
    mount('/p/clemvion/tasks');
    const link = await screen.findByTestId('rail-project-settings');
    expect(link.getAttribute('href')).toBe('/settings/gates?project=clemvion');
  });
});

describe('조직을 바꾸면 같은 화면으로 돌아온다 (SET-07)', () => {
  const orgLink = async (name: string): Promise<HTMLElement> => {
    fireEvent.click(await screen.findByTestId('org-switcher'));
    return (await screen.findByText(name)).closest('a') as HTMLElement;
  };

  it('설정에서 바꾸면 ?next= 가 그 설정 화면이다', async () => {
    mount('/settings/members');
    const link = await orgLink('Acme');
    expect(link.getAttribute('href')).toBe('/o/acme?next=%2Fsettings%2Fmembers');
  });

  it('프로젝트 화면에서 바꾸면 싣지 않는다 — 새 조직에는 그 프로젝트가 없다', async () => {
    mount('/p/clemvion/tasks');
    const link = await orgLink('Acme');
    expect(link.getAttribute('href')).toBe('/o/acme');
  });
});
