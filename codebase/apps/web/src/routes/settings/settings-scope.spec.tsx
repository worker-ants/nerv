// 설정이 **어느 범위에** 쓰는가 — REQ-WEB-191 · REQ-API-169 (2026-09-24 조직·프로젝트 경계 점검)
//
// 설정 화면들이 대상 범위를 헤더가 **기억한** 프로젝트에서 빌려 왔다.
//   - 조직 전체 줄의 역할 칩을 켜면 마지막으로 본 프로젝트에 새 멤버십이 생겼다
//   - 게이트 정책은 어느 프로젝트의 것인지 화면이 말하지 않은 채 저장됐다
//   - 초대 소속은 "조직 전체" 와 기억된 프로젝트 **하나**뿐이었다
// 그리고 한 프로젝트의 admin 이 조직 전체 줄까지 바꿀 수 있었다(결정: 조직 전체는 조직 admin 만).

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

const ORG_ADMIN = {
  id: 'u-1',
  display_name: '관리자',
  memberships: [
    {
      org_slug: 'default',
      org_name: 'Default',
      project_slug: null,
      project_name: null,
      roles: ['admin'],
    },
  ],
};
/** sudoku 에서만 admin — 조직 전체 줄은 바꿀 수 없어야 한다 */
const PROJECT_ADMIN = {
  id: 'u-2',
  display_name: '지민',
  memberships: [
    {
      org_slug: 'default',
      org_name: 'Default',
      project_slug: 'sudoku',
      project_name: '스도쿠',
      roles: ['admin'],
    },
  ],
};
const PROJECTS = [
  { id: 'p-1', slug: 'clemvion', name: 'Clemvion' },
  { id: 'p-2', slug: 'sudoku', name: '스도쿠' },
];
/** 유나는 조직 전체 planner 이면서 sudoku 에서 viewer — 겸직의 흔한 형태다 */
const GROUPED_MEMBERS = [
  {
    id: 'g-1',
    role: 'viewer',
    email: 'yuna@example.com',
    display_name: '유나',
    project_slug: 'sudoku',
    project_name: '스도쿠',
  },
  {
    id: 'g-2',
    role: 'planner',
    email: 'yuna@example.com',
    display_name: '유나',
    project_slug: null,
    project_name: null,
  },
  {
    id: 'g-3',
    role: 'developer',
    email: 'dohyun@example.com',
    display_name: '도현',
    project_slug: 'sudoku',
    project_name: '스도쿠',
  },
];
let members: unknown[] = [];
const MEMBERS = [
  {
    id: 'm-1',
    role: 'planner',
    email: 'yuna@example.com',
    display_name: '유나',
    project_slug: null,
    project_name: null,
  },
  {
    id: 'm-2',
    role: 'developer',
    email: 'dohyun@example.com',
    display_name: '도현',
    project_slug: 'sudoku',
    project_name: '스도쿠',
  },
];

let me: unknown = ORG_ADMIN;
let invitations: unknown[] = [];
let sent: { method: string; url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  localStorage.clear();
  sent = [];
  me = ORG_ADMIN;
  members = MEMBERS;
  invitations = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        sent.push({ method, url: path, body: JSON.parse(String(init?.body ?? '{}')) });
        return { ok: true, status: 200, json: async () => ({ token: 'tok', queued: false }) };
      }
      const json = path.endsWith('/members')
        ? members
        : path.includes('/invitations')
          ? invitations
          : /\/orgs\/[^/]+\/projects/.test(path)
            ? PROJECTS
            : /\/projects\/[^/?]+$/.test(path)
              ? { ...PROJECTS.find((p) => path.endsWith(p.slug)), gate_policy: {} }
              : path.endsWith('/me')
                ? me
                : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): { state: { location: { href: string } } } {
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
  return router;
}

/** 그 사람 줄의 역할 칩 */
async function rowOf(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name);
  return cell.closest('tr') as HTMLElement;
}

