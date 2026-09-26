// E01-S03 수용 기준의 실증.
//
//   WHEN `pnpm dev` 로 웹을 기동하면,
//   THE SYSTEM SHALL 라우팅 맵의 기본 경로와 앱 셸을 렌더링한다
//
// 메모리 히스토리로 같은 라우트 트리를 태워 확인한다. 화면 실물은 E08 이 채우지만,
// **경로·가드·셸**이 먼저 서 있어야 딥링크와 사이드바 조건 렌더가 검증 가능하다.

import { LocaleProvider } from '../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';

// 라우팅 검증에 실제 소켓은 필요 없다 — 연결 규약은 realtime.spec.ts 소관이다.
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

// 화면은 서버 상태를 TanStack Query 로 읽는다 — main.tsx 와 같은 조립으로 태운다.
function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return {
    router,
    ...render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <RealtimeProvider>
            <RouterProvider router={router} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    ),
  };
}

beforeEach(() => {
  localStorage.clear();
  // 라우팅 검증이 목적이라 네트워크는 빈 응답으로 고정한다. **다만 소속 두 축은
  // 채운다** — 조직·프로젝트 select 는 memberships·프로젝트 목록에서 오므로 빈
  // 응답이면 헤더의 절반이 아예 렌더되지 않는다.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const json = path.includes('/projects')
        ? [{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }]
        : path.includes('/me')
          ? {
              id: 'u-1',
              display_name: '지민',
              memberships: [
                { org_slug: 'nerv', org_name: 'NERV', project_slug: 'clemvion', roles: ['admin'] },
              ],
            }
          : // me 는 배열이 아니라 객체다 — 셸이 memberships 를 읽는다
            { items: [], summary: {}, next_cursor: null, memberships: [], count: 0 };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('라우팅 맵 (screens.md §1.2)', () => {
  it('기본 경로 / 가 앱 셸과 S1 을 렌더한다', async () => {
    renderAt('/');
    await waitFor(() => expect(screen.getByTestId('today-strip')).toBeDefined());
    // 앱 셸 — 전역 헤더 · 토스트 아웃렛 · ⌘K 진입점(§1.3)
    // 로고(제품)와 조직 select 가 이름을 공유할 수 있다 — 시드의 조직이 'NERV' 다.
    // 둘은 다른 것이므로 각각을 가려서 본다.
    expect(screen.getAllByText('NERV').length).toBeGreaterThan(0);
    expect(screen.getByTestId('org-switcher').textContent).toContain('NERV');
    expect(screen.getByTestId('toast-outlet')).toBeDefined();
    expect(screen.getByText(/검색/)).toBeDefined();
  });

  it.each([
    ['/login', '로그인'],
    ['/onboarding', '시작하기'],
    ['/inbox', /받은 요청/],
    ['/notifications', '알림'],
  ])('전역 경로 %s 가 렌더된다', async (path, title) => {
    renderAt(path);
    await waitFor(() => expect(screen.getAllByText(title).length).toBeGreaterThan(0));
  });

  it.each([
    ['/p/clemvion', '구현 현황'],
    ['/p/clemvion/specs', /^스펙$/],
    ['/p/clemvion/specs/SPC-CWC-007', 'SPC-CWC-007'],
    ['/p/clemvion/tasks', '작업 보드'],
    ['/p/clemvion/tasks/CLV-T-0CFQC2', 'CLV-T-0CFQC2'],
    ['/p/clemvion/sessions', '세션 모니터'],
    // 상세의 제목도 카탈로그에서 온다 — `Activity` 한 낱말이 코드에 굳어 있었고,
    // 로케일을 바꿔도 그 자리만 영어로 남았다(2026-09-07 · REQ-CB-022)
    ['/p/clemvion/sessions/S-b7e9', '활동'],
  ])('프로젝트 경로 %s 가 렌더된다', async (path, title) => {
    renderAt(path);
    await waitFor(() => expect(screen.getAllByText(title).length).toBeGreaterThan(0));
  });

  it('프로젝트 사이드바는 /p/:proj/* 에서만 나온다 (§1.3)', async () => {
    const { unmount } = renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByText('작업 보드')).toBeDefined());
    // 사이드바 제목과 헤더 프로젝트 select 양쪽에 이름이 있다 — 사이드바 쪽을 본다
    expect(screen.getAllByText('clemvion').length).toBeGreaterThan(0);
    // 리뷰 탭은 2026-08-23 에 열렸다 — 비활성 표기 대신 실제 링크다(screens.md §2.6a)
    expect(screen.getByRole('link', { name: /리뷰/ }).getAttribute('href')).toBe(
      '/p/clemvion/reviews',
    );
    unmount();

    renderAt('/inbox');
    await waitFor(() => expect(screen.getAllByText(/받은 요청/).length).toBeGreaterThan(0));
    expect(screen.queryByText('clemvion')).toBeNull();
  });

  it('/settings 는 첫 무리(조직)의 첫 항목 — 조직 정보로 리다이렉트한다 (2026-09-26 · REQ-WEB-227 · 242)', async () => {
    renderAt('/settings');
    // 제목에 조직 이름이 있다("{조직} 조직 정보") — 예전에는 둘째 칸인 멤버·역할이 열렸다
    await waitFor(() => expect(screen.getByText(/조직 정보$/, { selector: 'h1' })).toBeDefined());
  });

  it('/o/:org 는 화면 없이 / 로 리다이렉트한다 (§1.6 — 그림 비대상)', async () => {
    renderAt('/o/acme');
    await waitFor(() => expect(screen.getByTestId('today-strip')).toBeDefined());
  });

  it('설정 항목이 전부 있다 — git 연동 탭은 Phase 2 (scope.md §4.1)', async () => {
    for (const [path, title] of [
      // 멤버는 조직을, 게이트는 프로젝트를 제목에 넣는다(REQ-WEB-191)
      // 조직 정보와 프로젝트 목록은 2026-09-26 부터 두 화면이다(REQ-WEB-242)
      ['/settings/org', /조직 정보$/],
      ['/settings/projects', /프로젝트$/],
      ['/settings/members', /멤버·역할$/],
      ['/settings/tokens', /^에이전트 토큰$/],
      ['/settings/gates', /^게이트 정책/],
    ] as const) {
      const { unmount } = renderAt(path);
      await waitFor(() => expect(screen.getByText(title, { selector: 'h1' })).toBeDefined());
      unmount();
    }
  });
});

