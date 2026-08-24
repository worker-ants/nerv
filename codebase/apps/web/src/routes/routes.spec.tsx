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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  // 라우팅 검증이 목적이라 네트워크는 빈 응답으로 고정한다. **다만 스코프 두 축은
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
    ['/inbox', /승인함/],
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
    ['/p/clemvion/sessions/S-b7e9', 'Activity'],
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
    await waitFor(() => expect(screen.getAllByText(/승인함/).length).toBeGreaterThan(0));
    expect(screen.queryByText('clemvion')).toBeNull();
  });

  it('/settings 는 멤버 탭으로 리다이렉트한다', async () => {
    renderAt('/settings');
    await waitFor(() => expect(screen.getByText('멤버·역할', { selector: 'h1' })).toBeDefined());
  });

  it('/o/:org 는 화면 없이 / 로 리다이렉트한다 (§1.6 — 그림 비대상)', async () => {
    renderAt('/o/acme');
    await waitFor(() => expect(screen.getByTestId('today-strip')).toBeDefined());
  });

  it('설정 탭 3종이 전부 있다 — git 연동 탭은 Phase 2 (scope.md §4.1)', async () => {
    for (const [path, title] of [
      ['/settings/members', '멤버·역할'],
      ['/settings/tokens', '에이전트 토큰'],
      ['/settings/gates', '게이트 정책'],
    ] as const) {
      const { unmount } = renderAt(path);
      await waitFor(() => expect(screen.getByText(title, { selector: 'h1' })).toBeDefined());
      unmount();
    }
  });
});

describe('헤더 스코프 — 조직 → 프로젝트 (2026-08-24 · 사람 지시)', () => {
  it('조직 오른쪽에 프로젝트 select 가 있다 — 이전에는 고를 길이 화면에 없었다', async () => {
    renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByTestId('project-switcher')).toBeDefined());
    expect(screen.getByTestId('org-switcher')).toBeDefined();
  });

  it('홈 오른쪽에 프로젝트 페이지로 가는 길이 있다 — 골라도 갈 데가 없으면 표시일 뿐이다', async () => {
    renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByTestId('project-switcher')).toBeDefined());
    const nav = screen.getAllByRole('link', { name: '프로젝트' })[0];
    expect(nav?.getAttribute('href')).toBe('/p/clemvion');
  });

  it('전역 화면에서도 프로젝트 칸이 비지 않는다 — 마지막으로 본 것을 기억한다', async () => {
    // 프로젝트 라우트를 지나면 기억되고, 전역 라우트에서 그것이 헤더에 남는다.
    // 기억이 없으면 빈 칸이 되고, **빈 칸은 "선택할 수 없다"로 읽힌다**.
    const first = renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByTestId('project-switcher')).toBeDefined());
    first.unmount();

    renderAt('/inbox');
    await waitFor(() => expect(screen.getByTestId('project-switcher')).toBeDefined());
    expect(localStorage.getItem('nerv.last-project')).toBe('clemvion');
  });
});
