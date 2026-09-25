// 허브의 숫자가 같은 말을 한다 — REQ-WEB-219·220 · REQ-API-185 (2026-09-25 · UI/UX 검토 P10b)
//
// 개요(S2)는 세션을 상태 없이 불러 모든 세션이 끝난 프로젝트에 "활성 세션 40개" 를 달고 끝난 세션을
// 늘어놓았다 — 같은 순간 홈과 사이드바는 0 이라 말했다(HUB-10). 개요는 이 프로젝트에서 무엇이 나를
// 기다리는지 말하지 않았고, 홈은 헤더가 고른 한 프로젝트만 비췄다(HUB-06).

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

type Row = Record<string, unknown>;

const session = (id: string, state: string, host: string): Row => ({
  id,
  user_id: 'u-1',
  user_name: '지민',
  hostname: host,
  agent_type: 'claude-code',
  state,
  branch: null,
  diff_added: 0,
  diff_removed: 0,
  last_heartbeat_at: '2026-09-25T00:00:00Z',
  started_at: '2026-09-25T00:00:00Z',
  task_id: null,
  task_key: null,
  task_title: null,
  claim_id: null,
  lease_remaining_seconds: null,
  scope_spec_ids: [],
  scope_file_globs: [],
});

const PROJECTS: Row[] = [
  {
    id: 'p-1',
    slug: 'clemvion',
    name: 'Clemvion',
    active_sessions: 2,
    pending_approvals: 3,
    open_critical_findings: 1,
  },
  {
    id: 'p-2',
    slug: 'sudoku',
    name: 'Sudoku',
    active_sessions: 0,
    pending_approvals: 0,
    open_critical_findings: 0,
  },
];

let asked: string[];
let board: { items: Row[]; summary: Record<string, number>; next_cursor: null };
let inbox: { items: Row[]; next_cursor: null; total: number; actionable_total: number };
let critical: number;

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  asked = [];
  localStorage.clear();
  critical = 1;
  // 하트비트 순으로 오면 응답 대기가 뒤다 — 화면이 앞으로 올린다
  board = {
    items: [session('s-1', 'active', 'mac-01'), session('s-2', 'awaiting_input', 'mac-02')],
    summary: { pending: 0, active: 1, awaiting_input: 1, complete: 38, error: 0, stale: 2 },
    next_cursor: null,
  };
  inbox = { items: [], next_cursor: null, total: 3, actionable_total: 2 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      asked.push(u);
      const path = u.split('?')[0]!;
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            {
              org_slug: 'default',
              org_name: 'Default',
              project_slug: 'clemvion',
              roles: ['planner'],
            },
            {
              org_slug: 'default',
              org_name: 'Default',
              project_slug: 'sudoku',
              roles: ['planner'],
            },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) return ok(PROJECTS);
      if (path === '/projects/clemvion') {
        return ok({ ...PROJECTS[0], open_critical_findings: critical });
      }
      if (path === '/projects/clemvion/sessions') return ok(board);
      if (path === '/projects/clemvion/inbox') return ok(inbox);
      if (path === '/approvals') {
        return ok({ items: [], next_cursor: null, total: 0, actionable_total: 0 });
      }
      return ok({ items: [], next_cursor: null, total: 0, summary: {}, count: 0, totals: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): void {
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
}

describe('개요의 활성 세션은 끝나지 않은 셋이다 (HUB-10 · REQ-WEB-219)', () => {
  it('끝나지 않은 상태만 부르고, 머리의 수는 요약의 세 상태 합이다', async () => {
    renderAt('/p/clemvion');
    expect(await screen.findByText('활성 세션 2개')).toBeDefined();
    const call = asked.find((u) => u.startsWith('/projects/clemvion/sessions'));
    expect(decodeURIComponent(call ?? '')).toContain('state=pending,active,awaiting_input');
  });

  it('사람을 기다리는 세션이 먼저 선다', async () => {
    renderAt('/p/clemvion');
    await waitFor(() => expect(screen.getAllByTestId('session-card')).toHaveLength(2));
    expect(screen.getAllByTestId('session-card')[0]!.textContent).toContain('mac-02');
  });

  it('도는 세션이 없으면 그렇다고 말하고, 끝난 세션은 세션 화면으로 보낸다', async () => {
    board = {
      items: [],
      summary: { pending: 0, active: 0, awaiting_input: 0, complete: 40, error: 0, stale: 0 },
      next_cursor: null,
    };
    renderAt('/p/clemvion');
    // 빈 상태와 "0개" 는 받아 온 뒤에만 선다 — 그 전에 0 이라 말하면 모르는 것을 없다고 한다
    expect(await screen.findByText('지금 도는 세션이 없습니다.')).toBeDefined();
    expect(screen.getByText('활성 세션 0개')).toBeDefined();
    expect(
      screen
        .getByText(/세션 전체 보기/)
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/p/clemvion/sessions');
  });
});

describe('개요 머리가 여기서 나를 기다리는 것을 말한다 (HUB-06 · REQ-WEB-220)', () => {
  it('내 결정 · 응답 대기 세션 · 열린 critical — 수는 그 레코드로 가는 링크다', async () => {
    renderAt('/p/clemvion');
    const line = await screen.findByTestId('project-waiting');
    await waitFor(() =>
      expect(within(line).getByTestId('project-waiting-approvals').textContent).toBe('내 결정 2건'),
    );
    expect(within(line).getByTestId('project-waiting-approvals').getAttribute('href')).toBe(
      '/inbox',
    );
    expect(within(line).getByTestId('project-waiting-sessions').getAttribute('href')).toBe(
      '/p/clemvion/sessions?state=awaiting_input',
    );
    expect(within(line).getByTestId('project-waiting-critical').getAttribute('href')).toBe(
      '/p/clemvion/reviews?severity=critical',
    );
  });

  it('셋 다 없으면 그렇다고 말한다', async () => {
    inbox = { ...inbox, total: 0, actionable_total: 0 };
    critical = 0;
    board = { ...board, items: [session('s-1', 'active', 'mac-01')] };
    board.summary = { ...board.summary, awaiting_input: 0 };
    renderAt('/p/clemvion');
    const line = await screen.findByTestId('project-waiting');
    await waitFor(() => expect(line.textContent).toContain('기다리는 것은 없습니다'));
  });
});

describe('홈은 내 프로젝트를 모두 비춘다 (HUB-06 · REQ-WEB-220)', () => {
  it('프로젝트마다 한 줄 — 활성 세션 · 미결 결재 · 열린 critical', async () => {
    renderAt('/');
    const list = await screen.findByTestId('home-projects');
    await waitFor(() => expect(within(list).getAllByTestId('home-project')).toHaveLength(2));
    const [clemvion, sudoku] = within(list).getAllByTestId('home-project');
    expect(within(clemvion!).getByTestId('home-project-sessions').textContent).toContain('2');
    expect(within(clemvion!).getByTestId('home-project-approvals').textContent).toContain('3');
    expect(within(clemvion!).getByTestId('home-project-critical').textContent).toContain('1');
    expect(sudoku!.textContent).toContain('Sudoku');
    expect(within(sudoku!).getByRole('link', { name: 'Sudoku' }).getAttribute('href')).toBe(
      '/p/sudoku',
    );
  });
});
