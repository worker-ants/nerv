// 못 누르는 단추는 까닭을 말한다 · 오프라인이면 쓰기 단추가 잠긴다
// (2026-09-25 · UI/UX 검토 SYS-08 · SYS-09 · D8 · REQ-WEB-003 · REQ-WEB-235)
//
// 비활성 단추는 사유를 `title` 로 달거나 잊었다. `title` 은 마우스를 올려야 뜨고 `disabled` 단추는 포커스를 받지
// 않아, 키보드·터치로는 사유에 닿을 길이 없었다. 그리고 배너가 "오프라인 — 읽기 전용" 이라 말하는 동안 [승인]·
// [저장]이 살아 있었다 — 누르면 실패 토스트가 하나 더 뜰 뿐이었다. 두 배너 단계는 같은 호박색 한 줄이었다.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider, useRealtime } from '../../lib/realtime.js';
import { resetReachabilityForTesting } from '../../lib/api.js';
import { routeTree } from '../../routeTree.gen';
import { Button } from './primitives.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  resetReachabilityForTesting();
  cleanup();
});

describe('잠긴 단추는 까닭을 말한다 (REQ-WEB-003)', () => {
  it('사유가 있으면 포커스가 남는 잠금이다 — 설명으로 읽히고 누름은 무시된다', () => {
    const onClick = vi.fn();
    render(
      <Button disabled disabledReason="조직 admin 만 합니다" onClick={onClick}>
        저장
      </Button>,
    );
    const button = screen.getByRole('button', { name: '저장' });
    // 이름은 단추의 글자 그대로다 — 사유가 이름에 섞이지 않는다
    expect(button.textContent).toBe('저장');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('data-reason')).toBe('조직 admin 만 합니다');
    expect(
      document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('조직 admin 만 합니다');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('잠긴 제출 단추는 폼을 보내지 않는다 — Enter 의 암묵 제출도 그 클릭으로 온다', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" disabled disabledReason="권한이 없습니다">
          보내기
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('사유 없는 비활성은 전처럼 disabled 다 — 보내는 중 같은 잠깐의 것', () => {
    render(<Button disabled>저장</Button>);
    const button = screen.getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('data-reason')).toBeNull();
  });

  it('켜진 단추에는 사유를 달지 않는다 — 사유는 잠겼을 때만의 것이다', () => {
    render(<Button disabledReason="조직 admin 만 합니다">저장</Button>);
    const button = screen.getByRole('button', { name: '저장' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('data-reason')).toBeNull();
  });
});

describe('말풍선은 화면 안에 선다 (2026-09-25 캡처)', () => {
  // 오른쪽 끝의 [+ 새 작업] 말풍선이 가운데 정렬이라 화면 밖으로 잘렸다 — 올리는 순간 재서 그 끝에 맞춘다
  function lockedAt(left: number, width = 80): HTMLElement {
    render(
      <Button disabled disabledReason="조직 admin 만 합니다">
        저장
      </Button>,
    );
    const button = screen.getByRole('button', { name: '저장' });
    button.getBoundingClientRect = () =>
      ({ left, width, right: left + width, top: 0, bottom: 30, height: 30 }) as DOMRect;
    return button;
  }

  it.each([
    ['가운데', 600, 'after:-translate-x-1/2'],
    ['오른쪽 끝이면 단추의 오른쪽에', window.innerWidth - 90, 'after:right-0'],
    ['왼쪽 끝이면 단추의 왼쪽에', 4, 'after:left-0'],
  ])('%s', (_label, left, expected) => {
    const button = lockedAt(left);
    fireEvent.mouseEnter(button);
    expect(button.className).toContain(expected);
    cleanup();
    // 키보드로 왔을 때도 같다
    const again = lockedAt(left);
    fireEvent.focus(again);
    expect(again.className).toContain(expected);
  });
});

describe('오프라인이면 쓰기 단추가 잠긴다 (SYS-09 · REQ-WEB-235)', () => {
  let goOffline: (offline: boolean) => void = () => undefined;
  function Probe(): React.JSX.Element {
    goOffline = useRealtime().setOffline;
    return (
      <>
        <Button variant="primary">승인</Button>
        <Button>보기</Button>
        <Button requiresOnline>반려</Button>
      </>
    );
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ memberships: [] }) })),
    );
  });

  it('주 단추와 requiresOnline 만 잠기고, 복구되면 **같은 단추가** 풀린다 — 포커스가 남는다', async () => {
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={new QueryClient()}>
          <RealtimeProvider>
            <Probe />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
    const approve = screen.getByRole('button', { name: '승인' });
    expect(approve.getAttribute('aria-disabled')).toBeNull();

    act(() => goOffline(true));
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(approve.getAttribute('data-reason')).toBe(
      '오프라인입니다. 서버에 다시 연결되면 누를 수 있습니다.',
    );
    expect(screen.getByRole('button', { name: '반려' }).getAttribute('aria-disabled')).toBe('true');
    // 읽기만 하는 단추는 그대로다 — 오프라인에도 볼 수는 있다
    expect(screen.getByRole('button', { name: '보기' }).getAttribute('aria-disabled')).toBeNull();

    approve.focus();
    act(() => goOffline(false));
    // 새로 만든 단추가 아니다 — 풀리는 순간 키보드 포커스가 사라지지 않는다
    expect(screen.getByRole('button', { name: '승인' })).toBe(approve);
    expect(approve.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(approve);
  });
});

describe('배너 두 단계가 모양으로 갈린다 (D8 · REQ-WEB-235)', () => {
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

  it('서버에 닿지 않으면 회색 ⚠ 이고, 몇 시에 받은 내용인지와 쓰기 잠금을 말한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    mount('/inbox');
    const banner = await screen.findByTestId('connection-banner');
    await waitFor(() => expect(banner.getAttribute('data-level')).toBe('offline'));
    expect(banner.className).toContain('bg-status-idle');
    expect(banner.className).not.toContain('bg-status-waiting-soft');
    expect(banner.textContent).toMatch(/⚠/);
    expect(banner.textContent).toMatch(
      /\d{2}:\d{2} 에 받은 것이고, 연결이 복구될 때까지 수정할 수 없습니다/,
    );
  });
});
