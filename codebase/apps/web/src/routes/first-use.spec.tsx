// 첫 사용 — REQ-WEB-205 · REQ-API-178 (2026-09-24 · UI/UX 검토 P06a)
//
// 조직을 만든 사람은 곧장 프로젝트 0개인 홈에 떨어졌고, 온보딩의 ②역할·③다음 행동은 아무도 보지
// 못했다. 헤더 프로젝트 선택기는 0개면 잠겨 "새 프로젝트" 링크에 닿을 수 없었다. 원치 않는 초대는
// 거절할 길이 없어 7일 동안 맨 위에 서 있었고, 다른 계정으로 연 초대 링크는 [참여하기]를 누른 뒤에야
// 오류를 말했다. "조직 관리 · 새 조직" 을 눌러도 새 조직을 만들 곳이 없었다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
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

interface World {
  memberships: Row[];
  projects: Row[];
  members: Row[];
  invitations: Row[];
  tokens: Row[];
  myInvitations: Row[];
  preview: Row | null;
}

const ORG_ADMIN = [
  { org_slug: 'acme', org_name: 'Acme', project_slug: null, project_name: null, roles: ['admin'] },
];
const ORG_VIEWER = [
  { org_slug: 'acme', org_name: 'Acme', project_slug: null, project_name: null, roles: ['viewer'] },
];

