// 조용한 실패 — 앱 전체의 배선 (REQ-WEB-196 · screens.md §1.5)
//
// `onError` 를 적지 않은 쓰기가 실패하면 2026-09-24 까지 화면은 아무 말도 하지 않았다.
// 이 검사는 함수가 아니라 **배선**을 본다: 앱이 쓰는 쿼리 클라이언트(`createQueryClient`)와
// 셸이 거는 처리기(__root)가 이어져 있어야, 처리기 없는 쓰기의 실패가 토스트로 선다.
// 알림 센터의 [모두 읽음]이 그런 쓰기 하나다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR, NERV_EVENT, ko } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { createQueryClient } from '../lib/query-client.js';
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

const UNREAD = {
  id: 'n1',
  state: 'unread',
  event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
  spec_key: 'SUD-VISION',
  project_slug: 'sudoku',
  actor_name: '지민',
  is_agent: false,
  occurred_at: '2026-09-24T00:00:00Z',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url);
      if (init?.method === 'POST') {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            ok: false,
            code: NERV_ERROR.FORBIDDEN,
            message: '',
            details: {},
            retry_after_s: null,
            next_actions: [],
          }),
        };
      }
      if (u.includes('unread-count')) {
        return { ok: true, status: 200, json: async () => ({ count: 1, immediate: 0 }) };
      }
      if (u.includes('/me/notifications')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [UNREAD], next_cursor: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'u1',
          display_name: '나',
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

describe('처리기 없는 쓰기의 실패가 말한다 (REQ-WEB-196)', () => {
  it('[모두 읽음]이 거절되면 경고 토스트가 선다 — 표(§1.5)의 문장으로', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/notifications'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={createQueryClient()}>
          <RealtimeProvider>
            <RouterProvider router={router as never} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );

    fireEvent.click(await screen.findByTestId('mark-all-read'));
    await waitFor(() => {
      const alerts = screen
        .getAllByTestId('toast')
        .filter((el) => el.getAttribute('role') === 'alert');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.textContent).toContain(ko['apierr.forbidden']);
    });
  });
});
