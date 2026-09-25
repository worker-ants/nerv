// 되돌릴 수 없는 조작과 끝내는 길 — REQ-WEB-200 · 201 (2026-09-24 · UI/UX 검토 P03)
//
// 설정의 파괴적 조작이 한 번 클릭이었다: 토큰 폐기(쓰던 에이전트가 다음 호출부터 끊긴다) ·
// 초대 회수 · 프로젝트 보관 · 내 admin 끄기. 반대로 끝내는 길은 없었다 — 떠난 사람을 내보내거나
// 남의 토큰을 끊는 단추가 없는데 매뉴얼은 있다고 적었다. 조직의 마지막 admin 도 칩 하나로 뗄 수
// 있었다. 게이트 정책은 자유 입력 한 칸으로 고치고, 무엇이 바뀌는지 보이지 않은 채 저장됐다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';

/** 못 쓰는 단추인가 — 사유가 있으면 포커스가 남는 잠금(`aria-disabled`)이다(REQ-WEB-235) */
const isLocked = (b: Element | null | undefined): boolean =>
  b != null && ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');
/** 잠긴 단추의 사유 — hover·포커스의 말풍선과 aria-describedby 가 같은 값을 읽는다 */
const reasonOf = (b: Element | null | undefined): string | null =>
  b?.getAttribute('data-reason') ?? null;

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const ADMIN = {
  id: 'u-1',
  email: 'admin@example.com',
  display_name: '관리자',
  memberships: [{ org_slug: 'default', org_name: 'Default', project_slug: null, roles: ['admin'] }],
};
const DEVELOPER = {
  id: 'u-3',
  email: 'dohyun@example.com',
  display_name: '도현',
  memberships: [
    { org_slug: 'default', org_name: 'Default', project_slug: 'sudoku', roles: ['developer'] },
  ],
};
const PROJECTS = [
  { id: 'p-1', slug: 'clemvion', name: 'Clemvion' },
  { id: 'p-2', slug: 'sudoku', name: '스도쿠' },
];
/** 관리자는 조직의 **유일한** admin 이고, 유나는 떠날 사람이다 */
const MEMBERS = [
  {
    id: 'm-admin',
    role: 'admin',
    user_id: 'u-1',
    email: 'admin@example.com',
    display_name: '관리자',
    project_slug: null,
    project_name: null,
  },
  {
    id: 'm-admin-2',
    role: 'planner',
    user_id: 'u-1',
    email: 'admin@example.com',
    display_name: '관리자',
    project_slug: null,
    project_name: null,
  },
  {
    id: 'm-yuna-1',
    role: 'planner',
    user_id: 'u-2',
    email: 'yuna@example.com',
    display_name: '유나',
    project_slug: null,
    project_name: null,
  },
  {
    id: 'm-yuna-2',
    role: 'developer',
    user_id: 'u-2',
    email: 'yuna@example.com',
    display_name: '유나',
    project_slug: 'sudoku',
    project_name: '스도쿠',
  },
];
const LATER = '2099-01-01T00:00:00Z';
const TOKENS = [
  {
    id: 't-yuna',
    name: 'yuna/노트북',
    prefix: 'nerv_ab',
    scopes: ['spec:read'],
    owner: '유나',
    owner_id: 'u-2',
    project_slug: 'sudoku',
    project_name: '스도쿠',
    revoked_at: null,
    expires_at: LATER,
    last_used_at: '2026-09-20T00:00:00Z',
    last_used_hostname: 'yuna-mbp',
  },
  {
    id: 't-dead',
    name: 'yuna/옛것',
    prefix: 'nerv_cd',
    scopes: [],
    owner: '유나',
    owner_id: 'u-2',
    project_slug: 'sudoku',
    project_name: '스도쿠',
    revoked_at: '2026-09-01T00:00:00Z',
    expires_at: null,
    last_used_at: null,
    last_used_hostname: null,
  },
];

