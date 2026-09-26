// 헤더의 연결 표시 — 실시간만 끊긴 것은 배너가 아니다 (2026-09-26 — 사람 결정 D8 · REQ-WEB-002 개정 · REQ-WEB-235)
//
// 실시간만 끊긴 동안(REST 는 닿는다) 전폭 호박 배너가 섰다 — 폴링으로 멀쩡히 도는 화면이 한 줄 밀리고, 쓰기도
// 되는데 경고처럼 읽혔다. 그 단계는 헤더의 작은 점(+ "실시간 끊김")이고, 누르면 무엇이 되고 안 되는지 말한다.
// 배너는 "아무것도 저장되지 않는다" 는 오프라인 하나에 남는다(그때는 쓰기가 잠긴다).

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { resetReachabilityForTesting } from '../lib/api.js';
import { routeTree } from '../routeTree.gen';

/** 소켓이 단 처리기 — 검사가 연결·끊김을 직접 일으킨다 */
const socket = vi.hoisted(() => ({ handlers: {} as Record<string, () => void> }));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, fn: () => void) => {
      socket.handlers[event] = fn;
    },
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  resetReachabilityForTesting();
  socket.handlers = {};
  cleanup();
});

function mount(path = '/inbox'): void {
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

function reachable(): void {
  const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) =>
      String(url).endsWith('/me')
        ? ok({ id: 'u-1', display_name: '지민', memberships: [] })
        : ok({ items: [], summary: {}, next_cursor: null, memberships: [], count: 0 }),
    ),
  );
}

/** 소켓이 만들어질 때까지 — 로그인한 사용자가 확인된 뒤에만 붙는다 */
async function connected(): Promise<void> {
  await waitFor(() => expect(socket.handlers['disconnect']).toBeDefined());
  act(() => socket.handlers['connect']?.());
}

describe('실시간만 끊기면 헤더의 점이다 (REQ-WEB-002)', () => {
  it('붙어 있으면 아무것도 세우지 않는다 — 정상은 조용하다', async () => {
    reachable();
    mount();
    await connected();
    expect(screen.queryByTestId('connection-mark')).toBeNull();
    expect(screen.queryByTestId('connection-banner')).toBeNull();
    expect(screen.getByTestId('connection-live').textContent).toBe('');
  });

  it('끊기면 배너가 아니라 헤더에 "실시간 끊김" 이 서고, 보조기기에는 한 번 알린다', async () => {
    reachable();
    mount();
    await connected();
    act(() => socket.handlers['disconnect']?.());

    const mark = screen.getByTestId('connection-mark');
    expect(mark.getAttribute('data-level')).toBe('ws');
    // 색만으로 말하지 않는다(REQ-WEB-033) — 글자가 곁에 서고, 그것이 단추의 이름이다
    expect(mark.textContent).toBe('실시간 끊김');
    expect(screen.getByRole('button', { name: '실시간 끊김' })).toBe(mark);
    // 화면을 밀던 전폭 배너는 없다
    expect(screen.queryByTestId('connection-banner')).toBeNull();
    // 늘 있는 알림 자리에 문장이 들어온다 — 새로 생긴 알림 자리는 읽히지 않는 보조기기가 있다
    expect(screen.getByTestId('connection-live').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('connection-live').textContent).toContain('주기적으로');
  });

  it('누르면 무엇이 되고 안 되는지와 언제 끊겼는지 말한다 — Esc 로 닫고 그 단추로 돌아간다', async () => {
    reachable();
    mount();
    await connected();
    act(() => socket.handlers['disconnect']?.());

    const mark = screen.getByTestId('connection-mark');
    expect(mark.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(mark);
    expect(mark.getAttribute('aria-expanded')).toBe('true');
    const detail = screen.getByTestId('connection-detail');
    expect(detail.textContent).toContain('실시간 갱신이 끊겼습니다');
    expect(detail.textContent).toContain('15초마다 새로 받습니다');
    expect(detail.textContent).toContain('수정은 그대로 할 수 있고');
    expect(detail.textContent).toMatch(/\d+초 전 끊겼습니다/);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('connection-detail')).toBeNull();
    expect(document.activeElement).toBe(mark);
  });

  it('다시 붙으면 표시가 거둬진다', async () => {
    reachable();
    mount();
    await connected();
    act(() => socket.handlers['disconnect']?.());
    expect(screen.getByTestId('connection-mark')).toBeDefined();
    act(() => socket.handlers['connect']?.());
    expect(screen.queryByTestId('connection-mark')).toBeNull();
    expect(screen.getByTestId('connection-live').textContent).toBe('');
  });
});

describe('오프라인이면 헤더는 회색 ⚠ 이고 배너가 함께 선다 (REQ-WEB-235)', () => {
  it('쓰기가 잠기는 단계라 배너를 지킨다 — 헤더의 표시도 모양이 다르다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    mount();
    const banner = await screen.findByTestId('connection-banner');
    expect(banner.getAttribute('data-level')).toBe('offline');
    const mark = screen.getByTestId('connection-mark');
    expect(mark.getAttribute('data-level')).toBe('offline');
    expect(mark.textContent).toContain('오프라인');
    expect(mark.className).toContain('bg-status-idle');
    // 오프라인 표시는 누르는 것이 아니다 — 배너가 이미 다 말한다
    expect(mark.tagName).toBe('SPAN');
  });
});
