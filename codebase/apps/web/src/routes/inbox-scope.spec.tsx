// 받은 요청의 조직 · 프로젝트 칸과 프로젝트 안의 진입점 (2026-09-27 사람 결정 N1 · N2 · REQ-WEB-256~258)
//
// 받은 요청은 하나다(FR-14). 칸은 그 목록을 조직 · 프로젝트 하나로 좁히고, 사이드바의 프로젝트 줄은 그
// 프로젝트에서 내가 결정할 수를 보인다 — 알림 수는 두지 않는다(N2). 개요 · 홈 · ⌘K 는 거르지 않은 목록
// 대신 그 프로젝트로 좁힌 주소를 연다.

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

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const SCOPES = {
  items: [
    {
      org_slug: 'nerv',
      org_name: 'NERV',
      project_slug: 'clemvion',
      project_name: 'Clemvion',
      pending: 5,
      actionable: 3,
    },
    {
      org_slug: 'nerv',
      org_name: 'NERV',
      project_slug: 'sudoku',
      project_name: 'Sudoku',
      pending: 0,
      actionable: 0,
    },
  ],
  total: { pending: 5, actionable: 3 },
};

let asked: string[];

beforeEach(() => {
  localStorage.clear();
  asked = [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      asked.push(u);
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
      if (u.includes('/approvals/scopes')) return ok(SCOPES);
      if (u.includes('/approvals?'))
        return ok({ items: [], next_cursor: null, total: 5, actionable_total: 3 });
      if (u.includes('/me/notifications/unread-count')) return ok({ count: 9, immediate: 2 });
      return ok({ items: [], summary: {}, next_cursor: null, memberships: [], count: 0 });
    }),
  );
  // 사이드바가 서는 폭이라고 말한다 — jsdom 에는 matchMedia 가 없어 기본은 좁은 화면이다
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string): ReturnType<typeof createMemoryHistory> {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
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
  return history;
}

describe('받은 요청의 조직 · 프로젝트 칸 (REQ-WEB-256)', () => {
  it('칸은 결정할 수를 보이고, 고르면 목록 요청과 주소가 그 프로젝트로 좁혀진다', async () => {
    const history = mount('/inbox');
    const rail = await screen.findByTestId('scope-rail');
    await waitFor(() =>
      expect(within(rail).getByTestId('scope-project-nerv-clemvion').textContent).toBe('Clemvion3'),
    );
    // 결정할 것이 없는 프로젝트도 칸에 남는다
    expect(within(rail).getByTestId('scope-project-nerv-sudoku').textContent).toBe('Sudoku0');
    fireEvent.click(within(rail).getByTestId('scope-project-nerv-clemvion'));
    await waitFor(() => expect(history.location.search).toContain('project=clemvion'));
    expect(history.location.search).toContain('org=nerv');
    await waitFor(() =>
      expect(
        asked.some((u) => u.includes('/approvals?state=pending') && u.includes('project=clemvion')),
      ).toBe(true),
    );
    await screen.findByText(
      'Clemvion의 받은 요청입니다. 왼쪽 칸에서 다른 프로젝트나 모든 조직을 고를 수 있습니다.',
    );
  });

  it('탭을 바꿔도 범위는 그대로다', async () => {
    mount('/inbox?org=nerv&project=clemvion');
    const decided = await screen.findByTestId('inbox-tab-decided');
    expect(decided.getAttribute('href')).toBe('/inbox?state=decided&org=nerv&project=clemvion');
    expect(screen.getByTestId('inbox-tab-pending').getAttribute('href')).toBe(
      '/inbox?org=nerv&project=clemvion',
    );
  });
});

describe('사이드바의 프로젝트 줄은 결정할 수만 보인다 (사람 결정 N2 · REQ-WEB-257)', () => {
  it('결정할 것이 있는 프로젝트에만 수가 있고, 누르면 그 프로젝트로 좁힌 받은 요청이다', async () => {
    mount('/');
    const nav = await screen.findByTestId('nav-rail');
    const badge = await within(nav).findByTestId('rail-project-decisions-clemvion');
    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('href')).toBe('/inbox?org=nerv&project=clemvion');
    expect(badge.getAttribute('aria-label')).toBe('Clemvion에서 내가 결정할 요청 3건');
    // 0 이면 없다 — 알림 수도 두지 않는다
    expect(within(nav).queryByTestId('rail-project-decisions-sudoku')).toBeNull();
  });
});

describe('⌘K 가 이 프로젝트로 좁힌 받은 요청 · 알림을 연다 (REQ-WEB-258)', () => {
  it('프로젝트 안에서 열면 "이 프로젝트" 묶음의 [받은 요청]이 좁힌 주소로 간다', async () => {
    const history = mount('/p/clemvion/tasks');
    await screen.findByTestId('nav-rail');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const here = await screen.findByTestId('switcher-group-here');
    const labels = within(here)
      .getAllByTestId('switcher-option')
      .map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.startsWith('알림'))).toBe(true);
    const inbox = within(here)
      .getAllByTestId('switcher-option')
      .find((o) => (o.textContent ?? '').startsWith('받은 요청'))!;
    fireEvent.click(inbox);
    await waitFor(() => expect(history.location.pathname).toBe('/inbox'));
    expect(history.location.search).toContain('project=clemvion');
    expect(history.location.search).toContain('org=nerv');
  });
});