// 2026-09-07 — 상세의 막힘 카드가 **어휘 밖의 값에도** 문구 키를 만들어 붙였다.
// 카탈로그에 없는 키는 번역기가 키 자체를 돌려주므로(마지막 폴백) 화면에 `blocked.…` 가
// 그대로 떴다 — 사람이 적어 둔 사유가 있는데 그것을 못 보게 하는 모양이다.
describe('막힘 사유는 사람 말이다 (REQ-WEB-143)', () => {
  /** 상세 응답에 막힘 파생을 실어 준다(REQ-API-118) */
  function stubTask(reason: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const path = String(url);
        const json = path.includes('/tasks/')
          ? {
              id: 't-1',
              key: 'CLV-T-0CFQC2',
              title: '막힌 작업',
              status: 'blocked',
              blocked_reason: reason,
              blocked_resolution: { reason, satisfied: false, pending: [] },
              claims: [],
              evidence: [],
            }
          : path.includes('/projects')
            ? [{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }]
            : path.includes('/me')
              ? { id: 'u-1', display_name: '지민', memberships: [] }
              : { items: [], summary: {}, next_cursor: null, memberships: [], count: 0 };
        return { ok: true, status: 200, json: async () => json };
      }),
    );
  }

  it('어휘 안의 값은 라벨로 — 식별자를 그대로 찍지 않는다', async () => {
    stubTask('awaiting_answer');
    renderAt('/p/clemvion/tasks/CLV-T-0CFQC2');
    const reason = await screen.findByTestId('blocked-reason');
    expect(reason.textContent).toBe('답변 대기');
    expect(document.body.textContent).not.toContain('blocked.');
  });

  it('어휘 밖의 값은 **원문 그대로** — 옛 자유 텍스트가 키에 삼켜지지 않는다', async () => {
    stubTask('디자인 확정 대기');
    renderAt('/p/clemvion/tasks/CLV-T-0CFQC2');
    const reason = await screen.findByTestId('blocked-reason');
    expect(reason.textContent).toBe('디자인 확정 대기');
    expect(document.body.textContent).not.toContain('blocked.');
  });
});

