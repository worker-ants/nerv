// 화면이 서로를 가리킨다 — REQ-WEB-209 · REQ-API-180 (2026-09-24 · UI/UX 검토 P07a)
//
// 작업·세션·리뷰가 서로를 글자로만 가리켰다. 세션 카드의 작업, 작업 상세의 세션·요구사항·리뷰 브랜치,
// 발견의 출처 작업과 올린 작업, 게이트 표의 브랜치가 전부 Mono 글자라 사람은 키를 옮겨 적었다. 보드
// 카드의 담당은 이니셜뿐이라 읽는 도구에 아무것도 읽히지 않았고, 누가 실행하는지는 없었다.

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

const SESSION: Row = {
  id: 's-1',
  user_id: 'u-1',
  user_name: '지민',
  hostname: 'mac-02',
  agent_type: 'claude-code',
  state: 'active',
  branch: null,
  diff_added: 0,
  diff_removed: 0,
  last_heartbeat_at: '2026-09-24T00:00:00Z',
  started_at: '2026-09-24T00:00:00Z',
  task_id: 't-1',
  task_key: 'CLV-T-AAAAAA',
  task_title: '위젯 상태',
  claim_id: 'c-1',
  lease_remaining_seconds: 900,
  scope_spec_ids: [],
  scope_file_globs: [],
};

