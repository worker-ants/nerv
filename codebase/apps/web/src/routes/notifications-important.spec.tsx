// 알림 센터의 등급은 "중요" 이고, 거르는 칸은 늘 보인다 — REQ-WEB-218 (2026-09-25 · UI/UX 검토 P10a)
//
// 머리의 한 줄은 "결정은 받은 요청에" 라 말하는데, 바로 위의 배지는 "결정 대기 12건" 이고 필터는
// "결정이 필요한 것" 이었다 — 그 등급에는 스펙 승인됨·세션 무응답·작업 막힘처럼 결정이 아닌 것이
// 대부분이다(2026-09-24 사람 결정 D3 — 이름을 "중요" 로). 그 토글은 안 읽은 것이 있을 때만 서는
// 머리 안에 있어, 거른 채 [모두 읽음]을 누르면 토글째 사라지고 목록은 걸러진 채 갇혔다(HUB-X3).
// [모두 읽음]은 몇 건을 지웠는지 말하지 않았고, 빈 상태는 알림을 만들지 않는 "작업 완료" 를 약속했다.

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

const ITEMS = [
  {
    id: 'n1',
    state: 'unread',
    event_type: NERV_EVENT.SPEC_APPROVED,
    spec_key: 'SPC-CWC-007',
    version_no: 4,
    project_slug: 'clemvion',
    actor_name: '지민',
    is_agent: false,
    occurred_at: '2026-09-24T00:00:00Z',
  },
];

let asked: string[];
let unread: { count: number; immediate: number };
let items: typeof ITEMS;

beforeEach(() => {
  asked = [];
  unread = { count: 695, immediate: 12 };
  items = ITEMS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url);
      asked.push(u);
      if (init?.method === 'POST') {
        // 모두 읽었다 — 이제 안 읽은 것이 없다
        unread = { count: 0, immediate: 0 };
        return { ok: true, status: 200, json: async () => ({ ok: true, marked: 695 }) };
      }
      if (u.includes('unread-count')) return { ok: true, status: 200, json: async () => unread };
      if (u.includes('/me/notifications')) {
        return { ok: true, status: 200, json: async () => ({ items, next_cursor: null }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          memberships: [{ org_slug: 'default', project_slug: 'clemvion', roles: ['planner'] }],
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

describe('등급 이름은 "중요" 다 (D3)', () => {
  it('배지·칸이 "중요" 라 부르고, "결정" 이라 부르지 않는다', async () => {
    renderAt('/notifications');
    expect(await screen.findByText('중요 12건')).toBeDefined();
    expect(screen.getByTestId('notif-filter-important').textContent).toBe('중요');
    expect(document.body.textContent).not.toContain('결정 대기');
    expect(document.body.textContent).not.toContain('결정이 필요한 것');
  });

  it('알림 링크의 이름이 두 수를 다 말한다 — 배지가 없어도 왜 없는지 읽힌다', async () => {
    renderAt('/notifications');
    await screen.findByText('중요 12건');
    // 사이드바의 [알림](그리고 사이드바가 서랍으로 접힌 폭의 헤더 글리프)이 같은 이름을 든다
    const links = screen.getAllByTitle(/중요 12 · 읽지 않음 695/);
    expect(links.map((a) => a.getAttribute('href'))).toContain('/notifications');
    expect(within(screen.getByTestId('nav-rail')).getByTitle(/중요 12 · 읽지 않음 695/)).toBe(
      screen.getByTestId('rail-notifications'),
    );
  });
});

describe('거르는 칸은 늘 보이고 주소에 산다 (HUB-X3)', () => {
  it('[모두 읽음] 뒤에도 칸이 남고, 걸린 거름도 그대로 보인다', async () => {
    renderAt('/notifications?filter=important');
    await screen.findByTestId('mark-all-read');
    expect(screen.getByTestId('notif-filter-important').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('mark-all-read'));
    await waitFor(() => expect(screen.queryByTestId('mark-all-read')).toBeNull());
    // 예전에는 토글째 사라져 걸러진 목록에 갇혔다 — 칸은 남고 "전체" 로 돌아갈 수 있다
    expect(screen.getByTestId('notif-filter-important').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('notif-filter-all')).toBeDefined();
  });

  it('안 읽음은 서버에 state=unread 를 싣고 주소에 남는다', async () => {
    const history = renderAt('/notifications');
    fireEvent.click(await screen.findByTestId('notif-filter-unread'));
    await waitFor(() =>
      expect(new URLSearchParams(history.location.search).get('filter')).toBe('unread'),
    );
    await waitFor(() => expect(asked.some((u) => u.includes('state=unread'))).toBe(true));
  });

  it('거른 목록이 비면 그 거름을 말한다', async () => {
    items = [];
    renderAt('/notifications?filter=important');
    expect(await screen.findByText('중요한 알림이 없습니다.')).toBeDefined();
  });
});

describe('[모두 읽음] 과 빈 상태가 사실을 말한다 (HUB-09)', () => {
  it('[모두 읽음] 이 몇 건을 읽었는지 말한다', async () => {
    renderAt('/notifications');
    fireEvent.click(await screen.findByTestId('mark-all-read'));
    expect(await screen.findByText('695건을 읽음으로 표시했습니다.')).toBeDefined();
  });

  it('빈 상태는 알림을 만들지 않는 "작업 완료" 를 약속하지 않는다', async () => {
    items = [];
    renderAt('/notifications');
    await screen.findByText('알림이 없습니다.');
    expect(document.body.textContent).not.toContain('작업 완료');
    expect(document.body.textContent).toContain('승인 결과');
  });
});