describe('사이드바 — 조직 · 프로젝트 (2026-09-25 사람 결정 D1 · REQ-WEB-225)', () => {
  // 2026-08-24 의 "헤더에 조직 ▾ → 프로젝트 ▾ · 그 오른쪽에 프로젝트로 가는 링크" 는 D1 이 개정했다 —
  // 둘 다 모든 화면에 서는 왼쪽 열로 내려갔고, 헤더에는 지금 자리(조직 › 프로젝트 › 화면)만 남는다.
  const rail = async (): Promise<HTMLElement> => screen.findByTestId('nav-rail');

  it('조직 전환기와 프로젝트가 왼쪽 열에 있다', async () => {
    renderAt('/p/clemvion/tasks');
    const nav = await rail();
    await waitFor(() => expect(within(nav).getByTestId('rail-project-current')).toBeDefined());
    expect(within(nav).getByTestId('org-switcher')).toBeDefined();
  });

  it('프로젝트 이름이 그 프로젝트로 가는 길이다 — 헤더의 [프로젝트] 링크는 걷었다(NAV-05)', async () => {
    renderAt('/p/clemvion/tasks');
    const nav = await rail();
    await waitFor(() =>
      expect(within(nav).getByTestId('rail-project-current').getAttribute('href')).toBe(
        '/p/clemvion',
      ),
    );
    const header = document.querySelector('header')!;
    expect(within(header).queryByRole('link', { name: '프로젝트' })).toBeNull();
  });

  it('헤더에서 `/` 로 가는 길은 로고 하나다 (2026-08-30)', async () => {
    renderAt('/p/clemvion/tasks');
    await rail();
    // 같은 목적지로 가는 길을 둘 두면 헤더에서 가장 비싼 왼쪽 끝이 두 번 쓰인다 — 브레드크럼의 조직은 글자다
    const header = document.querySelector('header')!;
    const toRoot = within(header)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/');
    expect(toRoot).toHaveLength(1);
    expect(toRoot[0]?.textContent).toContain('NERV');
  });

  it('조직 메뉴 **안**을 눌러도 닫히지 않는다 — 닫히면 그 항목은 눌러도 아무 일이 없다', async () => {
    renderAt('/p/clemvion/tasks');
    fireEvent.click(await screen.findByTestId('org-switcher'));
    const link = await screen.findByText('조직 관리 · 새 조직');
    fireEvent.mouseDown(link);
    expect(screen.queryByText('조직 관리 · 새 조직')).not.toBeNull();
    // 진짜 바깥은 여전히 닫는다
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('조직 관리 · 새 조직')).toBeNull());
  });

  it('조직 범위 화면에서는 프로젝트를 펼치지 않는다 — 기억은 "최근" 표식이다', async () => {
    // 2026-09-24 사람 결정(REQ-WEB-193)의 목적 — 조직 범위 화면이 한 프로젝트의 것처럼 읽히지 않는다 — 을
    // 구조가 지킨다: 그 화면에서는 어떤 프로젝트도 펼쳐지지 않고, 기억한 것은 목록의 "최근" 이다.
    const first = renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(localStorage.getItem('nerv.last-project.nerv')).toBe('clemvion'));
    first.unmount();

    renderAt('/inbox');
    const nav = await rail();
    const recent = await within(nav).findByTestId('project-recent');
    expect(recent.closest('a')?.getAttribute('href')).toBe('/p/clemvion');
    expect(within(nav).queryByTestId('rail-project-current')).toBeNull();
  });
});
