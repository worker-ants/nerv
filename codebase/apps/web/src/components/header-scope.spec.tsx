// 헤더가 범위를 말한다 — REQ-WEB-193 (2026-09-24 조직·프로젝트 경계 점검 · 결정 1·3)
//
// 두 선택기가 같은 모양이라 어느 쪽이 조직인지 이름표가 없었고, 조직 범위 화면(홈·받은 요청·
// 알림·설정)에서도 마지막으로 본 프로젝트가 떠 있어 그 화면이 그 프로젝트의 것처럼 읽혔다.
// 받은 요청·알림 배지는 모든 조직을 세는데 조직 선택기 바로 옆에서 지금 조직의 수로 읽혔다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  localStorage.setItem('nerv.last-project.default', 'clemvion');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      const json = /\/orgs\/[^/]+\/projects/.test(u)
        ? [
            { id: 'p-1', slug: 'clemvion', name: 'Clemvion 본편' },
            { id: 'p-2', slug: 'sudoku', name: '스도쿠' },
          ]
        : u.endsWith('/me')
          ? {
              id: 'u-1',
              display_name: '지민',
              memberships: [
                { org_slug: 'default', org_name: 'Default', project_slug: null, roles: ['admin'] },
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

// 2026-09-25 사람 결정 D1 — 두 선택기는 모든 화면에 서는 왼쪽 열로 내려갔다(REQ-WEB-225).
// 결정 3 의 목적(조직 범위 화면이 한 프로젝트의 것처럼 읽히지 않는다)은 이제 구조가 지킨다.
const currentProject = async (): Promise<HTMLElement> =>
  within(await screen.findByTestId('nav-rail')).findByTestId('rail-project-current');

describe('조직과 프로젝트에 이름표가 있다', () => {
  it('조직과 프로젝트를 이름으로 가른다 — 모양만으로는 어느 쪽이 조직인지 모른다', async () => {
    renderAt('/p/clemvion/tasks');
    const project = await currentProject();
    await waitFor(() => expect(project.getAttribute('aria-label')).toBe('프로젝트: Clemvion 본편'));
    const org = screen.getByTestId('org-switcher');
    expect(org.getAttribute('aria-label')).toBe('조직: Default');
    expect(org.textContent).toContain('조직');
    // 프로젝트 목록 머리의 이름표 — 이름만 늘어선 줄이 무엇의 목록인지 말한다
    expect(within(screen.getByTestId('nav-rail')).getByText('프로젝트')).toBeDefined();
  });
});

describe('조직 범위 화면에서는 프로젝트를 빌리지 않는다 (결정 3)', () => {
  it('프로젝트 화면에서는 그 프로젝트가 펼쳐져 있다', async () => {
    renderAt('/p/sudoku/tasks');
    const project = await currentProject();
    await waitFor(() => expect(project.textContent).toContain('스도쿠'));
    // 기억한 프로젝트(clemvion)는 목록의 한 줄이다 — 프로젝트 화면에서는 "최근" 표식도 없다
    expect(await screen.findByTestId('rail-project-clemvion')).toBeDefined();
    expect(screen.queryByTestId('project-recent')).toBeNull();
  });

  it('홈에서는 아무 프로젝트도 펼치지 않고, 기억은 목록의 "최근" 이다', async () => {
    renderAt('/');
    const rail = await screen.findByTestId('nav-rail');
    const remembered = await within(rail).findByTestId('rail-project-clemvion');
    expect(remembered.textContent).toBe('▸Clemvion 본편최근');
    expect(within(rail).queryByTestId('rail-project-current')).toBeNull();
    // 펼치지 않았으니 탭도 트리도 없다 — 홈이 그 프로젝트의 화면처럼 읽히지 않는다
    expect(within(rail).queryByRole('navigation', { name: '프로젝트' })).toBeNull();
  });

  it('홈의 최근 활동은 어느 프로젝트의 것인지 말한다', async () => {
    renderAt('/');
    expect(await screen.findByText('최근 활동 — Clemvion 본편')).toBeDefined();
  });
});

describe('배지는 모든 조직을 센다 (결정 1)', () => {
  it('헤더 링크의 이름과 화면 설명이 그렇다고 말한다', async () => {
    renderAt('/inbox');
    expect(await screen.findByRole('link', { name: '받은 요청 — 모든 조직' })).toBeDefined();
    expect(screen.getByRole('link', { name: '알림 — 모든 조직' })).toBeDefined();
    expect(await screen.findByText(/내가 속한 모든 조직의 받은 요청입니다/)).toBeDefined();
  });
});

describe('⌘K 는 어디서 찾는지 말한다', () => {
  it('프로젝트 안에서는 그 프로젝트 이름을, 밖에서는 고르라고', async () => {
    renderAt('/p/clemvion/tasks');
    await currentProject();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = (await screen.findByPlaceholderText(
      /Clemvion 본편의 스펙·작업 검색/,
    )) as HTMLInputElement;
    expect(input).toBeDefined();
    cleanup();

    // 프로젝트 밖에서도 화면·프로젝트로는 간다 — 문서 검색이 프로젝트 안의 일이라는 것만 말한다
    // (2026-09-25 개정 · REQ-WEB-193 · REQ-WEB-223)
    renderAt('/inbox');
    await screen.findByTestId('rail-project-clemvion');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(
      await screen.findByPlaceholderText(/스펙·작업은 프로젝트를 연 뒤 찾을 수 있습니다/),
    ).toBeDefined();
  });
});