describe('멤버 표 — 역할은 그 줄의 범위에 쓴다', () => {
  it('조직 전체 줄에서 켜면 조직 전체로 — 헤더가 기억한 프로젝트가 아니다', async () => {
    localStorage.setItem('nerv.last-org', 'default');
    localStorage.setItem('nerv.last-project.default', 'clemvion');
    renderAt('/settings/members');
    const row = await rowOf('유나');
    fireEvent.click(within(row).getByTestId('role-qa'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ email: 'yuna@example.com', role: 'qa', project: null });
  });

  it('프로젝트 줄에서 켜면 그 프로젝트로', async () => {
    renderAt('/settings/members');
    const row = await rowOf('도현');
    fireEvent.click(within(row).getByTestId('role-qa'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body['project']).toBe('sudoku');
  });

  it('제목이 조직을 말하고, 적용 범위는 프로젝트 **이름**이다', async () => {
    renderAt('/settings/members');
    expect(await screen.findByText('Default 멤버·역할')).toBeDefined();
    const row = await rowOf('도현');
    expect(within(row).getByTestId('member-scope').textContent).toContain('스도쿠');
    expect(within(await rowOf('유나')).getByTestId('member-scope').textContent).toBe('조직 전체');
  });
});

describe('프로젝트 admin 은 자기 프로젝트만 (REQ-API-169)', () => {
  it('조직 전체 줄은 잠기고 자기 프로젝트 줄은 열린다', async () => {
    me = PROJECT_ADMIN;
    renderAt('/settings/members');
    const org = await rowOf('유나');
    expect((within(org).getByTestId('role-qa') as HTMLButtonElement).disabled).toBe(true);
    const own = await rowOf('도현');
    await waitFor(() =>
      expect((within(own).getByTestId('role-qa') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByText(/조직 전체 줄은 조직 admin 만/)).toBeDefined();
  });

  it('초대 범위에 조직 전체가 없고 자기 프로젝트만 있다', async () => {
    me = PROJECT_ADMIN;
    renderAt('/settings/members?tab=invites');
    fireEvent.click(await screen.findByTestId('invite-new'));
    const select = (await screen.findByTestId('invite-scope')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(1));
    expect(select.options[0]?.textContent).toBe('프로젝트 · 스도쿠');
  });
});

describe('초대 폼 — 어느 조직의 어느 범위로', () => {
  it('조직을 말하고, 그 조직의 프로젝트 **전부**에서 고른다', async () => {
    localStorage.setItem('nerv.last-project.default', 'clemvion');
    renderAt('/settings/members?tab=invites');
    fireEvent.click(await screen.findByTestId('invite-new'));
    expect((await screen.findByTestId('invite-org')).textContent).toBe('Default');
    const select = (await screen.findByTestId('invite-scope')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '조직 전체(모든 프로젝트)',
      '프로젝트 · Clemvion',
      '프로젝트 · 스도쿠',
    ]);
  });

  it('고른 범위로 보내고, 무엇을 만들었는지 요약한다', async () => {
    renderAt('/settings/members?tab=invites');
    fireEvent.click(await screen.findByTestId('invite-new'));
    const select = (await screen.findByTestId('invite-scope')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    fireEvent.change(select, { target: { value: 'sudoku' } });
    fireEvent.change(screen.getByTestId('invite-email'), { target: { value: 'new@example.com' } });
    fireEvent.submit(screen.getByTestId('invite-email').closest('form')!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      email: 'new@example.com',
      role: 'developer',
      project: 'sudoku',
    });
    expect((await screen.findByTestId('invite-summary')).textContent).toBe(
      'new@example.com → Default / 스도쿠 · developer',
    );
  });
});

describe('게이트 정책 — 고치는 프로젝트를 화면이 고른다', () => {
  it('제목이 프로젝트를 말하고, 고른 프로젝트에 저장한다', async () => {
    localStorage.setItem('nerv.last-project.default', 'clemvion');
    renderAt('/settings/gates');
    expect(await screen.findByText('게이트 정책 — Clemvion')).toBeDefined();
    fireEvent.change(screen.getByTestId('gates-project'), { target: { value: 'sudoku' } });
    expect(await screen.findByText('게이트 정책 — 스도쿠')).toBeDefined();
    // 바뀐 값이 있어야 저장이 켜진다(REQ-WEB-201) — 경계를 낮추면 사람을 더 거치는 쪽이라 묻지 않는다
    const t1 = (await screen.findByTestId('gate-boundary-T1')) as HTMLInputElement;
    await waitFor(() => expect(t1.disabled).toBe(false));
    fireEvent.change(t1, { target: { value: '1' } });
    const save = await screen.findByRole('button', { name: '저장' });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.url).toMatch(/\/projects\/sudoku$/);
  });
});

describe('온보딩 — 역할의 범위와 다음 행동', () => {
  it('developer 는 작업 보드로 간다고 말한다 — 문구와 링크가 같은 곳을 가리킨다', async () => {
    me = {
      id: 'u-3',
      display_name: '도현',
      memberships: [
        {
          org_slug: 'default',
          org_name: 'Default',
          project_slug: 'sudoku',
          project_name: '스도쿠',
          roles: ['developer'],
        },
      ],
    };
    renderAt('/onboarding');
    const link = await screen.findByRole('link', { name: /작업 보드/ });
    expect(link.getAttribute('href')).toBe('/p/sudoku/tasks');
    expect(screen.getByText('② Default · 스도쿠에서 내 역할: developer')).toBeDefined();
  });
});

describe('멤버 표는 사람마다 한 묶음 (REQ-WEB-194 · 결정 2)', () => {
  it('같은 사람의 소속이 한 묶음으로 모이고 이름은 한 번만 — 조직 전체 줄이 먼저다', async () => {
    members = GROUPED_MEMBERS;
    renderAt('/settings/members');
    await screen.findByText('도현');
    expect(screen.getAllByTestId('member-person').map((e) => e.textContent)).toEqual([
      '유나',
      '도현',
    ]);
    const scopes = screen.getAllByTestId('member-scope').map((e) => e.textContent);
    // 프로젝트는 이름, slug 는 흐린 보조로 곁에 선다
    expect(scopes.slice(0, 2)).toEqual(['조직 전체', '스도쿠sudoku']);
  });

  it('프로젝트 줄은 조직 전체 역할을 "상속" 으로 보인다 — 꺼진 칩이면 그 권한이 없는 것처럼 읽힌다', async () => {
    members = GROUPED_MEMBERS;
    renderAt('/settings/members');
    await screen.findByText('도현');
    const rows = screen.getAllByTestId('member-scope').map((e) => e.closest('tr') as HTMLElement);
    const project = within(rows[1]!).getByTestId('role-planner') as HTMLButtonElement;
    expect(project.getAttribute('data-inherited')).toBe('true');
    expect(project.disabled).toBe(true);
    expect(project.getAttribute('title')).toContain('조직 전체 역할이라');
    // 조직 전체 줄의 planner 는 실제로 켜져 있다 — 상속이 아니다
    expect(within(rows[0]!).getByTestId('role-planner').getAttribute('aria-pressed')).toBe('true');
    // 조직 역할이 없는 사람에게는 상속 표시가 없다
    expect(within(rows[2]!).getByTestId('role-planner').getAttribute('data-inherited')).toBeNull();
  });
});

describe('멤버와 초대는 탭이다 (2026-09-26 — 사람 지시 · REQ-WEB-242)', () => {
  const invite = (id: string, state: string): Record<string, unknown> => ({
    id,
    email: `${id}@example.com`,
    role: 'qa',
    state,
    project_slug: null,
    project_name: null,
    last_sent_at: null,
  });

  it('멤버 탭이 기본으로 열리고, 초대 구역은 보이지 않는다', async () => {
    renderAt('/settings/members');
    await rowOf('유나');
    expect(screen.getByTestId('members-tab-members').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('members-tab-invites').getAttribute('aria-current')).toBeNull();
    expect(screen.queryByTestId('invite-new')).toBeNull();
    // 탭 옆의 수는 **사람** 수다
    await waitFor(() =>
      expect(screen.getByTestId('members-tab-members-count').textContent).toBe('2'),
    );
  });

  it('초대 탭을 누르면 주소가 바뀌고 초대 구역만 보인다 — 수는 대기 중인 초대만 센다', async () => {
    invitations = [invite('a', 'pending'), invite('b', 'accepted'), invite('c', 'pending')];
    const router = renderAt('/settings/members');
    await rowOf('유나');
    await waitFor(() =>
      expect(screen.getByTestId('members-tab-invites-count').textContent).toBe('2'),
    );
    fireEvent.click(screen.getByTestId('members-tab-invites'));
    await waitFor(() => expect(router.state.location.href).toBe('/settings/members?tab=invites'));
    expect(await screen.findByTestId('invite-new')).toBeDefined();
    expect(screen.queryByText('유나')).toBeNull();
    expect(screen.getByTestId('members-tab-invites').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('members-tab-members').getAttribute('aria-current')).toBeNull();
  });
});
