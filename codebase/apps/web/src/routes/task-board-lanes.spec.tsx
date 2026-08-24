// S4 작업 보드의 레인 구성 — screens.md §2.5 정본.
//
// 보드가 전량을 한 번에 받아 화면에서 갈랐던 때가 있었다: clemvion 실측 487건 · 229 KB,
// 그 중 done 이 419건(86%)이었다(2026-08-23). 정본은 원래 `done(7d)` 창과
// "backlog 는 필터" 를 말하고 있었고, 코드가 그것을 구현하지 않았을 뿐이다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** 레인별로 무엇을 요청했는지 기록한다 — 요청 자체가 검사 대상이다 */
let asked: string[] = [];

function task(id: string, status: string): Record<string, unknown> {
  return {
    id,
    key: `CLV-T-${id}`,
    title: `작업 ${id}`,
    status,
    priority: 'P2',
    delegation_complete: true,
  };
}

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/tasks?')) {
        asked.push(u);
        const status = new URL(u, 'http://x').searchParams.get('status') ?? '';
        // blocked 는 한 건 — 접이식 레인이 뜨는지 보려면 비어 있으면 안 된다
        const n = status === 'blocked' ? 1 : status === 'done' ? 2 : 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: Array.from({ length: n }, (_, i) => task(`${status}-${i}`, status)),
            next_cursor: status === 'done' ? 'more' : null,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', items: [], memberships: [], count: 0, summary: {} }),
      };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderBoard() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks'] }),
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
  await screen.findByTestId('column-ready');
}

const laneOf = (u: string): string => new URL(u, 'http://x').searchParams.get('status') ?? '';

describe('레인 구성 (§2.5)', () => {
  it('정본의 5레인을 그리고 backlog 는 레인이 아니다', async () => {
    await renderBoard();
    for (const lane of ['ready', 'claimed', 'in_progress', 'in_review', 'done']) {
      expect(screen.getByTestId(`column-${lane}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('column-backlog')).toBeNull();
  });

  it('레인마다 따로 요청한다 — 한 목록을 받아 화면에서 가르지 않는다', async () => {
    await renderBoard();
    await waitFor(() => expect(asked.length).toBeGreaterThanOrEqual(5));
    // 상태 없는 전량 조회가 섞여 있으면 안 된다 — 그것이 229 KB 를 만들던 요청이다
    expect(asked.filter((u) => laneOf(u) === '')).toEqual([]);
  });

  it('백로그 토글을 켜야 backlog 레인이 생긴다', async () => {
    await renderBoard();
    expect(screen.queryByTestId('column-backlog')).toBeNull();
    fireEvent.click(screen.getByTestId('filter-backlog'));
    await waitFor(() => expect(screen.getByTestId('column-backlog')).toBeTruthy());
  });

  it('보관 토글은 done 레인에만 `include_archived` 를 싣는다', async () => {
    await renderBoard();
    await waitFor(() => expect(asked.length).toBeGreaterThanOrEqual(5));
    expect(asked.filter((u) => u.includes('include_archived'))).toEqual([]);

    fireEvent.click(screen.getByTestId('filter-archived'));
    await waitFor(() => expect(asked.some((u) => u.includes('include_archived'))).toBe(true));
    // 다른 레인까지 창을 열면 쿼리 키만 갈라지고 얻는 것이 없다
    for (const u of asked.filter((x) => x.includes('include_archived'))) {
      expect(laneOf(u)).toBe('done');
    }
  });

  it('한 페이지를 채운 레인은 "+" 로 뒤가 더 있음을 말한다', async () => {
    await renderBoard();
    const done = await screen.findByTestId('column-done');
    // 그냥 2 라고 적으면 사람은 그것이 전부라고 읽는다
    await waitFor(() => expect(done.textContent).toContain('2+'));
  });

  it('blocked 는 **가로줄의 한 레인**이다 — 아래에 두면 스크롤해야 닿는다', async () => {
    await renderBoard();
    // 정본은 원래 "하단 blocked 접이식 레인"이었는데 뒤집었다(2026-08-23, 사람 판단):
    // 막힌 일은 보드를 다 지나 스크롤해야 보이는 각주가 아니라 가장 먼저 보여야 하는 것이다.
    expect(screen.getByTestId('column-blocked')).toBeTruthy();
    expect(screen.queryByTestId('lane-blocked')).toBeNull();
    expect(screen.queryByTestId('blocked-toggle')).toBeNull();
  });

  it('막힘이 맨 앞이다 — 흐름보다 먼저 풀어야 할 것이기 때문', async () => {
    await renderBoard();
    // 흐름 끝(6번째)에 두면 1440px 화면에서도 잘려 "있긴 한데 안 보인다"가 된다.
    const order = screen
      .getAllByTestId(/^column-/)
      .map((n) => n.dataset['testid']?.replace('column-', ''));
    expect(order).toEqual(['blocked', 'ready', 'claimed', 'in_progress', 'in_review', 'done']);
  });
});