let world: World;
let posted: { url: string; body: Row }[] = [];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  world = {
    memberships: ORG_ADMIN,
    projects: [],
    members: [{ user_id: 'u-1', display_name: '지민', role: 'admin', project_slug: null }],
    invitations: [],
    tokens: [],
    myInvitations: [],
    preview: null,
  };
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Row;
        posted.push({ url: u, body });
        if (u === '/orgs') {
          world.memberships = [
            {
              org_slug: body['slug'],
              org_name: body['name'],
              project_slug: null,
              project_name: null,
              roles: ['admin'],
            },
          ];
        }
        if (/^\/orgs\/[^/]+\/projects$/.test(u)) {
          world.projects = [
            ...world.projects,
            { id: `p-${u}`, slug: body['slug'], name: body['name'] },
          ];
        }
        return ok({ ok: true });
      }
      if (u === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          email: 'jimin@example.com',
          memberships: world.memberships,
        });
      }
      if (/^\/orgs\/[^/]+\/projects/.test(u)) return ok(world.projects);
      if (/^\/orgs\/[^/]+\/members/.test(u)) return ok(world.members);
      if (/^\/orgs\/[^/]+\/invitations/.test(u)) return ok(world.invitations);
      if (u === '/me/tokens') return ok(world.tokens);
      if (u === '/me/invitations') return ok(world.myInvitations);
      if (/^\/invitations\/[^/]+$/.test(u)) {
        return world.preview === null
          ? {
              ok: false,
              status: 409,
              json: async () => ({
                ok: false,
                code: NERV_ERROR.PRECONDITION,
                message: '초대를 찾을 수 없습니다.',
                details: { kind: 'not_found' },
                retry_after_s: null,
                next_actions: [],
              }),
            }
          : ok(world.preview);
      }
      return ok({ items: [], next_cursor: null, total: 0, count: 0, summary: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** 검사가 읽는 것은 지금 주소뿐이다 */
interface Here {
  state: { location: { pathname: string; href: string } };
}

function renderAt(path: string): Here {
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

describe('조직을 만든 뒤 — 떠나지 않고 다음 걸음을 말한다', () => {
  it('온보딩에 머물러 ②③ 과 시작 체크리스트를 보이고, 첫 프로젝트를 같이 만든다', async () => {
    world.memberships = [];
    const router = renderAt('/onboarding');
    fireEvent.change(await screen.findByTestId('org-name'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByTestId('first-project-name'), { target: { value: 'Web App' } });
    fireEvent.submit(screen.getByTestId('org-name').closest('form')!);

    const checklist = await screen.findByTestId('start-checklist');
    expect(router.state.location.pathname).toBe('/onboarding');
    expect(posted.map((p) => p.url)).toEqual(['/orgs', '/orgs/acme/projects']);
    expect(posted[1]?.body).toMatchObject({ name: 'Web App', slug: 'web-app', key: 'WEB' });
    // 방금 만든 프로젝트는 끝난 걸음이다 — 남은 것은 사람과 에이전트다
    expect(within(checklist).getByTestId('start-step-project').dataset['done']).toBe('true');
    expect(within(checklist).getByTestId('start-step-invite').dataset['done']).toBeUndefined();
  });

  it('프로젝트 이름이 한글뿐이면 조직 slug 를 빌린다 — 빈 slug 로 보내지 않는다', async () => {
    world.memberships = [];
    renderAt('/onboarding');
    fireEvent.change(await screen.findByTestId('org-name'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByTestId('first-project-name'), { target: { value: '본편' } });
    fireEvent.submit(screen.getByTestId('org-name').closest('form')!);
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.body).toMatchObject({ name: '본편', slug: 'acme', key: 'ACM' });
  });
});

describe('프로젝트가 0개인 홈', () => {
  it('조직 admin 에게는 시작 체크리스트 — 첫 걸음은 폼이 열린 채 도착하는 링크다', async () => {
    renderAt('/');
    const checklist = await screen.findByTestId('start-checklist');
    const link = within(within(checklist).getByTestId('start-step-project')).getByRole('link');
    expect(link.getAttribute('href')).toBe('/settings/projects?new=1');
    // 초대 걸음은 초대 탭으로 연다 — 멤버 탭이 기본이다(REQ-WEB-242)
    expect(
      within(within(checklist).getByTestId('start-step-invite'))
        .getByRole('link')
        .getAttribute('href'),
    ).toBe('/settings/members?tab=invites');
    // 프로젝트가 없으면 활동도 없다 — "알림이 없습니다." 를 활동 자리에 적지 않는다
    expect(screen.queryByText('알림이 없습니다.')).toBeNull();
  });

  it('닫으면 사라지고 이 브라우저가 기억한다', async () => {
    renderAt('/');
    fireEvent.click(await screen.findByTestId('start-dismiss'));
    expect(screen.queryByTestId('start-checklist')).toBeNull();
    expect(localStorage.getItem('nerv.start-dismissed.acme')).toBe('1');
  });

  it('조직 admin 이 아니면 체크리스트 대신 누구에게 부탁할지를 말한다', async () => {
    world.memberships = ORG_VIEWER;
    world.members = [{ user_id: 'u-9', display_name: '관리자', role: 'admin', project_slug: null }];
    renderAt('/');
    const notice = await screen.findByTestId('read-only-notice');
    await waitFor(() => expect(notice.textContent).toContain('관리자'));
    expect(notice.textContent).toContain('참여 중인 프로젝트가 없습니다');
    expect(screen.queryByTestId('start-checklist')).toBeNull();
  });
});

describe('사이드바의 프로젝트 목록 (2026-09-25 D1 · REQ-WEB-225)', () => {
  // 헤더 선택기는 0개면 잠겨 "새 프로젝트" 링크에 닿을 수 없었다 — 목록은 열고 닫는 것이 아니라 늘 서 있다
  it('0개여도 선다 — "아직 프로젝트가 없습니다" 와 폼이 열린 채 가는 링크(조직 admin)', async () => {
    renderAt('/');
    const rail = await screen.findByTestId('nav-rail');
    expect(await within(rail).findByTestId('project-none')).toBeTruthy();
    const link = within(rail).getByTestId('project-new-link');
    expect(link.textContent).toBe('프로젝트 관리 · 새 프로젝트');
    expect(link.getAttribute('href')).toBe('/settings/projects?new=1');
  });

  it('조직 admin 이 아니면 "새 프로젝트" 를 약속하지 않는다', async () => {
    world.memberships = ORG_VIEWER;
    renderAt('/');
    const rail = await screen.findByTestId('nav-rail');
    const link = await within(rail).findByTestId('project-new-link');
    await waitFor(() => expect(link.textContent).toBe('프로젝트 관리'));
    expect(link.getAttribute('href')).toBe('/settings/projects');
  });
});

describe('설정 → 조직 정보 · 프로젝트 목록', () => {
  it('?new=1 로 오면 프로젝트 폼이 열린 채 도착한다', async () => {
    renderAt('/settings/projects?new=1');
    expect(await screen.findByTestId('project-name')).toBeTruthy();
  });

  it('새 조직을 만들 수 있다 — 만들면 그 조직의 첫 프로젝트 만들기로 옮겨 간다', async () => {
    const router = renderAt('/settings/org');
    fireEvent.click(await screen.findByTestId('new-org-toggle'));
    const form = within(screen.getByTestId('new-org'));
    fireEvent.change(form.getByTestId('org-name'), { target: { value: 'Beta Labs' } });
    fireEvent.submit(form.getByTestId('org-name').closest('form')!);
    await waitFor(() =>
      expect(posted[0]).toMatchObject({ url: '/orgs', body: { slug: 'beta-labs' } }),
    );
    await waitFor(() => expect(router.state.location.href).toContain('/settings/projects?new=1'));
  });
});

describe('초대 — 거절하고, 언제까지인지 알고, 계정이 맞는지 안다', () => {
  const invitation = {
    id: 'inv-1',
    org_slug: 'beta',
    org_name: 'Beta',
    project_slug: null,
    role: 'developer',
    invited_by: '하나',
    state: 'pending',
  };

  it('카드에 만료까지 남은 날과 [거절] — 확인을 거쳐 거절한다', async () => {
    world.myInvitations = [
      { ...invitation, expires_at: new Date(Date.now() + 3.5 * 86_400_000).toISOString() },
    ];
    renderAt('/');
    expect((await screen.findByTestId('invite-expiry')).textContent).toContain('3일 뒤 만료');
    fireEvent.click(screen.getByTestId('invite-decline'));
    fireEvent.click(await screen.findByTestId('invite-decline-confirm'));
    await waitFor(() =>
      expect(posted.map((p) => p.url)).toContain('/me/invitations/inv-1/decline'),
    );
  });

  it('링크를 다른 계정으로 열면 [참여하기] 대신 계정을 바꾸는 길을 준다', async () => {
    world.preview = {
      ...invitation,
      email_hint: 'g***@example.com',
      matches_me: false,
    };
    renderAt('/invite/tok-1');
    expect(await screen.findByTestId('invite-wrong-account')).toBeTruthy();
    expect(screen.getByTestId('invite-signed-in-as').textContent).toContain('jimin@example.com');
    expect(screen.queryByTestId('invite-accept')).toBeNull();
  });

  it('끝난 초대와 없는 링크에도 다음 걸음이 있다', async () => {
    world.preview = { ...invitation, email_hint: 'g***@example.com', state: 'expired' };
    renderAt('/invite/tok-1');
    expect(await screen.findByTestId('invite-next')).toBeTruthy();
    cleanup();

    world.preview = null;
    renderAt('/invite/tok-2');
    expect(await screen.findByTestId('invite-error')).toBeTruthy();
    expect(screen.getByTestId('invite-next')).toBeTruthy();
  });
});

describe('토큰 탭', () => {
  it('조직 admin 에게 "admin 에게 요청하세요" 대신 프로젝트를 만들러 가는 길을 준다', async () => {
    renderAt('/settings/tokens');
    const link = await screen.findByTestId('token-create-project');
    expect(link.getAttribute('href')).toBe('/settings/projects?new=1');
  });
});