let me: unknown = ADMIN;
let policy: Record<string, unknown> = {};
let sent: { method: string; url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-project.default', 'clemvion');
  sent = [];
  me = ADMIN;
  policy = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        sent.push({ method, url: path, body: JSON.parse(String(init?.body ?? '{}')) });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const json = path.endsWith('/members')
        ? MEMBERS
        : path.includes('/invitations')
          ? []
          : /\/orgs\/[^/]+\/tokens/.test(path)
            ? TOKENS
            : path.endsWith('/me/tokens')
              ? []
              : /\/orgs\/[^/]+\/projects/.test(path)
                ? PROJECTS
                : /\/projects\/[^/?]+$/.test(path)
                  ? { ...PROJECTS.find((p) => path.endsWith(p.slug)), gate_policy: policy }
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

/** 그 사람 묶음의 첫 줄 */
async function firstRowOf(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name, { selector: '[data-testid="member-person"]' });
  return cell.closest('tr') as HTMLElement;
}

describe('토큰 폐기는 누가 끊기는지 말하고 한 번 묻는다 (REQ-WEB-200)', () => {
  it('조직 전체 표에서 남의 살아 있는 토큰을 끊는다 — 확인 전에는 부르지 않는다', async () => {
    renderAt('/settings/org-tokens');
    const revoke = await screen.findByTestId('token-revoke');
    // 폐기·만료된 것에는 단추가 없다 — 이미 끊겼다
    expect(screen.getAllByTestId('token-revoke')).toHaveLength(1);
    fireEvent.click(revoke);
    expect(sent).toHaveLength(0);
    expect(screen.getByTestId('token-revoke-confirming').textContent).toContain('yuna-mbp');
    fireEvent.click(screen.getByTestId('token-revoke-confirm'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: 'DELETE',
      url: expect.stringMatching(/\/me\/tokens\/t-yuna$/),
    });
  });
});

describe('떠난 사람을 내보낸다 (REQ-WEB-201)', () => {
  it('[내보내기…]는 그 사람의 모든 멤버십을 지우고 살아 있는 토큰을 끊는다 — 토큰이 먼저', async () => {
    renderAt('/settings/members');
    const row = await firstRowOf('유나');
    fireEvent.click(within(row).getByTestId('member-offboard'));
    // 토큰 표가 오면 몇 개를 끊는지 말한다 — 확인 막대는 그 수를 따라 다시 그린다
    await waitFor(() =>
      expect(screen.getByTestId('member-offboard-confirming').textContent).toContain('토큰 1개'),
    );
    expect(screen.getByTestId('member-offboard-confirming').textContent).toContain('멤버십 2개');
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByTestId('member-offboard-confirm'));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.map((s) => `${s.method} ${s.url.replace(/^.*\/api\/v1/, '')}`)).toEqual([
      'DELETE /me/tokens/t-yuna',
      'DELETE /memberships/m-yuna-1',
      'DELETE /memberships/m-yuna-2',
    ]);
  });

  it('자신은 내보낼 수 없다 — 비활성 + 사유', async () => {
    renderAt('/settings/members');
    const row = await firstRowOf('관리자');
    const exit = within(row).getByTestId('member-offboard') as HTMLButtonElement;
    expect(isLocked(exit)).toBe(true);
    expect(reasonOf(exit)).toBe('자신은 내보낼 수 없습니다.');
  });
});

describe('조직의 마지막 admin (REQ-WEB-201 · REQ-API-174)', () => {
  it('유일한 조직 admin 의 admin 칩은 잠기고, 왜 잠겼는지 말한다', async () => {
    renderAt('/settings/members');
    const row = await firstRowOf('관리자');
    const chip = within(row).getByTestId('role-admin') as HTMLButtonElement;
    await waitFor(() => expect(chip.disabled).toBe(true));
    expect(chip.title).toBe(
      '이 조직의 마지막 admin 입니다 — 다른 사람을 먼저 조직 admin 으로 세우세요.',
    );
  });

  it('누를 수 있는 칩에는 "admin 만 가능" 을 달지 않는다', async () => {
    renderAt('/settings/members');
    const row = await firstRowOf('유나');
    const chip = within(row).getByTestId('role-qa') as HTMLButtonElement;
    await waitFor(() => expect(chip.disabled).toBe(false));
    expect(chip.title).toBe('');
  });

  it('다른 admin 이 있으면 내 admin 칩은 끄기 전에 한 번 묻는다', async () => {
    MEMBERS.push({
      id: 'm-yuna-admin',
      role: 'admin',
      user_id: 'u-2',
      email: 'yuna@example.com',
      display_name: '유나',
      project_slug: null,
      project_name: null,
    });
    try {
      renderAt('/settings/members');
      const row = await firstRowOf('관리자');
      const chip = within(row).getByTestId('role-admin') as HTMLButtonElement;
      await waitFor(() => expect(chip.disabled).toBe(false));
      fireEvent.click(chip);
      expect(sent).toHaveLength(0);
      expect(screen.getByTestId('self-admin-confirming').textContent).toContain('편집이 잠깁니다');
      fireEvent.click(screen.getByTestId('self-admin-confirm'));
      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]?.url).toMatch(/\/memberships\/m-admin$/);
    } finally {
      MEMBERS.pop();
    }
  });
});

