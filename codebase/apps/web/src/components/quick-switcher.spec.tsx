// E08-S09 — 전역 퀵 스위처 ⌘K (screens.md §1.3a · REQ-WEB-040)

import { LocaleProvider } from '../lib/i18n.js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readList, rememberVisit, togglePin } from './quick-switcher.js';
import { routeTree } from '../routeTree.gen';
import { RealtimeProvider } from '../lib/realtime.js';

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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [], summary: {}, memberships: [], count: 0 }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('최근 방문·핀은 로컬 상태다 (§1.3a — 서버 동기화는 Phase 2)', () => {
  const hit = {
    key: 'SPC-CWC-007',
    title: '웹챗 위젯',
    type: 'feature',
    doc_status: 'approved',
    anchor: null,
  };

  it('방문을 기억하고 중복을 앞으로 당긴다', () => {
    rememberVisit(hit);
    rememberVisit({ ...hit, key: 'SPC-CWC-012', title: '세션 복원' });
    rememberVisit(hit);
    expect(readList('nerv.quickswitcher.recent').map((h) => h.key)).toEqual([
      'SPC-CWC-007',
      'SPC-CWC-012',
    ]);
  });

  it('핀은 토글이다', () => {
    expect(togglePin(hit).map((h) => h.key)).toEqual(['SPC-CWC-007']);
    expect(togglePin(hit)).toEqual([]);
  });

  it('localStorage 가 막힌 환경에서도 던지지 않는다', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('access denied');
    };
    expect(readList('nerv.quickswitcher.recent')).toEqual([]);
    Storage.prototype.getItem = original;
  });
});

describe('⌘K 로 열리고 Esc 로 닫힌다 — 전 라우트 공통', () => {
  function renderApp(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <RealtimeProvider>
            <RouterProvider router={router} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  it('키보드로 열리고 키보드로 닫힌다', async () => {
    renderApp();
    // 셸이 마운트된 뒤에 눌러야 한다 — 라우트 로딩이 끝나기 전에는 리스너가 없다
    await screen.findByText('NERV');
    expect(screen.queryByTestId('quick-switcher')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByTestId('quick-switcher');
    expect(dialog).toBeDefined();

    fireEvent.keyDown(screen.getByPlaceholderText(/고정 ID/), { key: 'Escape' });
    expect(screen.queryByTestId('quick-switcher')).toBeNull();
  });

  it('빈 입력에서는 최근 방문을 보여준다 — 방금 보던 것이 대개 다음 목적지다', async () => {
    rememberVisit({
      key: 'SPC-CWC-007',
      title: '웹챗 위젯',
      type: 'feature',
      doc_status: 'draft',
      anchor: null,
    });
    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await screen.findByTestId('quick-switcher');
    expect(screen.getByText('웹챗 위젯')).toBeDefined();
  });
});

/**
 * 핀 UI(2026-09-05 감사 · 05).
 *
 * `togglePin` 과 그 테스트는 처음부터 있었는데 **화면에서 부르는 곳이 0건**이었다 —
 * 매뉴얼은 "핀으로 고정하면 목록 위에 남습니다" 라고 적고 있었고, 판정과 저장은 있는데
 * 누를 자리가 없었다. 141편짜리 트리에서 매일 여는 대여섯은 최근 방문으로 대체되지 않는다.
 */
describe('핀 — 자주 가는 곳은 밀려나지 않는다 (05)', () => {
  function renderApp(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <RealtimeProvider>
            <RouterProvider router={router} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  const older = {
    key: 'SPC-OLD',
    title: '오래된 것',
    type: 'feature',
    doc_status: 'approved',
    anchor: null,
  };
  const daily = {
    key: 'SPC-DAILY',
    title: '매일 여는 것',
    type: 'feature',
    doc_status: 'approved',
    anchor: null,
  };

  it('줄마다 고정 단추가 있고, 누르면 눌린 상태가 화면에 남는다', async () => {
    rememberVisit(daily);
    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByTestId('quick-switcher');

    const pin = screen.getByTestId('switcher-pin-SPC-DAILY');
    expect(pin.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(pin);
    await waitFor(() => {
      expect(screen.getByTestId('switcher-pin-SPC-DAILY').getAttribute('aria-pressed')).toBe(
        'true',
      );
    });
    // 저장까지 갔는가 — 다음에 열어도 남아야 한다
    expect(readList('nerv.quickswitcher.pins').map((h) => h.key)).toEqual(['SPC-DAILY']);
  });

  it('고정한 것이 최근 방문보다 위에 선다 — 그러라고 고정하는 것이다', async () => {
    // 최근 목록에서는 daily 가 아래다(older 를 나중에 방문했으므로)
    rememberVisit(daily);
    rememberVisit(older);
    togglePin(daily);

    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByTestId('quick-switcher');

    const titles = [...dialog.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(titles[0]).toContain('매일 여는 것');
    expect(titles[1]).toContain('오래된 것');
  });

  it('한 번 더 누르면 풀린다 — 켜는 길과 끄는 길이 같은 자리다', async () => {
    rememberVisit(daily);
    togglePin(daily);
    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByTestId('quick-switcher');

    fireEvent.click(screen.getByTestId('switcher-pin-SPC-DAILY'));
    await waitFor(() => {
      expect(readList('nerv.quickswitcher.pins')).toEqual([]);
    });
  });
});
