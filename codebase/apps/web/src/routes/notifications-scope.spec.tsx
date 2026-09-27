// 알림의 범위 칸 — 한 목록을 조직 · 프로젝트 하나로 좁혀 보고, 보이는 것만 처리한다
// (2026-09-27 사람 결정 N1 · N4 · REQ-WEB-253~255)
//
// 알림은 내가 속한 모든 조직의 것을 한 목록에 모은다. 한 프로젝트의 일만 보고 처리하고 싶을 때
// 방법이 없었다 — [모두 읽음]은 필터와 상관없이 전부를 바꿨다. 목록은 하나로 두고, 칸이 그 목록을
// 좁힌다. 헤더 배지는 그대로 모든 조직을 센다(REQ-WEB-193).

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_EVENT } from '@nerv/schema';
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

const SCOPES = {
  items: [
    {
      org_slug: 'default',
      org_name: 'Default',
      project_slug: 'clemvion',
      project_name: 'clemvion',
      unread: 3,
      immediate: 3,
    },
    {
      org_slug: 'default',
      org_name: 'Default',
      project_slug: 'sudoku',
      project_name: 'sudoku',
      unread: 214,
      immediate: 12,
    },
    {
      org_slug: 'acme',
      org_name: 'Acme',
      project_slug: 'web-console',
      project_name: 'web-console',
      unread: 9,
      immediate: 0,
    },
  ],
  total: { unread: 226, immediate: 15 },
};

const ROW = {
  id: 'n1',
  state: 'unread',
  importance: 'immediate',
  event_type: NERV_EVENT.SPEC_APPROVED,
  spec_key: 'SPC-SUD-012',
  version_no: 4,
  org_slug: 'default',
  org_name: 'Default',
  project_slug: 'sudoku',
  project_name: 'sudoku',
  actor_name: '지민',
  is_agent: false,
  created_at: '2026-09-27 09:00:00.123456+00',
  occurred_at: '2026-09-27T09:00:00Z',
};

let asked: string[];
let posted: { url: string; body: unknown }[];

