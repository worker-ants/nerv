// 알림 목록 — 열 정렬과 일괄 읽음 (REQ-WEB-137 · 2026-09-04 사람 보고)
//
// 두 가지가 같은 화면에서 어긋나 있었다.
//
//   ① 읽은 행과 안 읽은 행의 **열이 어긋났다.** [읽음] 단추를 안 읽은 행에만 그렸는데,
//      `opacity-0` 이어도 **자리는 차지한다** — 보이지 않는 것과 자리를 차지하지 않는
//      것은 다르다. 그래서 프로젝트·시각 열이 행마다 다른 x 에 앉아 목록이 두 벌처럼
//      보였다.
//   ② 안 읽은 알림이 **695건**이었는데 한 건씩 지우는 것이 유일한 길이었다. 지울 수
//      없는 배지는 곧 읽지 않는 배지가 된다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** 읽음·안읽음이 섞인 목록 — 어긋남은 섞였을 때만 보인다 */
const ITEMS = [
  {
    id: 'n1',
    state: 'read',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-DSN-UI',
  },
  {
    id: 'n2',
    state: 'read',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-AREA-RANK',
  },
  {
    id: 'n3',
    state: 'unread',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-VISION',
  },
  {
    id: 'n4',
    state: 'unread',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-AREA-PLAY',
  },
].map((n) => ({
  ...n,
  project_slug: 'sudoku',
  actor_name: '지민',
  is_agent: false,
  occurred_at: '2026-09-04T00:00:00Z',
}));

let posted: string[] = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url);
      if (init?.method === 'POST') {
        posted.push(u);
        return { ok: true, status: 200, json: async () => ({ ok: true, marked: 2 }) };
      }
      if (u.includes('unread-count')) {
        return { ok: true, status: 200, json: async () => ({ count: 695 }) };
      }
      if (u.includes('/me/notifications')) {
        return { ok: true, status: 200, json: async () => ({ items: ITEMS, next_cursor: null }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          memberships: [{ org_slug: 'default', project_slug: 'sudoku', roles: ['planner'] }],
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

describe('알림 목록 — 읽음과 안읽음이 같은 열에 선다', () => {
  /**
   * **행마다 자식 수가 같아야 열이 맞는다.** 단추를 조건부로 그리면 안 읽은 행만 자식이
   * 하나 많아지고, `opacity-0` 은 그 자리를 없애 주지 않는다. 동작 칸을 모든 행에 두어
   * 그 자리를 항상 확보한다.
   */
  it('읽은 행과 안 읽은 행의 열 수가 같다', async () => {
    renderAt('/notifications');
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(4));

    const rows = screen.getAllByTestId('notification-row');
    const counts = rows.map((r) => r.children.length);
    expect(new Set(counts).size).toBe(1);

    // 섞여 있는 것이 맞는지도 본다 — 전부 읽음이면 이 테스트는 아무것도 지키지 않는다
    const states = rows.map((r) => r.getAttribute('data-state'));
    expect(new Set(states)).toEqual(new Set(['read', 'unread']));
  });
});

describe('일괄 읽음 (REQ-WEB-137)', () => {
  it('[모두 읽음] 이 한 번의 요청으로 치운다', async () => {
    renderAt('/notifications');
    await waitFor(() => expect(screen.getByTestId('mark-all-read')).toBeDefined());

    fireEvent.click(screen.getByTestId('mark-all-read'));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toContain('/me/notifications/read-all');
  });

  /** 치울 것이 없으면 단추도 없다 — 누를 수 없는 단추는 화면의 소음이다 */
  it('안 읽은 것이 없으면 단추가 없다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('unread-count')) {
          return { ok: true, status: 200, json: async () => ({ count: 0 }) };
        }
        if (u.includes('/me/notifications')) {
          return { ok: true, status: 200, json: async () => ({ items: [], next_cursor: null }) };
        }
        return { ok: true, status: 200, json: async () => ({ items: [], memberships: [] }) };
      }),
    );
    renderAt('/notifications');
    await waitFor(() => expect(screen.queryByTestId('mark-all-read')).toBeNull());
  });
});
