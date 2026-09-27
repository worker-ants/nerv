// 한 프로젝트에서만 빼기 — 줄마다 판정한다 (2026-09-27 · 사람 결정 P1 · P3 · REQ-WEB-263)
//
// 조직 admin 이면서 프로젝트 admin 인 사람(스크린샷의 gehrig)에게는 프로젝트 줄의 [이 프로젝트에서 빼기]가
// 나오지 않았다 — 줄 끝 단추를 고르는 코드가 조직 admin 분기에서 먼저 끝나서, 프로젝트 admin 권한이 가려졌다.
// 같은 표를 sudoku 만의 admin 으로 보면 단추가 나왔다. 권한이 넓을수록 할 수 있는 일이 적었다.

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

const member = (id: string, user: string, name: string, role: string, project: string | null) => ({
  id,
  role,
  user_id: user,
  email: `${user}@example.com`,
  display_name: name,
  project_slug: project,
  project_name: project,
});
/** 스크린샷의 모양 — gehrig 은 조직 전체 admin 이면서 두 프로젝트의 admin, 에체스는 한 프로젝트에만 속한다 */
const MEMBERS = [
  member('e1', 'u-e', '에체스', 'viewer', 'ncoser'),
  member('j1', 'u-j', '제이엠', 'viewer', 'coser'),
  member('j2', 'u-j', '제이엠', 'viewer', 'sudoku'),
  member('g0', 'u-g', 'gehrig', 'admin', null),
  member('g1', 'u-g', 'gehrig', 'admin', 'coser'),
  member('g2', 'u-g', 'gehrig', 'admin', 'sudoku'),
];
const PROJECTS = [
  { id: 'p-1', slug: 'coser', name: 'coser' },
  { id: 'p-2', slug: 'ncoser', name: 'ncoser' },
  { id: 'p-3', slug: 'sudoku', name: 'sudoku' },
];
const LATER = '2099-01-01T00:00:00Z';
const token = (id: string, owner: string, project: string) => ({
  id,
  name: id,
  prefix: 'nerv_x',
  scopes: [],
  owner,
  owner_id: owner,
  project_slug: project,
  project_name: project,
  revoked_at: null,
  expires_at: LATER,
  last_used_at: null,
  last_used_hostname: null,
});
const TOKENS = [token('t-e', 'u-e', 'ncoser'), token('t-j', 'u-j', 'sudoku')];

const GEHRIG = {
  id: 'u-g',
  email: 'u-g@example.com',
  display_name: 'gehrig',
  memberships: [
    { org_slug: 'default', org_name: 'Default', project_slug: null, roles: ['admin'] },
    { org_slug: 'default', org_name: 'Default', project_slug: 'coser', roles: ['admin'] },
    { org_slug: 'default', org_name: 'Default', project_slug: 'sudoku', roles: ['admin'] },
  ],
};
/** sudoku 만의 admin — 조직 전체 역할이 없다 */
const SUDOKU_ADMIN = {
  id: 'u-s',
  email: 'u-s@example.com',
  display_name: '서연',
  memberships: [
    { org_slug: 'default', org_name: 'Default', project_slug: 'sudoku', roles: ['admin'] },
  ],
};

let me: unknown = GEHRIG;
let sent: string[] = [];

