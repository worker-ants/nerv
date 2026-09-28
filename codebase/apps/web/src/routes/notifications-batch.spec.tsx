// 서버가 묶은 알림 줄 — 같은 대상은 읽을 때까지 한 줄 (2026-09-27 · 사람 결정 G2 · REQ-WEB-262)
//
// 보통 알림은 서버가 같은 사람 · 같은 대상(배치 키)이면 읽을 때까지 한 줄에 더한다. 화면은 그 줄의
// 건수(×N)와 원인을 서버의 값으로 보이고, 불러온 줄 안에서 다시 세지 않는다.

import { NERV_EVENT } from '@nerv/schema';
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

const LAST_AT = '2026-09-27 12:00:00.123456+00';
const base = {
  project_slug: 'sudoku',
  project_name: 'sudoku',
  org_slug: 'default',
  org_name: 'Default',
  event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
  subject_type: 'spec',
  subject_id: 'spec-puzzle',
  spec_key: 'SUD-FTR-PUZZLE',
  actor_name: '지민',
  is_agent: false,
};
const cause = (id: string, key: string) => ({
  event_id: id,
  occurred_at: '2026-09-27T11:59:00Z',
  actor_name: '지민',
  is_agent: false,
  because_key: key,
  task_key: null,
});

let sent: { method: string; url: string; body: unknown }[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (init?.method === 'POST') {
        sent.push({
          method: init.method,
          url: u,
          body: init.body === undefined ? undefined : JSON.parse(init.body),
        });
        return ok({ ok: true, marked: 1 });
      }
      if (u.includes('/me/notifications/scopes'))
        return ok({ items: [], total: { unread: 1, immediate: 0 } });
      if (u.includes('unread-count')) return ok({ count: 1, immediate: 0 });
      if (u.includes('/me/notifications'))
        return ok({
          items: [
            {
              ...base,
              id: 'n-open',
              state: 'unread',
              batch_key: 'spec:spec-puzzle:recheck',
              batch_size: 12,
              created_at: '2026-09-25 09:00:00+00',
              last_at: LAST_AT,
              occurred_at: '2026-09-27T12:00:00Z',
              batch_causes: [
                cause('e5', 'SUD-VISION'),
                cause('e4', 'SUD-AREA-PLAY'),
                cause('e3', 'SUD-VISION'),
                cause('e2', 'SUD-AREA-ROOM'),
                cause('e1', 'SUD-RULES'),
              ],
            },
            // 같은 대상의 읽은 묶음 — 이웃이어도 접지 않는다(따로 읽은 두 줄이다)
            {
              ...base,
              id: 'n-read',
              state: 'read',
              batch_key: 'spec:spec-puzzle:recheck',
              batch_size: 2,
              created_at: '2026-09-20 09:00:00+00',
              last_at: '2026-09-21 09:00:00+00',
              occurred_at: '2026-09-21T09:00:00Z',
              batch_causes: [cause('e0', 'SUD-VISION'), cause('e-1', 'SUD-VISION')],
            },
          ],
          next_cursor: null,
        });
      if (u.endsWith('/me'))
        return ok({
          id: 'u-1',
          display_name: '서연',
          email: 'seoyeon@example.com',
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

describe('서버가 묶은 줄 (REQ-WEB-262)', () => {
  it('줄의 ×N 은 서버가 센 수이고, 원인 문서를 셋까지 적는다 — 읽은 묶음과는 접지 않는다', async () => {
    mount('/notifications');
    const rows = await screen.findAllByTestId('notification-row');
    expect(rows).toHaveLength(2);
    const open = rows[0] as HTMLElement;
    // 앞의 ▸ 는 펼치기 표지다(REQ-WEB-276) — 수는 서버가 센 그대로다
    expect(within(open).getByTestId('notification-repeat').textContent).toBe('▸×12');
    expect(within(open).getByTestId('notification-causes').textContent).toBe(
      'SUD-VISION · SUD-AREA-PLAY · SUD-AREA-ROOM 등',
    );
    expect(within(rows[1] as HTMLElement).getByTestId('notification-repeat').textContent).toBe(
      '▸×2',
    );
  });

  it('×N 을 누르면 원인이 펼쳐지고, 받지 않은 이전 건은 수로 적는다', async () => {
    mount('/notifications');
    const rows = await screen.findAllByTestId('notification-row');
    fireEvent.click(within(rows[0] as HTMLElement).getByTestId('notification-repeat'));
    expect(screen.getAllByTestId('notification-cause')).toHaveLength(5);
    expect(screen.getByTestId('notification-cause-older').textContent).toBe('그 전의 알림 7건');
    // 펼치기는 이동도 읽음도 아니다
    expect(sent).toEqual([]);
  });

  it('줄을 누르면 그 줄 하나를 읽는다 — 묶음 전체가 한 줄이다', async () => {
    mount('/notifications');
    const rows = await screen.findAllByTestId('notification-row');
    fireEvent.click(rows[0] as HTMLElement);
    await waitFor(() =>
      expect(sent.map((r) => r.url)).toEqual(['/api/v1/me/notifications/n-open/read']),
    );
  });

  it('[모두 읽음]의 기준 시각은 맨 위 줄의 마지막 시각이다', async () => {
    mount('/notifications');
    fireEvent.click(await screen.findByTestId('mark-all-read'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ until: LAST_AT });
  });
});
