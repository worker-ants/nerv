// fail-open 격상 배너 — S5 세션 모니터 · S6 리뷰 센터 (2026-10-15 · 사람 결정 · REQ-WEB-319)
//
// 프로젝트 조회의 `failopen_status` 가 격상이면 두 화면 머리 아래에 배너가 서고, 최근 fail-open 수 · 창 · 기준과
// [기록 보기](개요의 활동을 그 기록으로 거른다)를 보인다. 격상이 아니면 아무것도 그리지 않는다.

import { NERV_EVENT, NERV_EVENT_PHASE2 } from '@nerv/schema';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';
import { eventTarget } from '../lib/event-subject.js';
import { readFailopenStatus } from './failopen-banner.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const ME = {
  id: 'u-1',
  display_name: '관리자',
  memberships: [
    {
      org_slug: 'default',
      org_name: 'Default',
      project_slug: 'sudoku',
      project_name: '스도쿠',
      roles: ['qa'],
    },
  ],
};

let status: Record<string, unknown> = {};
let requested: string[] = [];

beforeEach(() => {
  localStorage.clear();
  requested = [];
  status = {
    escalated: true,
    count: 4,
    escalate_count: 3,
    window_hours: 24,
    escalated_at: new Date().toISOString(),
    last_at: new Date().toISOString(),
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      requested.push(path);
      const json = /\/projects\/sudoku$/.test(path)
        ? {
            id: 'p-2',
            slug: 'sudoku',
            name: '스도쿠',
            org_slug: 'default',
            gate_policy: {},
            failopen_status: status,
          }
        : /\/orgs\/[^/]+\/projects/.test(path)
          ? [{ id: 'p-2', slug: 'sudoku', name: '스도쿠' }]
          : path.endsWith('/me')
            ? ME
            : {
                items: [],
                next_cursor: null,
                memberships: [],
                count: 0,
                total: 0,
                summary: {},
                facets: { severity: {}, status: {}, tag: {}, area: {} },
              };
      return { ok: true, status: 200, json: async () => json };
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

describe('격상이면 S5 · S6 에 배너가 선다 (REQ-WEB-319)', () => {
  it('세션 모니터 — 수 · 창 · 기준과 기록으로 가는 링크', async () => {
    renderAt('/p/sudoku/sessions');
    const banner = await screen.findByTestId('failopen-banner');
    expect(banner.textContent).toContain('게이트가 사실상 꺼져 있습니다');
    expect(banner.textContent).toContain(
      '최근 24시간 동안 게이트가 판정하지 못하고 통과시킨 일이 4번입니다(격상 기준 3번)',
    );
    const link = await screen.findByTestId('failopen-banner-events');
    expect(link.getAttribute('href')).toBe('/p/sudoku?events=failopen');
  });

  it('리뷰 센터에도 같은 배너가 선다', async () => {
    renderAt('/p/sudoku/reviews');
    expect((await screen.findByTestId('failopen-banner')).textContent).toContain(
      '게이트가 사실상 꺼져 있습니다',
    );
  });

  it('격상이 아니면 그리지 않는다', async () => {
    status = { ...status, escalated: false, count: 1, escalated_at: null };
    renderAt('/p/sudoku/sessions');
    await screen.findByText('세션 모니터');
    await waitFor(() => expect(requested.some((p) => /\/projects\/sudoku$/.test(p))).toBe(true));
    expect(screen.queryByTestId('failopen-banner')).toBeNull();
  });
});

describe('[기록 보기] — 개요의 활동을 fail-open 기록으로 거른다 (REQ-WEB-319)', () => {
  it('세 종류만 묻고, 제목이 거른 사실을 보이며 모두 보기로 돌아간다', async () => {
    renderAt('/p/sudoku?events=failopen');
    expect(await screen.findByText('판정하지 못하고 통과시킨 기록')).toBeDefined();
    await waitFor(() =>
      expect(requested.some((p) => p.includes('/projects/sudoku/events?'))).toBe(true),
    );
    const feed = requested.find((p) => p.includes('/projects/sudoku/events?')) ?? '';
    expect(new URL(feed, 'http://x').searchParams.get('type')).toBe(
      [
        NERV_EVENT.GATE_FAILOPEN,
        NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED,
        NERV_EVENT_PHASE2.GATE_FAILOPEN_CLEARED,
      ].join(','),
    );
    expect((await screen.findByTestId('project-events-all')).getAttribute('href')).toBe(
      '/p/sudoku',
    );
  });

  it('격상 · 풀림 알림은 그 기록으로 간다', () => {
    for (const type of [
      NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED,
      NERV_EVENT_PHASE2.GATE_FAILOPEN_CLEARED,
    ]) {
      expect(eventTarget({ type, project_slug: 'sudoku', subject_type: 'project' })).toEqual({
        to: '/p/sudoku',
        search: { events: 'failopen' },
      });
    }
  });
});

describe('readFailopenStatus — 모양이 다르면 없는 것으로 본다', () => {
  it('필드가 빠지거나 타입이 다르면 null 이다', () => {
    expect(readFailopenStatus(undefined)).toBeNull();
    expect(
      readFailopenStatus({ escalated: 'yes', count: 1, escalate_count: 3, window_hours: 24 }),
    ).toBeNull();
    expect(readFailopenStatus({ escalated: true, count: 1, escalate_count: 3 })).toBeNull();
    expect(
      readFailopenStatus({ escalated: true, count: 1, escalate_count: 3, window_hours: 24 }),
    ).toEqual({ escalated: true, count: 1, escalate_count: 3, window_hours: 24 });
  });
});