beforeEach(() => {
  asked = [];
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      asked.push(u);
      if (init?.method === 'POST') {
        posted.push({ url: u, body: init.body === undefined ? undefined : JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => ({ ok: true, marked: 12 }) };
      }
      if (u.includes('/me/notifications/scopes')) {
        return { ok: true, status: 200, json: async () => SCOPES };
      }
      if (u.includes('unread-count')) {
        return { ok: true, status: 200, json: async () => ({ count: 226, immediate: 15 }) };
      }
      if (u.includes('/me/notifications')) {
        return { ok: true, status: 200, json: async () => ({ items: [ROW], next_cursor: null }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          memberships: [
            { org_slug: 'default', project_slug: 'sudoku', roles: ['planner'] },
            { org_slug: 'acme', project_slug: 'web-console', roles: ['planner'] },
          ],
          count: 0,
          summary: {},
        }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): ReturnType<typeof createMemoryHistory> {
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

describe('범위 칸 — 조직 → 프로젝트와 서버가 센 수 (REQ-WEB-253)', () => {
  it('맨 위는 모든 조직이고, 조직이 둘이면 조직 줄 아래에 프로젝트가 있다', async () => {
    renderAt('/notifications');
    const rail = await screen.findByTestId('scope-rail');
    await waitFor(() => expect(within(rail).getByTestId('scope-all').textContent).toContain('226'));
    expect(within(rail).getByTestId('scope-all').textContent).toContain('15');
    expect(within(rail).getByTestId('scope-org-default').textContent).toContain('217');
    expect(within(rail).getByTestId('scope-project-default-sudoku').textContent).toContain('214');
    // 중요 알림이 없는 프로젝트는 붉은 수를 그리지 않는다 — 회색 수만 남는다
    expect(within(rail).getByTestId('scope-project-acme-web-console').textContent).toBe(
      'Acme / web-console9',
    );
    // 모든 조직을 보는 동안에는 "모든 조직" 이 골라져 있다
    expect(within(rail).getByTestId('scope-all').getAttribute('aria-current')).toBe('true');
  });

  it('프로젝트를 고르면 주소와 목록 요청이 그 프로젝트로 좁혀지고, 거름은 그대로다', async () => {
    const history = renderAt('/notifications?filter=unread');
    fireEvent.click(await screen.findByTestId('scope-project-default-sudoku'));
    await waitFor(() => expect(history.location.search).toContain('project=sudoku'));
    expect(history.location.search).toContain('org=default');
    expect(history.location.search).toContain('filter=unread');
    await waitFor(() =>
      expect(
        asked.some(
          (u) =>
            u.includes('/me/notifications?') &&
            u.includes('org=default') &&
            u.includes('project=sudoku') &&
            u.includes('state=unread'),
        ),
      ).toBe(true),
    );
  });

  it('칸의 줄은 링크다 — 좁힌 목록의 주소를 가진다', async () => {
    renderAt('/notifications?filter=important');
    const link = await screen.findByTestId('scope-project-default-sudoku');
    expect(link.getAttribute('href')).toBe(
      '/notifications?filter=important&org=default&project=sudoku',
    );
  });
});

describe('좁혀 본 화면 (REQ-WEB-253 · 255)', () => {
  it('머리가 범위를 말하고, 줄의 조직 · 프로젝트 표시는 빠진다', async () => {
    renderAt('/notifications?org=default&project=sudoku');
    await screen.findByText(
      'Default / sudoku의 알림입니다. 왼쪽 칸에서 다른 프로젝트나 모든 조직을 고를 수 있습니다.',
    );
    const row = await screen.findByTestId('notification-row');
    expect(within(row).queryByTestId('scope-badge')).toBeNull();
  });

  it('다른 프로젝트의 중요 알림을 한 줄로 알리고, 누르면 모든 조직의 중요 알림으로 간다', async () => {
    const history = renderAt('/notifications?org=default&project=sudoku');
    const hint = await screen.findByTestId('notif-elsewhere');
    expect(hint.textContent).toContain('다른 프로젝트에 중요 알림 3건');
    fireEvent.click(hint);
    await waitFor(() => expect(history.location.search).toBe('?filter=important'));
  });

  it('모든 조직을 볼 때는 그 줄이 없다 — 배지가 이미 전부를 센다', async () => {
    renderAt('/notifications');
    await screen.findByTestId('scope-rail');
    await screen.findByTestId('notification-row');
    expect(screen.queryByTestId('notif-elsewhere')).toBeNull();
  });
});

describe('[모두 읽음]은 보이는 범위만 바꾼다 (사람 결정 N4 · REQ-WEB-254)', () => {
  it('단추 이름이 범위와 건수를 말하고, 범위 · 거름 · 기준 시각을 함께 보낸다', async () => {
    renderAt('/notifications?org=default&project=sudoku&filter=important');
    const button = await screen.findByTestId('mark-all-read');
    await waitFor(() =>
      expect(button.textContent).toBe('Default / sudoku 중요 알림 12건 모두 읽음'),
    );
    await screen.findByTestId('notification-row');
    fireEvent.click(button);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.url).toContain('/me/notifications/read-all');
    expect(posted[0]?.body).toEqual({
      org: 'default',
      project: 'sudoku',
      importance: 'immediate',
      until: '2026-09-27 09:00:00.123456+00',
    });
  });

  it('모든 조직 · 전체에서는 예전처럼 전부다 — 범위 없이 기준 시각만 보낸다', async () => {
    renderAt('/notifications');
    const button = await screen.findByTestId('mark-all-read');
    expect(button.textContent).toBe('모두 읽음');
    await screen.findByTestId('notification-row');
    fireEvent.click(button);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ until: '2026-09-27 09:00:00.123456+00' });
  });
});
