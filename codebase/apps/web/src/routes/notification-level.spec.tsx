// 프로젝트마다 알림을 받는 수준 — 모두 · 중요만 · 알리지 않음 (2026-09-27 사람 결정 N3 · REQ-WEB-259·260)
//
// 고르는 자리는 둘이다 — 알림 센터에서 한 프로젝트로 좁혔을 때, 그리고 내 계정 설정. 둘 다 같은 경로
// (`PUT /me/notifications/level`)로 보낸다. 칸의 줄은 기본이 아닌 수준을 이름 옆에 적는다.

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

let scopes: { items: Record<string, unknown>[]; total: { unread: number; immediate: number } };
let sent: { method: string; url: string; body: unknown }[];

beforeEach(() => {
  sent = [];
  scopes = {
    items: [
      {
        org_slug: 'default',
        org_name: 'Default',
        project_slug: 'clemvion',
        project_name: 'clemvion',
        unread: 3,
        immediate: 3,
        level: 'all',
      },
      {
        org_slug: 'default',
        org_name: 'Default',
        project_slug: 'sudoku',
        project_name: 'sudoku',
        unread: 12,
        immediate: 12,
        level: 'important',
      },
    ],
    total: { unread: 15, immediate: 15 },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (init?.method === 'PUT' || init?.method === 'POST') {
        const body = init.body === undefined ? undefined : JSON.parse(init.body);
        sent.push({ method: init.method, url: u, body });
        return ok({ ok: true, level: (body as { level?: string } | undefined)?.level ?? 'all' });
      }
      if (u.includes('/me/notifications/scopes')) return ok(scopes);
      if (u.includes('unread-count')) return ok({ count: 15, immediate: 15 });
      if (u.includes('/me/notifications')) return ok({ items: [], next_cursor: null });
      if (u.endsWith('/me'))
        return ok({
          id: 'u-1',
          display_name: '지민',
          email: 'jimin@example.com',
          memberships: [
            { org_slug: 'default', org_name: 'Default', project_slug: null, roles: ['planner'] },
          ],
        });
      return ok({ items: [], summary: {}, next_cursor: null, memberships: [], count: 0 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string): void {
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

describe('알림 센터에서 좁혀 본 프로젝트의 수준을 고른다 (REQ-WEB-259)', () => {
  it('지금 수준이 눌려 있고, 다른 수준을 누르면 그 프로젝트로 보낸다', async () => {
    mount('/notifications?org=default&project=sudoku');
    const control = await screen.findByTestId('notif-level');
    await waitFor(() =>
      expect(
        within(control).getByTestId('notif-level-important').getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    fireEvent.click(within(control).getByTestId('notif-level-none'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      method: 'PUT',
      url: expect.stringContaining('/me/notifications/level'),
      body: { org: 'default', project: 'sudoku', level: 'none' },
    });
    expect(await screen.findByText('sudoku 알림: 알리지 않음')).toBeDefined();
  });

  it('모든 조직을 볼 때는 고르는 칸이 없다 — 어느 프로젝트의 수준인지 모른다', async () => {
    mount('/notifications');
    await screen.findByTestId('scope-rail');
    expect(screen.queryByTestId('notif-level')).toBeNull();
  });

  it('칸의 줄은 기본이 아닌 수준을 이름 옆에 적는다', async () => {
    mount('/notifications');
    const rail = await screen.findByTestId('scope-rail');
    expect((await within(rail).findByTestId('scope-tag-default-sudoku')).textContent).toBe(
      '중요만',
    );
    expect(within(rail).queryByTestId('scope-tag-default-clemvion')).toBeNull();
  });
});

describe('내 계정의 프로젝트별 알림 (REQ-WEB-260)', () => {
  it('내가 속한 프로젝트마다 수준을 고른다', async () => {
    mount('/settings/account');
    const section = await screen.findByTestId('account-notifications');
    const clemvion = await within(section).findByTestId('account-notification-default-clemvion');
    expect(
      within(clemvion)
        .getByTestId('account-level-default-clemvion-all')
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(within(clemvion).getByTestId('account-level-default-clemvion-important'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ org: 'default', project: 'clemvion', level: 'important' });
  });
});
