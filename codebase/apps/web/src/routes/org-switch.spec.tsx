// 조직 전환이 헤더까지 닿는다 — REQ-WEB-190 (2026-09-24 사람 보고)
//
// "상단 메뉴에서 조직을 변경하면, 프로젝트도 해당 조직의 프로젝트로 재선택이 되어야 하는데
// 기존에 선택되었던 프로젝트가 선택되어 있는 상태야."
//
// 헤더는 앱에서 한 번만 마운트된다. 그런데 선택된 조직을 마운트할 때 한 번 읽고 끝이라, 조직을
// 바꾸면 새로 그려진 본문은 새 조직을, **헤더는 옛 조직과 옛 프로젝트를** 가리켰다. 마지막으로
// 본 프로젝트도 조직과 무관한 키 하나라, 두 조직에 같은 slug 가 있으면 옛 것이 그대로 골라졌다.
// 이 파일은 셸을 **다시 마운트하지 않고** 라우터만 움직여 그 상황을 그대로 만든다.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { acceptedLanding } from '../components/invitation-cards.js';
import { safeNext } from './o.$org.js';
import { routeTree } from '../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

/** 두 조직 모두 `shared` 를 갖는다 — 같은 slug 가 옛 선택을 살려 두던 바로 그 모양이다 */
const PROJECTS: Record<string, { id: string; slug: string; name: string }[]> = {
  nerv: [
    { id: 'n-1', slug: 'shared', name: 'NERV 공용' },
    { id: 'n-2', slug: 'clemvion', name: 'clemvion' },
  ],
  acme: [
    { id: 'a-1', slug: 'acme-web', name: 'Acme 웹' },
    { id: 'a-2', slug: 'shared', name: 'Acme 공용' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const org = /\/orgs\/([^/]+)\/projects/.exec(path)?.[1];
      const json =
        org !== undefined
          ? (PROJECTS[org] ?? [])
          : path.endsWith('/me')
            ? {
                id: 'u-1',
                display_name: '지민',
                memberships: [
                  { org_slug: 'nerv', org_name: 'NERV', project_slug: null, roles: ['admin'] },
                  { org_slug: 'acme', org_name: 'Acme', project_slug: null, roles: ['planner'] },
                ],
              }
            : { items: [], summary: {}, next_cursor: null, memberships: [], count: 0 };
      return { ok: true, status: 200, json: async () => json };
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

const orgButton = () => screen.getByTestId('org-switcher');
const projectButton = () => screen.getByTestId('project-switcher');

describe('조직을 바꾸면 헤더가 따라온다 (REQ-WEB-190)', () => {
  it('셸을 다시 그리지 않아도 조직과 프로젝트가 새 조직의 것이 된다', async () => {
    localStorage.setItem('nerv.last-org', 'nerv');
    const router = mount('/p/shared/tasks');
    await waitFor(() => expect(projectButton().textContent).toContain('NERV 공용'));

    await act(() => router.navigate({ to: '/o/$org', params: { org: 'acme' } }));

    await waitFor(() => expect(orgButton().textContent).toContain('Acme'));
    // 옛 조직에서 보던 `shared` 는 Acme 에도 있지만 **Acme 의 기억이 없으니** 첫 프로젝트다
    await waitFor(() => expect(projectButton().textContent).toContain('Acme 웹'));
    expect(router.state.location.pathname).toBe('/');
  });

  it('전환했다고 말한다 — 화면이 없는 전환은 됐는지 알 수 없다', async () => {
    localStorage.setItem('nerv.last-org', 'nerv');
    const router = mount('/');
    await waitFor(() => expect(orgButton().textContent).toContain('NERV'));
    await act(() => router.navigate({ to: '/o/$org', params: { org: 'acme' } }));
    expect(await screen.findByText('Acme(으)로 전환했습니다.')).toBeDefined();
  });

  it('마지막 프로젝트는 조직마다 기억한다 — 돌아오면 그 조직에서 보던 것이다', async () => {
    localStorage.setItem('nerv.last-org', 'nerv');
    localStorage.setItem('nerv.last-project.nerv', 'clemvion');
    localStorage.setItem('nerv.last-project.acme', 'shared');
    const router = mount('/');
    await waitFor(() => expect(projectButton().textContent).toContain('clemvion'));

    await act(() => router.navigate({ to: '/o/$org', params: { org: 'acme' } }));
    await waitFor(() => expect(projectButton().textContent).toContain('Acme 공용'));

    await act(() => router.navigate({ to: '/o/$org', params: { org: 'nerv' } }));
    await waitFor(() => expect(projectButton().textContent).toContain('clemvion'));
  });

  it('조직을 모르는 옛 키는 읽지 않는다 — 다른 조직의 같은 slug 를 되살리지 않게', async () => {
    localStorage.setItem('nerv.last-org', 'acme');
    localStorage.setItem('nerv.last-project', 'shared');
    mount('/');
    await waitFor(() => expect(projectButton().textContent).toContain('Acme 웹'));
  });

  it('속하지 않은 조직으로는 바꾸지 않는다 — "바꿨다" 고 말하지도 않는다', async () => {
    localStorage.setItem('nerv.last-org', 'nerv');
    const router = mount('/');
    await waitFor(() => expect(orgButton().textContent).toContain('NERV'));
    await act(() => router.navigate({ to: '/o/$org', params: { org: 'ghost' } }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(localStorage.getItem('nerv.last-org')).toBe('nerv');
    expect(screen.queryByText(/전환했습니다/)).toBeNull();
  });

  it('`?next=` 가 있으면 그 자리로 착지한다 — 초대를 수락한 사람을 그 프로젝트로', async () => {
    localStorage.setItem('nerv.last-org', 'nerv');
    const router = mount('/');
    await waitFor(() => expect(orgButton().textContent).toContain('NERV'));
    await act(() => router.navigate(acceptedLanding('acme', 'acme-web')));
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/acme-web'));
    await waitFor(() => expect(orgButton().textContent).toContain('Acme'));
  });
});

describe('착지 경로', () => {
  it('앱 안의 경로만 받는다 — 프로토콜 상대 주소는 밖으로 나간다', () => {
    expect(safeNext('/p/acme-web')).toBe('/p/acme-web');
    expect(safeNext('//evil.example/x')).toBeUndefined();
    expect(safeNext('https://evil.example')).toBeUndefined();
    expect(safeNext(3)).toBeUndefined();
  });

  it('조직 초대는 조직 전환만, 프로젝트 초대는 그 프로젝트로', () => {
    expect(acceptedLanding('acme', null)).toEqual({
      to: '/o/$org',
      params: { org: 'acme' },
      search: {},
    });
    expect(acceptedLanding('acme', 'acme-web').search).toEqual({ next: '/p/acme-web' });
  });
});