describe('바꿀 수 없는 사람에게 — 숨기지 않고, 누구에게 부탁할지 (REQ-WEB-201)', () => {
  it('초대 구역이 보이고 단추는 잠기며, 안내가 조직 admin 의 이름을 댄다', async () => {
    me = DEVELOPER;
    renderAt('/settings/members');
    const invite = (await screen.findByTestId('invite-new')) as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    expect((await screen.findByTestId('read-only-ask')).textContent).toBe(
      '바꾸려면 관리자에게 요청하세요.',
    );
  });
});

/** 정책이 도착해 고칠 수 있게 될 때까지 — 그 전의 칸은 기본값이라 고쳐도 저장이 잠겨 있다 */
async function gatesReady(): Promise<void> {
  const save = (await screen.findByTestId('gates-save')) as HTMLButtonElement;
  await waitFor(() => expect(save.title).toBe('바뀐 값이 없습니다'));
}

describe('게이트 정책 — 칸 셋 · 검증 · 전후 (REQ-WEB-201)', () => {
  it('바뀐 것이 없으면 저장이 꺼져 있고, 요약이 티어마다의 점수를 말한다', async () => {
    renderAt('/settings/gates');
    await gatesReady();
    expect((screen.getByTestId('gates-save') as HTMLButtonElement).disabled).toBe(true);
    const summary = screen.getByTestId('gates-summary').textContent ?? '';
    expect(summary).toContain('T0 0~1점 · 자동 통과');
    expect(summary).toContain('T3 6점 이상 · 직군이 다른 2인 승인');
  });

  it('성립하지 않는 경계는 저장 전에 말한다 — 서버 오류로 돌아오지 않게', async () => {
    renderAt('/settings/gates');
    await gatesReady();
    const t2 = screen.getByTestId('gate-boundary-T2') as HTMLInputElement;
    fireEvent.change(t2, { target: { value: '9' } });
    expect(screen.getByTestId('gates-invalid')).toBeDefined();
    expect((screen.getByTestId('gates-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('자동 통과를 넓히는 저장은 전후를 보이고 한 번 더 묻는다', async () => {
    renderAt('/settings/gates');
    await gatesReady();
    const t2 = screen.getByTestId('gate-boundary-T2') as HTMLInputElement;
    fireEvent.change(t2, { target: { value: '5' } });
    expect(screen.getByTestId('gates-unsaved').textContent).toContain('2 · 4 · 6 → 2 · 5 · 6');
    fireEvent.click(screen.getByTestId('gates-save'));
    expect(sent).toHaveLength(0);
    expect(screen.getByTestId('gates-save-confirming').textContent).toContain(
      '자동 통과가 넓어집니다',
    );
    fireEvent.click(screen.getByTestId('gates-save-confirm'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body['gate_policy']).toMatchObject({
      spec_gate: { tier_boundaries: [2, 5, 6], dynamic_escalation: true },
    });
  });

  it('고친 채 다른 프로젝트를 고르면 버릴지 묻는다 — 말없이 버리지 않는다', async () => {
    renderAt('/settings/gates');
    await gatesReady();
    const t1 = screen.getByTestId('gate-boundary-T1') as HTMLInputElement;
    fireEvent.change(t1, { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('gates-project'), { target: { value: 'sudoku' } });
    expect(screen.getByTestId('gates-switch-confirming').textContent).toContain('스도쿠');
    // 아직 옮기지 않았다 — 고친 값이 그대로다
    expect((screen.getByTestId('gate-boundary-T1') as HTMLInputElement).value).toBe('1');
    fireEvent.click(screen.getByTestId('gates-switch-confirm'));
    expect(await screen.findByText('게이트 정책 — 스도쿠')).toBeDefined();
  });
});
