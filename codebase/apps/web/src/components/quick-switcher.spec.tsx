// E08-S09 — 전역 퀵 스위처 ⌘K (screens.md §1.3a · REQ-WEB-040)

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <RouterProvider router={router} />
        </RealtimeProvider>
      </QueryClientProvider>,
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

    fireEvent.keyDown(screen.getByPlaceholderText(/안정 ID/), { key: 'Escape' });
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
