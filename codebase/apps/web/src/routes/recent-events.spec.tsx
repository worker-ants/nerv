// 홈·프로젝트 개요의 "최근 활동" 이 실제로 그려지는가 (screens.md §2.1·§2.2)
//
// 2026-09-06 에 서버가 이벤트 목록에 봉투(`{items, next_cursor}`)를 씌웠는데 `useEvents` 는
// 맨 배열을 기대하고 있었다 — 그날부터 두 화면의 "최근 활동" 이 **빈 목록**이었다. 배열이
// 아닌 값에 `rows()` 는 `[]` 를 주므로 화면은 오류도 로딩도 아닌 "아무 일도 없었다" 를
// 보여 준다. 가장 나쁜 모양이다: 사람은 그것을 사실로 읽는다.
//
// 그래서 이 검사는 **봉투를 그대로** 흘린다 — 훅이 풀지 않으면 여기서 빈 목록이 된다.

import { NERV_EVENT } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const EVENTS = {
  items: [
    {
      id: 'e-1',
      type: NERV_EVENT.SPEC_APPROVED,
      subject_type: 'spec_version',
      subject_id: 's-1',
      actor_name: '지민',
      is_agent: false,
      occurred_at: '2026-09-07T00:00:00.000Z',
    },
    {
      id: 'e-2',
      type: NERV_EVENT.TASK_CLAIMED,
      subject_type: 'task',
      subject_id: 't-1',
      actor_name: null,
      is_agent: true,
      occurred_at: '2026-09-07T00:01:00.000Z',
    },
  ],
  next_cursor: null,
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <RouterProvider router={router} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      // **봉투 그대로** 흘린다 — 서버가 주는 모양이고, 훅이 풀지 않으면 화면이 빈다
      const json = path.includes('/events')
        ? EVENTS
        : path.includes('/me')
          ? {
              id: 'u-1',
              display_name: '지민',
              memberships: [
                { org_slug: 'nerv', org_name: 'NERV', project_slug: 'clemvion', roles: ['admin'] },
              ],
            }
          : path.includes('/projects')
            ? [{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }]
            : { items: [], summary: {}, next_cursor: null, memberships: [], count: 0 };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('최근 활동은 봉투 응답을 풀어 그린다 (REQ-API-120 의 웹 쪽)', () => {
  it.each([
    ['홈', '/'],
    ['프로젝트 개요', '/p/clemvion'],
  ])('%s 에서 이벤트 두 건이 목록에 선다', async (_name, path) => {
    renderAt(path);
    // 라벨 카탈로그가 그리는 문구 — 봉투를 풀지 못하면 이 줄이 하나도 없다
    await waitFor(() => expect(screen.getAllByText(/승인/).length).toBeGreaterThan(0));
    // 행위자가 있는 이벤트는 이름이 함께 선다(REQ-WEB-010 — 사람과 에이전트를 가른다)
    expect(screen.getAllByText(/지민/).length).toBeGreaterThan(0);
  });
});
