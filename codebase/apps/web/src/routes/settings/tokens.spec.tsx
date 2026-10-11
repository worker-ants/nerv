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
  method: string;
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
    vi.fn(async (url: unknown, init?: { body?: string; method?: string }) => {
      const path = String(url);
      calls.push({
        path,
        method: init?.method ?? 'GET',
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

async function renderTab(me: unknown = ADMIN, path = '/settings/tokens'): Promise<void> {
  stub(me);
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
  // 조직 전체 토큰 화면에는 발급 폼이 없다 — 그 화면의 검사는 제 조건을 기다린다
  if (path !== '/settings/tokens') return;
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

describe('권한은 무엇을 허락하는지 말한다 (2026-09-25 · UI/UX 검토 SET-14)', () => {
  it('권한마다 코드 아래에 한 줄 설명이 선다 — 사람 전용 권한도', async () => {
    await renderTab(ADMIN);
    const scopes = await screen.findAllByTestId('token-scope');
    const read = scopes.find((label) => label.querySelector('code')?.textContent === 'spec:read');
    expect(read?.textContent).toContain('스펙·요구사항을 읽습니다');
    const launch = scopes.find(
      (label) => label.querySelector('code')?.textContent === 'agent-session:launch',
    );
    expect(launch?.textContent).toContain('연결하려면 필요합니다');
    // `spec:approve` 는 옵트인 권한이 됐다(2026-10-11 사람 결정) — 사람 전용 줄이 아니라 고를 수 있는 줄에 있다
    const approve = scopes.find(
      (label) => label.querySelector('code')?.textContent === 'spec:approve',
    );
    expect(approve?.textContent).toContain('사람이 대답으로 승인한 초안을 승인합니다');
    const human = screen.getAllByTestId('human-only-scope');
    expect(human.map((label) => label.textContent)).toEqual([
      expect.stringContaining('받은 요청을 결정합니다'),
    ]);
    // 설계 문서의 결정 번호가 아니라 까닭을 말한다
    expect(human[0]?.getAttribute('title')).not.toContain('D-08');
    expect(human[0]?.getAttribute('title')).toContain('사람만 할 수 있어');
  });

  it('spec:approve 는 권장 묶음에 없고, 역할에 없으면 잠긴다 (2026-10-11 사람 결정)', async () => {
    const box = (scope: string): HTMLInputElement =>
      screen
        .getAllByTestId('token-scope')
        .find((label) => label.querySelector('code')?.textContent === scope)
        ?.querySelector('input') as HTMLInputElement;
    await renderTab(DEVELOPER);
    await screen.findAllByTestId('token-scope');
    // 권장 묶음 — 보여 주기만 하고 고르지 않았다
    expect(box('spec:approve').checked).toBe(false);
    // developer 는 직접 고르기로 바꿔도 고를 수 없다 — 역할 밖이다
    fireEvent.click(screen.getByTestId('scope-custom'));
    await waitFor(() => expect(box('spec:read').disabled).toBe(false));
    expect(box('spec:approve').disabled).toBe(true);
    expect(
      screen
        .getAllByTestId('token-scope')
        .find((label) => label.querySelector('code')?.textContent === 'spec:approve')
        ?.getAttribute('title'),
    ).toContain('내 역할에 없는 권한');
  });

  it('토큰 표의 머리가 카탈로그를 읽는다 — "prefix" 가 박혀 있지 않다', async () => {
    await renderTab(DEVELOPER);
    await waitFor(() => expect(screen.getByText('clemvion/내 에이전트')).toBeDefined());
    const table = screen.getByText('clemvion/내 에이전트').closest('table') as HTMLElement;
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(heads).toContain('앞자리');
    expect(heads).not.toContain('prefix');
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
  // 조직 전체 표는 조직 묶음의 자기 화면이다(2026-09-25 · REQ-WEB-227) — 토큰 탭(나)은 그리로 가는 길만 남긴다
  it('admin 은 조직의 토큰을 프로젝트·소유자로 거른다', async () => {
    await renderTab(ADMIN, '/settings/org-tokens');
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

/**
 * **발급한 토큰의 이름과 권한을 고친다**(2026-10-11 · 사람 결정 · REQ-WEB-306). 권한 하나를 더하려고 새로
 * 발급하면 그 토큰을 쓰던 기계마다 설정을 다시 해야 했다. 주인만 고치고(조직 전체 표에는 없다), 권한 칸은
 * 발급 폼과 같은 규칙으로 잠긴다 — 기준은 **그 토큰의 프로젝트에서 내 역할**이다.
 */
describe('토큰 고치기 — 이름과 권한 (REQ-WEB-306)', () => {
  const editBox = (scope: string): HTMLInputElement =>
    screen
      .getAllByTestId('token-edit-scope')
      .find((label) => label.querySelector('code')?.textContent === scope)
      ?.querySelector('input') as HTMLInputElement;

  async function openEditor(me: unknown): Promise<void> {
    await renderTab(me);
    await waitFor(() => expect(screen.getByText('clemvion/내 에이전트')).toBeDefined());
    const row = screen.getByText('clemvion/내 에이전트').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTestId('token-edit'));
    await screen.findByTestId('token-editor');
  }

  it('지금의 이름과 권한에서 시작하고, 고친 것을 PATCH 로 보낸다', async () => {
    await openEditor(DEVELOPER);
    expect((screen.getByTestId('token-edit-name') as HTMLInputElement).value).toBe(
      'clemvion/내 에이전트',
    );
    expect(editBox('spec:read').checked).toBe(true);
    expect(editBox('task:claim').checked).toBe(false);

    fireEvent.change(screen.getByTestId('token-edit-name'), {
      target: { value: '  사무실 맥  ' },
    });
    fireEvent.click(editBox('task:claim'));
    fireEvent.click(screen.getByTestId('token-edit-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const sent = calls.find((c) => c.method === 'PATCH');
    expect(sent?.path).toContain('/me/tokens/t-1');
    // 앞뒤 공백은 이름이 아니다 — 서버도 자르지만 화면이 보낸 것이 곧 저장될 것이어야 한다
    expect(sent?.body).toEqual({ name: '사무실 맥', scopes: ['spec:read', 'task:claim'] });
    // 저장하면 줄이 닫힌다
    await waitFor(() => expect(screen.queryByTestId('token-editor')).toBeNull());
  });

  it('역할 밖 권한은 잠기고, 사람 전용 권한은 고를 수 없다 — 발급 폼과 같은 규칙', async () => {
    await openEditor(DEVELOPER);
    // developer 에게 spec:approve 는 역할 밖이다(admin · planner 만)
    expect(editBox('spec:approve').disabled).toBe(true);
    expect(editBox('spec:read').disabled).toBe(false);
    const human = screen.getAllByTestId('token-edit-human-only');
    expect(human.every((label) => label.querySelector('input')?.disabled === true)).toBe(true);
  });

  it('이름을 비우면 저장할 수 없고, [취소]는 아무것도 보내지 않는다', async () => {
    await openEditor(DEVELOPER);
    fireEvent.change(screen.getByTestId('token-edit-name'), { target: { value: '   ' } });
    expect((screen.getByTestId('token-edit-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('token-edit-cancel'));
    expect(screen.queryByTestId('token-editor')).toBeNull();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('만료된 토큰과 조직 전체 표에는 [편집]이 없다 — 되살리는 길이 아니고, 고치는 것은 주인뿐이다', async () => {
    await renderTab(DEVELOPER);
    await waitFor(() => expect(screen.getByText('clemvion/내 에이전트')).toBeDefined());
    fireEvent.click(screen.getByTestId('token-show-revoked'));
    const expired = screen.getByText('sudoku/옛것').closest('tr') as HTMLElement;
    expect(within(expired).queryByTestId('token-edit')).toBeNull();
    cleanup();

    await renderTab(ADMIN, '/settings/org-tokens');
    await waitFor(() => expect(screen.getByText('mac-02')).toBeDefined());
    expect(screen.queryByTestId('token-edit')).toBeNull();
  });
});