beforeEach(() => {
  localStorage.clear();
  me = GEHRIG;
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        sent.push(`${method} ${path.replace(/^.*\/api\/v1/, '')}`);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const json = path.endsWith('/members')
        ? MEMBERS
        : path.includes('/invitations') || path.endsWith('/me/tokens')
          ? []
          : /\/orgs\/[^/]+\/tokens/.test(path)
            ? TOKENS
            : /\/orgs\/[^/]+\/projects/.test(path)
              ? PROJECTS
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

/** 표의 줄마다 [사람 · 범위 · 조직 단추 · 프로젝트 단추] — 사람은 묶음의 첫 줄에만 적힌다 */
async function exits(): Promise<string[]> {
  await screen.findAllByTestId('member-scope');
  return screen.getAllByTestId('member-scope').map((scope) => {
    const tr = scope.closest('tr') as HTMLElement;
    const person = within(tr).queryByTestId('member-person')?.textContent ?? '·';
    const org = within(tr).queryByTestId('member-offboard');
    const project = within(tr).queryByTestId('member-remove-project');
    const mark = (b: HTMLElement | null, label: string): string =>
      b === null ? '' : ` ${label}${b.getAttribute('aria-disabled') === 'true' ? '(잠김)' : ''}`;
    return `${person} ${String(scope.textContent)}${mark(org, 'ORG')}${mark(project, 'PROJECT')}`;
  });
}

/** 범위 칸의 글자로 줄을 찾는다 — 같은 범위가 여럿이면 그 사람의 묶음에서 찾는다 */
async function rowOf(person: string, scope: string): Promise<HTMLElement> {
  await screen.findAllByTestId('member-scope');
  const rows = screen.getAllByTestId('member-scope').map((s) => s.closest('tr') as HTMLElement);
  let current = '';
  for (const tr of rows) {
    const name = within(tr).queryByTestId('member-person')?.textContent;
    if (name !== undefined && name !== null) current = name;
    if (current === person && within(tr).getByTestId('member-scope').textContent === scope) {
      return tr;
    }
  }
  throw new Error(`줄이 없다 — ${person} · ${scope}`);
}

describe('줄마다 판정한다 — 조직 admin 권한이 프로젝트 admin 권한을 가리지 않는다 (REQ-WEB-263)', () => {
  it('gehrig(조직 admin + 프로젝트 admin): 모든 프로젝트 줄에 빼기, 사람마다 이름 아래 조직에서 내보내기', async () => {
    renderAt('/settings/members');
    expect(await exits()).toEqual([
      '에체스 ncoser ORG PROJECT',
      '제이엠 coser ORG PROJECT',
      '· sudoku PROJECT',
      // 자기 자신은 빼거나 내보낼 수 없다 — 숨기지 않고 잠근다(REQ-WEB-003)
      'gehrig 조직 전체 ORG(잠김)',
      '· coser PROJECT(잠김)',
      '· sudoku PROJECT(잠김)',
    ]);
    expect(screen.getAllByTestId('member-offboard')[0]?.textContent).toBe('조직에서 내보내기…');
  });

  it('sudoku 만의 admin: sudoku 줄에만 빼기가 있고, 조직에서 내보내기는 없다', async () => {
    me = SUDOKU_ADMIN;
    renderAt('/settings/members');
    expect(await exits()).toEqual([
      '에체스 ncoser',
      '제이엠 coser',
      '· sudoku PROJECT',
      'gehrig 조직 전체',
      '· coser',
      '· sudoku PROJECT',
    ]);
  });
});

describe('빼기 전에 무엇이 지워지는지 적는다', () => {
  it('제이엠을 sudoku 에서만 뺀다 — 그 줄의 역할만 지우고 coser 는 그대로다', async () => {
    renderAt('/settings/members');
    fireEvent.click(within(await rowOf('제이엠', 'sudoku')).getByTestId('member-remove-project'));
    const box = await screen.findByTestId('member-remove-project-confirming');
    expect(box.textContent).toContain('제이엠을(를) sudoku에서 뺍니다.');
    expect(box.textContent).toContain('이 프로젝트의 역할 1개를 지웁니다.');
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByTestId('member-remove-project-confirm'));
    await waitFor(() => expect(sent).toEqual(['DELETE /memberships/j2']));
  });

  it('조직 전체 역할이 있으면 "역할 지우기" 이고, 계속 볼 수 있다고 적는다 (사람 결정 P3)', async () => {
    me = SUDOKU_ADMIN;
    renderAt('/settings/members');
    const button = within(await rowOf('gehrig', 'sudoku')).getByTestId('member-remove-project');
    expect(button.textContent).toBe('이 프로젝트 역할 지우기…');
    fireEvent.click(button);
    const box = await screen.findByTestId('member-remove-project-confirming');
    expect(box.textContent).toContain('gehrig의 sudoku 역할 1개를 지웁니다.');
    expect(box.textContent).toContain(
      '조직 전체 역할(admin)이 있어 sudoku을(를) 계속 볼 수 있습니다.',
    );
    fireEvent.click(screen.getByTestId('member-remove-project-confirm'));
    await waitFor(() => expect(sent).toEqual(['DELETE /memberships/g2']));
  });

  it('그 조직의 마지막 소속이면 조직에서도 나간다고 적고, 조직 admin 이면 토큰도 끊는다', async () => {
    renderAt('/settings/members');
    fireEvent.click(within(await rowOf('에체스', 'ncoser')).getByTestId('member-remove-project'));
    const box = await screen.findByTestId('member-remove-project-confirming');
    expect(box.textContent).toContain('빼면 조직에서도 나갑니다.');
    await waitFor(() => expect(box.textContent).toContain('유효한 토큰 1개'));
    fireEvent.click(screen.getByTestId('member-remove-project-confirm'));
    await waitFor(() => expect(sent).toEqual(['DELETE /me/tokens/t-e', 'DELETE /memberships/e1']));
  });

  it('취소하면 누른 단추로 돌아온다 — 아무것도 보내지 않는다', async () => {
    renderAt('/settings/members');
    const button = within(await rowOf('제이엠', 'sudoku')).getByTestId('member-remove-project');
    fireEvent.click(button);
    fireEvent.click(await screen.findByTestId('member-remove-project-cancel'));
    expect(screen.queryByTestId('member-remove-project-confirming')).toBeNull();
    await waitFor(() =>
      expect(
        within(screen.getAllByTestId('member-scope')[2]?.closest('tr') as HTMLElement)
          .getByTestId('member-remove-project')
          .isSameNode(document.activeElement),
      ).toBe(true),
    );
    expect(sent).toEqual([]);
  });
});
