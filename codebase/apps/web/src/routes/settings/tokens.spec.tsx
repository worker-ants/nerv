// /settings/tokens — 토큰이 어느 프로젝트의 것인지 (REQ-WEB-167 · 2026-09-21 사람 보고)
//
// "발급하거나 발급한 후에 어떤 프로젝트의 토큰인지 알 수 없어서 관리가 힘들다" 가 보고다.
// 토큰은 처음부터 프로젝트 하나에 묶여 있었고(`api_token.project_id`), 서버는 목록에
// `project_slug`·`project_name` 을 **싣고 있었다** — 화면만 그 말을 한 번도 하지 않았다.
//
// 세 자리를 검사한다. 하나라도 빠지면 그 자리에서 다시 알 수 없어진다.
//   ① 고를 때  — 폼이 대상을 고르게 하고, 발급 본문에 그것이 실린다
//   ② 받을 때  — 원문 카드가 프로젝트·권한·만료를 말한다(원문은 이 한 번뿐이다)
//   ③ 나중에   — 목록에 프로젝트 열이 있고, 죽은 토큰은 접힌다

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const PROJECTS = [
  { id: 'p-1', slug: 'clemvion', name: 'Clemvion' },
  { id: 'p-2', slug: 'sudoku', name: '스도쿠' },
];

/** 조직 admin — 조직 전체 토큰 표(EP-TOK-04)를 보는 쪽이다 */
const ADMIN = {
  id: 'u-1',
  display_name: '지민',
  memberships: [{ org_slug: 'default', org_name: 'default', project_slug: null, roles: ['admin'] }],
};

/** 프로젝트 개발자 — 조직 표는 보지 못한다 */
const DEVELOPER = {
  id: 'u-2',
  display_name: '도현',
  memberships: [
    { org_slug: 'default', org_name: 'default', project_slug: 'clemvion', roles: ['developer'] },
    { org_slug: 'default', org_name: 'default', project_slug: 'sudoku', roles: ['developer'] },
  ],
};

const DAY = 24 * 60 * 60 * 1000;
const MY_TOKENS = [
  {
    id: 't-1',
    name: 'clemvion/내 에이전트',
    prefix: 'nerv_aaa',
    scopes: ['spec:read'],
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    last_used_hostname: null,
    project_slug: 'clemvion',
    project_name: 'Clemvion',
  },
  {
    id: 't-2',
    name: 'sudoku/옛것',
    prefix: 'nerv_bbb',
    scopes: ['task:claim'],
    // 만료가 지났다 — 서버가 이미 거절하는 토큰이고, 목록에서도 살아 있는 것과 섞이면 안 된다
    expires_at: new Date(Date.now() - DAY).toISOString(),
    revoked_at: null,
    last_used_at: null,
    last_used_hostname: null,
    project_slug: 'sudoku',
    project_name: '스도쿠',
  },
];

const ORG_TOKENS = [
  {
    id: 'o-1',
    name: 'mac-02',
    owner: '도현',
    prefix: 'nerv_ccc',
    scopes: ['task:claim'],
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    last_used_hostname: 'mac-02',
    project_slug: 'clemvion',
    project_name: 'Clemvion',
  },
  {
    id: 'o-2',
    name: 'linux-ci',
    owner: '유나',
    prefix: 'nerv_ddd',
    scopes: ['spec:read'],
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    last_used_hostname: 'ci-01',
    project_slug: 'sudoku',
    project_name: '스도쿠',
  },
];

interface Call {
  path: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];

/** 발급 응답 — 서버가 실제로 돌려주는 모양(REQ-API-160) */
const ISSUED = {
  token: 'nerv_secret-value',
  prefix: 'nerv_sec',
  name: 'sudoku/내 에이전트',
  scopes: ['spec:read', 'task:claim'],
  expires_at: null,
  project: { slug: 'sudoku', name: '스도쿠' },
};

function stub(me: unknown): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: string }) => {
      const path = String(url);
      calls.push({
        path,
        body: init?.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>),
      });
      const json = path.includes('/me/tokens')
        ? path.endsWith('/me/tokens') && init?.body !== undefined
          ? ISSUED
          : MY_TOKENS
        : path.includes('/tokens')
          ? ORG_TOKENS
          : path.includes('/projects')
            ? PROJECTS
            : path.includes('/me')
              ? me
              : { items: [], count: 0 };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
}

