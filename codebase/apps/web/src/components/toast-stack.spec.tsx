// 토스트 스택 (REQ-WEB-197 · screens.md §1.3)
//
// 이 자리는 네 가지를 못 했다 — 모양이 하나(경고와 성공을 가를 수 없다) · 보조기기에 알리지
// 않음 · 상한 없음(초안 저장마다 3분짜리 한 장) · 링크가 앱을 새로 적재. 검사는 그 넷을 본다.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ko } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider, TOAST_TTL_MS, useRealtime } from '../lib/realtime.js';
import type { Toast } from '../lib/realtime.js';
import { TOAST_VISIBLE_MAX, ToastStack } from './toast-stack.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

/** 검사가 토스트를 밀어 넣는 손잡이 — 공급자 안에서만 pushToast 를 얻을 수 있다 */
let push: (toast: Omit<Toast, 'id'>) => void = () => undefined;

function Harness(): React.JSX.Element {
  push = useRealtime().pushToast;
  return (
    <>
      <Outlet />
      <ToastStack />
    </>
  );
}

function renderStack(): ReturnType<typeof createMemoryHistory> {
  const root = createRootRoute({ component: Harness });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
  const spec = createRoute({
    getParentRoute: () => root,
    path: '/p/$proj/specs/$spec',
    component: () => <p data-testid="spec-page">spec</p>,
  });
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createRouter({ routeTree: root.addChildren([home, spec]), history });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={new QueryClient()}>
        <RealtimeProvider>
          <RouterProvider router={router as never} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return history;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ ok: false }) })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe('모양과 보조기기', () => {
  it('경고는 끼어들어 알리고(alert) 성공은 말이 끝난 뒤 알린다(status) — 기호로도 가른다', async () => {
    renderStack();
    await screen.findByTestId('toast-outlet');
    act(() => {
      push({ tone: 'warn', message: '권한이 없습니다' });
      push({ tone: 'ok', message: '승인했습니다' });
    });
    const [warn, ok] = screen.getAllByTestId('toast');
    expect(warn?.getAttribute('role')).toBe('alert');
    expect(warn?.textContent).toContain('⚠');
    expect(ok?.getAttribute('role')).toBe('status');
    expect(ok?.textContent).toContain('✓');
    expect(screen.getByTestId('toast-outlet').getAttribute('aria-label')).toBe(
      ko['shell.toast.region'],
    );
  });
});

describe('상한과 합치기', () => {
  it(`한 번에 ${TOAST_VISIBLE_MAX}장만 보이고 나머지는 "외 N건" 으로 말한다`, async () => {
    renderStack();
    await screen.findByTestId('toast-outlet');
    act(() => {
      for (let i = 1; i <= 5; i++) push({ tone: 'ok', message: `처리 ${i}` });
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(TOAST_VISIBLE_MAX);
    // 가장 새것이 남는다 — 방금 한 일이 가려지면 안 된다
    expect(screen.getByText('처리 5')).toBeDefined();
    expect(screen.queryByText('처리 1')).toBeNull();
    expect(screen.getByTestId('toast-overflow').textContent).toContain('외 2건');

    fireEvent.click(screen.getByText(ko['shell.toast.dismiss_all']));
    expect(screen.queryAllByTestId('toast')).toHaveLength(0);
  });

  it('같은 문서의 알림은 한 장으로 합친다 — 초안 저장마다 한 장씩 쌓이지 않게', async () => {
    renderStack();
    await screen.findByTestId('toast-outlet');
    act(() => {
      push({ tone: 'info', message: 'SPC-1 바뀜 (1)', mergeKey: 'spec:p:SPC-1' });
      push({ tone: 'info', message: 'SPC-1 바뀜 (2)', mergeKey: 'spec:p:SPC-1' });
      push({ tone: 'info', message: 'SPC-2 바뀜', mergeKey: 'spec:p:SPC-2' });
    });
    const toasts = screen.getAllByTestId('toast').map((el) => el.textContent ?? '');
    expect(toasts).toHaveLength(2);
    expect(toasts.join(' ')).toContain('SPC-1 바뀜 (2)');
    expect(toasts.join(' ')).not.toContain('SPC-1 바뀜 (1)');
  });
});

describe('수명은 종류가 정한다', () => {
  it('결재 트레일은 3분, 경고는 20초, 그 밖은 8초', async () => {
    renderStack();
    await screen.findByTestId('toast-outlet');
    vi.useFakeTimers();
    act(() => {
      push({ tone: 'ok', message: '트레일', kind: 'trail' });
      push({ tone: 'warn', message: '경고' });
      push({ tone: 'info', message: '남이 바꿈' });
    });

    act(() => vi.advanceTimersByTime(TOAST_TTL_MS.default + 1));
    expect(screen.queryByText('남이 바꿈')).toBeNull();
    expect(screen.getByText('경고')).toBeDefined();
    expect(screen.getByText('트레일')).toBeDefined();

    act(() => vi.advanceTimersByTime(TOAST_TTL_MS.warn));
    expect(screen.queryByText('경고')).toBeNull();
    expect(screen.getByText('트레일')).toBeDefined();

    act(() => vi.advanceTimersByTime(TOAST_TTL_MS.trail));
    expect(screen.queryByText('트레일')).toBeNull();
  });
});

describe('링크', () => {
  it('앱 안 경로는 라우터로 옮겨 간다 — 새로 적재하지 않는다', async () => {
    const history = renderStack();
    await screen.findByTestId('toast-outlet');
    act(() => {
      push({ tone: 'info', message: 'SPC-1 승인됨', href: '/p/clemvion/specs/SPC-1' });
    });
    fireEvent.click(screen.getByText(ko['shell.toast.open']));
    expect(await screen.findByTestId('spec-page')).toBeDefined();
    expect(history.location.pathname).toBe('/p/clemvion/specs/SPC-1');
    // 따라간 토스트는 닫힌다 — 도착한 화면 위에 방금 누른 안내가 남아 있을 이유가 없다
    expect(screen.queryByText('SPC-1 승인됨')).toBeNull();
  });
});
