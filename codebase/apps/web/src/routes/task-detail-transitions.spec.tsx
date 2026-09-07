// S4 작업 상세의 전이 줄 — screens.md §2.5 · REQ-WEB-141.
//
// **화면은 서버가 받을 것만 보인다**(§1.8). 서버가 2026-09-07 에 문지기 넷을 더 세웠으므로
// (REQ-API-129~132) 화면도 그만큼 좁아진다 — 클레임 없는 developer 의 [완료로 전이] 는
// 403 이 되고, 아무도 쥐지 않은 `in_progress` 는 되돌리는 문이 필요하다(임포트가 만든
// 24건이 그 모양이었다 · 2026-09-06 실측).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ko } from '@nerv/schema';
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

const ME = '01a00000-0000-7000-8000-00000000me01';
const OTHER = '01a00000-0000-7000-8000-000000000ot1';
const PLACEHOLDER = ko['import.delegation_missing'];

/** 검사마다 갈아 끼우는 것들 — 상태·클레임·역할·위임 명세 */
let detail: Record<string, unknown> = {};
let roles: string[] = ['developer'];
/** 화면이 실제로 보낸 전이 본문 */
let posted: { url: string; body: unknown }[] = [];

function taskDetail(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '01a00000-0000-7000-8000-0000000task1',
    key: 'CLV-T-AAAAAA',
    title: '되돌리기 대상',
    status: 'in_progress',
    priority: 'P2',
    goal_md: '목표',
    output_format_md: 'PR 1건',
    tools_sources_md: 'nerv_spec_get',
    boundaries_md: '경계',
    assignee_user_id: null,
    claims: [],
    evidence: [],
    ...over,
  };
}

beforeEach(() => {
  posted = [];
  roles = ['developer'];
  detail = taskDetail();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (init?.method === 'POST') {
        posted.push({ url: u, body: JSON.parse(init.body ?? '{}') });
        return { ok: true, status: 200, json: async () => ({ status: 'ready' }) };
      }
      if (u.includes('/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: ME,
            email: 'me@example.com',
            display_name: '나',
            avatar_url: null,
            memberships: [
              {
                id: 'm1',
                roles,
                org_id: 'o1',
                org_slug: 'default',
                org_name: 'NERV',
                project_id: 'p1',
                project_slug: 'clemvion',
                project_name: 'clemvion',
              },
            ],
          }),
        };
      }
      if (u.includes('/tasks/')) return { ok: true, status: 200, json: async () => detail };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', slug: 'clemvion', items: [], memberships: [], summary: {} }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderDetail(): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks/CLV-T-AAAAAA'] }),
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
  // **상세가 실제로 도착할 때까지 기다린다.** 단추 줄은 데이터 없이도 그려지므로
  // 그것만 기다리면 빈 상태(`status: ''`)를 검사하게 된다 — 되돌리기 문도 담당자 판정도
  // 그때는 언제나 거짓이라 검사가 조용히 통과하거나 조용히 실패한다.
  await screen.findByText('되돌리기 대상');
}

describe('되돌리기와 완료 잠금 (REQ-WEB-141)', () => {
  it('아무도 쥐지 않은 진행 중은 되돌릴 수 있다 — 4요소가 차 있으면 준비됨으로', async () => {
    await renderDetail();
    const revert = await screen.findByTestId('revert-task');
    expect(revert.textContent).toContain(ko['task.to_ready']);

    fireEvent.click(revert);
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]?.url).toContain('/transition');
    expect(posted[0]?.body).toMatchObject({ status: 'ready' });
  });

  it('임포트 자리표시자는 빈 것이라 백로그로 되돌린다 — 서버가 받을 것만 보인다', async () => {
    detail = taskDetail({ goal_md: PLACEHOLDER });
    await renderDetail();
    const revert = await screen.findByTestId('revert-task');
    expect(revert.textContent).toContain(ko['task.to_backlog']);

    fireEvent.click(revert);
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]?.body).toMatchObject({ status: 'backlog' });
  });

  it('남이 쥐고 있으면 되돌리는 문이 없다 — 해제가 먼저다', async () => {
    detail = taskDetail({ claims: [{ id: 'c1', status: 'active', user_id: OTHER }] });
    await renderDetail();
    expect(screen.queryByTestId('revert-task')).toBeNull();
  });

  it('클레임 없는 developer 의 완료 단추는 비활성이고 사유를 말한다', async () => {
    await renderDetail();
    const done = screen.getByText(ko['task.to_done']).closest('button');
    expect(done?.disabled).toBe(true);
    expect(done?.title).toBe(ko['task.done_needs_claim']);
  });

  it('planner 는 누를 수 있다 — 담당자·클레임 보유자도 같다', async () => {
    roles = ['planner'];
    await renderDetail();
    const done = screen.getByText(ko['task.to_done']).closest('button');
    expect(done?.disabled).toBe(false);
  });

  it('담당자면 역할이 없어도 누를 수 있다', async () => {
    detail = taskDetail({ assignee_user_id: ME });
    await renderDetail();
    const done = screen.getByText(ko['task.to_done']).closest('button');
    expect(done?.disabled).toBe(false);
  });
});