async function renderTab(me: unknown = ADMIN): Promise<void> {
  stub(me);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/settings/tokens'] }),
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
  // 프로젝트 목록은 `me` 보다 늦게 온다 — 기다리지 않으면 [발급]이 아직 비활성이라
  // 누르는 검사가 **아무 일도 일어나지 않은 것을** 성공으로 읽는다.
  await waitFor(() =>
    expect((screen.getByTestId('token-project') as HTMLSelectElement).options.length).toBe(
      PROJECTS.length,
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});
beforeEach(() => localStorage.clear());

describe('① 고를 때 — 발급 대상은 폼이 정한다', () => {
  it('프로젝트를 고르면 그 프로젝트로 발급되고 기본 이름도 따라간다', async () => {
    await renderTab(DEVELOPER);
    // 고를 수 있는 것은 내가 속한 프로젝트 전부다 — 헤더가 고른 하나가 아니다
    const picker = screen.getByTestId('token-project') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'sudoku' } });
    // 이름을 직접 적지 않았으면 자동 이름이 프로젝트를 따라간다
    expect((screen.getByLabelText('토큰 이름') as HTMLInputElement).value).toContain('sudoku');

    fireEvent.click(screen.getByText('발급'));
    await waitFor(() => expect(calls.some((c) => c.body !== null)).toBe(true));
    const issued = calls.find((c) => c.body !== null);
    expect(issued?.body?.['project']).toBe('sudoku');
    expect(String(issued?.body?.['name'])).toContain('sudoku');
  });

  it('만료를 고르면 발급 본문에 실린다 — 기본은 만료 없음이다', async () => {
    await renderTab(DEVELOPER);
    fireEvent.click(screen.getByText('발급'));
    await waitFor(() => expect(calls.some((c) => c.body !== null)).toBe(true));
    // 기본을 바꾸면 오늘 되던 토큰이 어느 날 조용히 죽는다
    expect(calls.find((c) => c.body !== null)?.body?.['expires_at']).toBe(null);

    calls = calls.filter((c) => c.body === null);
    fireEvent.change(screen.getByTestId('token-expiry'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('발급'));
    await waitFor(() => expect(calls.some((c) => c.body !== null)).toBe(true));
    expect(typeof calls.find((c) => c.body !== null)?.body?.['expires_at']).toBe('string');
  });
});

describe('② 받을 때 — 원문 카드가 자기를 설명한다', () => {
  it('프로젝트·권한·만료와 붙여넣을 한 줄을 함께 준다', async () => {
    await renderTab(DEVELOPER);
    fireEvent.click(screen.getByText('발급'));

    const card = await screen.findByTestId('issued-token');
    expect(within(card).getByText('nerv_secret-value')).toBeDefined();
    // **이 한 번을 놓치면 다시 볼 수 없다** — 값만 있고 무엇에 쓰는지가 없으면 그것이 사고다
    expect(within(card).getByTestId('issued-project').textContent).toContain('스도쿠');
    expect(within(card).getByTestId('issued-project').textContent).toContain('sudoku');
    const command = within(card).getByTestId('issued-command').textContent ?? '';
    expect(command).toContain('--project sudoku');
    expect(command).toContain('--token nerv_secret-value');
  });
});

describe('③ 나중에 — 목록이 프로젝트를 말한다', () => {
  it('내 토큰 표에 프로젝트 열이 있다', async () => {
    await renderTab(DEVELOPER);
    await waitFor(() => expect(screen.getByText('clemvion/내 에이전트')).toBeDefined());
    const row = screen.getByText('clemvion/내 에이전트').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Clemvion')).toBeDefined();
    expect(within(row as HTMLElement).getByText('clemvion')).toBeDefined();
  });

  it('만료된 토큰은 접혀 있고 토글로 편다', async () => {
    await renderTab(DEVELOPER);
    await waitFor(() => expect(screen.getByText('clemvion/내 에이전트')).toBeDefined());
    expect(screen.queryByText('sudoku/옛것')).toBeNull();

    fireEvent.click(screen.getByTestId('token-show-revoked'));
    expect(screen.getByText('sudoku/옛것')).toBeDefined();
  });
});

describe('조직 전체 토큰 — admin 만', () => {
  it('admin 은 조직의 토큰을 프로젝트·소유자로 거른다', async () => {
    await renderTab(ADMIN);
    await waitFor(() => expect(screen.getByTestId('org-token-project')).toBeDefined());
    expect(screen.getByText('mac-02')).toBeDefined();
    expect(screen.getByText('linux-ci')).toBeDefined();

    fireEvent.change(screen.getByTestId('org-token-project'), { target: { value: 'sudoku' } });
    expect(screen.queryByText('mac-02')).toBeNull();
    expect(screen.getByText('linux-ci')).toBeDefined();
  });

  it('admin 이 아니면 부르지도 않는다 — 볼 수 없는 것에 403 을 쌓지 않는다', async () => {
    await renderTab(DEVELOPER);
    await waitFor(() => expect(screen.getByText('clemvion/내 에이전트')).toBeDefined());
    expect(screen.queryByTestId('org-token-project')).toBeNull();
    expect(calls.some((c) => c.path.includes('/orgs/') && c.path.includes('/tokens'))).toBe(false);
  });

  it('프로젝트의 admin 이어도 조직 admin 이 아니면 보지 않는다 — 남의 프로젝트 토큰까지 담는 표다 (REQ-API-172)', async () => {
    const projectAdmin = {
      id: 'u-3',
      display_name: '하나',
      memberships: [
        { org_slug: 'default', org_name: 'default', project_slug: 'sudoku', roles: ['admin'] },
      ],
    };
    await renderTab(projectAdmin);
    await waitFor(() => expect(screen.getByText('clemvion/내 에이전트')).toBeDefined());
    expect(screen.queryByTestId('org-token-project')).toBeNull();
    expect(calls.some((c) => c.path.includes('/orgs/') && c.path.includes('/tokens'))).toBe(false);
  });
});