let taskDetail: Row;
let findings: Row[];
let fetched: string[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  taskDetail = {
    id: 't-1',
    key: 'CLV-T-AAAAAA',
    title: '위젯 상태',
    status: 'in_progress',
    priority: 'P1',
    goal_md: '목표',
    output_format_md: 'PR',
    tools_sources_md: '도구',
    boundaries_md: '경계',
    assignee_name: '하나',
    spec_key: 'SPC-CWC-007',
    source_requirement_ref: 'REQ-CWC-031',
    source_requirement_statement: '위젯은 상태를 말한다',
    claims: [
      {
        id: 'c-1',
        status: 'active',
        agent_session_id: 's-1',
        hostname: 'mac-02',
        agent_type: 'claude-code',
        external_session_id: 'ext-1',
        lease_expires_at: new Date(Date.now() + 900_000).toISOString(),
      },
    ],
    evidence: [],
    reviews: [
      {
        id: 'r-1',
        kind: 'code',
        branch: 'feat/x',
        round_no: 1,
        state: 'resolved',
        open_critical: 2,
      },
    ],
    dependencies: [],
  };
  findings = [];
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      fetched.push(u);
      if (u === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          email: 'jimin@example.com',
          memberships: [
            {
              org_slug: 'default',
              org_name: 'Default',
              project_slug: 'clemvion',
              roles: ['developer'],
            },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects/.test(u)) {
        return ok([{ id: 'p1', slug: 'clemvion', name: 'Clemvion' }]);
      }
      if (/^\/projects\/clemvion\/sessions\/s-1$/.test(u)) {
        return ok({
          ...SESSION,
          current_task_key: 'CLV-T-AAAAAA',
          claims: [
            { id: 'c-0', task_key: 'CLV-T-BBBBBB', task_title: '앞 작업', status: 'released' },
          ],
        });
      }
      if (/^\/projects\/clemvion\/sessions(\?|$)/.test(u)) {
        return ok({ items: [SESSION], next_cursor: null, summary: {} });
      }
      if (u.includes('/tasks/CLV-T-AAAAAA')) return ok(taskDetail);
      if (/\/tasks(\?|$)/.test(u)) {
        return ok({
          items: u.includes('status=in_progress')
            ? [
                {
                  id: 't-1',
                  key: 'CLV-T-AAAAAA',
                  title: '위젯 상태',
                  status: 'in_progress',
                  priority: 'P0',
                  assignee_name: '하나',
                  spec_key: 'SPC-CWC-007',
                  claim_session_id: 's-1',
                  claim_hostname: 'mac-02',
                  claim_agent_type: 'claude-code',
                  updated_at: '2026-09-24T00:00:00Z',
                },
              ]
            : [],
          next_cursor: null,
        });
      }
      if (u.includes('/findings')) {
        return ok({
          items: findings,
          next_cursor: null,
          limit: 50,
          facets: { severity: {}, status: {}, area: {}, tag: {} },
        });
      }
      if (u.includes('/gates/reviews')) {
        return ok({ items: [{ branch: 'feat/x', verdict: 'covered', bypasses: [] }], total: 1 });
      }
      return ok({ id: 'p1', slug: 'clemvion', items: [], next_cursor: null, summary: {} });
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

describe('세션 → 작업', () => {
  it('세션 카드의 작업은 그 작업으로 가는 링크다', async () => {
    renderAt('/p/clemvion/sessions');
    const link = await screen.findByTestId('session-task-link');
    expect(link.getAttribute('href')).toBe('/p/clemvion/tasks/CLV-T-AAAAAA');
  });

  it('세션 상세의 현재 작업과 클레임 이력이 작업으로 간다', async () => {
    renderAt('/p/clemvion/sessions/s-1');
    expect((await screen.findByTestId('session-current-task')).getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-AAAAAA',
    );
    expect(screen.getByRole('link', { name: 'CLV-T-BBBBBB' }).getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-BBBBBB',
    );
  });
});

describe('작업 → 세션 · 요구사항 · 리뷰', () => {
  it('머리가 담당과 실행 세션을 말하고, 클레임 줄은 그 세션으로 간다', async () => {
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    expect((await screen.findByTestId('task-assignee')).textContent).toContain('담당 하나');
    expect(screen.getByTestId('task-runner').getAttribute('href')).toBe('/p/clemvion/sessions/s-1');
    expect(screen.getByTestId('claim-session-link').getAttribute('href')).toBe(
      '/p/clemvion/sessions/s-1',
    );
  });

  it('출처 요구사항은 그 스펙의 요구사항 탭으로, 리뷰 줄은 그 브랜치의 발견으로 간다', async () => {
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    expect((await screen.findByTestId('requirement-link')).getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-CWC-007?rail=requirements',
    );
    expect(screen.getByTestId('review-branch-link').getAttribute('href')).toBe(
      '/p/clemvion/reviews?branch=feat%2Fx',
    );
  });
});

describe('리뷰 센터 — 브랜치로 들어오고, 발견이 작업을 가리킨다', () => {
  it('?branch= 로 들어오면 그 브랜치로 거른 것을 말하고 서버에도 그렇게 묻는다', async () => {
    renderAt('/p/clemvion/reviews?branch=feat%2Fx');
    expect((await screen.findByTestId('branch-filter')).textContent).toContain('feat/x');
    await waitFor(() =>
      expect(fetched.some((u) => u.includes('/findings') && u.includes('branch=feat%2Fx'))).toBe(
        true,
      ),
    );
  });

  it('발견 카드는 나온 작업과 올린 작업으로 가는 링크를 싣고, 게이트 표의 브랜치는 발견으로 간다', async () => {
    findings = [
      {
        id: 'f-1',
        severity: 'warning',
        status: 'open',
        title: '캐시 헤더',
        branch: 'feat/x',
        head_sha: 'abcdef1234',
        task_key: 'CLV-T-AAAAAA',
        promoted_task_key: 'CLV-T-CCCCCC',
        tags: [],
      },
    ];
    renderAt('/p/clemvion/reviews');
    const card = await screen.findByTestId('finding-card');
    expect(within(card).getByTestId('finding-task-link').getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-AAAAAA',
    );
    expect(within(card).getByTestId('finding-promoted-link').getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-CCCCCC',
    );
    expect((await screen.findByTestId('gate-branch-link')).getAttribute('href')).toBe(
      '/p/clemvion/reviews?branch=feat%2Fx',
    );
  });
});

describe('보드 카드 — 누구의 일이고 누가 돌리는가', () => {
  it('담당은 이름을 읽히고, 에이전트가 돌리면 그 세션으로 가는 표식이 선다', async () => {
    renderAt('/p/clemvion/tasks');
    const runner = await screen.findByTestId('task-card-runner');
    expect(runner.getAttribute('href')).toBe('/p/clemvion/sessions/s-1');
    expect(runner.getAttribute('title')).toContain('mac-02');
    // 이니셜만 서는 자리 — 읽는 도구에는 이름이 읽힌다
    expect(screen.getByText('담당 하나')).toBeTruthy();
    expect(screen.getByTestId('task-card-priority').textContent).toBe('P0');
    expect(screen.getByTestId('task-card-spec').getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-CWC-007',
    );
  });
});
