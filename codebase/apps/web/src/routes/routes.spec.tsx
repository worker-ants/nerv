// E01-S03 수용 기준의 실증.
//
//   WHEN `pnpm dev` 로 웹을 기동하면,
//   THE SYSTEM SHALL 라우팅 맵의 기본 경로와 앱 셸을 렌더링한다
//
// 메모리 히스토리로 같은 라우트 트리를 태워 확인한다. 화면 실물은 E08 이 채우지만,
// **경로·가드·셸**이 먼저 서 있어야 딥링크와 사이드바 조건 렌더가 검증 가능하다.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';

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
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  // 라우팅 검증이 목적이라 네트워크는 빈 응답으로 고정한다
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [], summary: {}, next_cursor: null }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('라우팅 맵 (screens.md §1.2)', () => {
  it('기본 경로 / 가 앱 셸과 S1 을 렌더한다', async () => {
    renderAt('/');
    await waitFor(() => expect(screen.getByText('S1 홈 대시보드')).toBeDefined());
    // 앱 셸 — 전역 헤더 · 연결 상태 배너 · 토스트 아웃렛(§1.3)
    expect(screen.getByText('NERV')).toBeDefined();
    expect(screen.getByTestId('connection-banner')).toBeDefined();
    expect(screen.getByTestId('toast-outlet')).toBeDefined();
  });

  it.each([
    ['/login', '로그인'],
    ['/onboarding', '온보딩'],
    ['/inbox', 'S7 승인함'],
    ['/notifications', '알림 센터'],
  ])('전역 경로 %s 가 렌더된다', async (path, title) => {
    renderAt(path);
    await waitFor(() => expect(screen.getByText(title)).toBeDefined());
  });

  it.each([
    ['/p/clemvion', 'S2 프로젝트 개요'],
    ['/p/clemvion/specs', '스펙 목록'],
    ['/p/clemvion/specs/SPC-CWC-007', 'S3 스펙 상세'],
    ['/p/clemvion/tasks', 'S4 작업 보드'],
    ['/p/clemvion/tasks/TSK-3f77', '작업 상세 패널'],
    ['/p/clemvion/sessions', 'S5 세션 모니터'],
    ['/p/clemvion/sessions/S-b7e9', '세션 상세'],
  ])('프로젝트 경로 %s 가 렌더된다', async (path, title) => {
    renderAt(path);
    await waitFor(() => expect(screen.getByText(title)).toBeDefined());
  });

  it('프로젝트 사이드바는 /p/:proj/* 에서만 나온다 (§1.3)', async () => {
    const { unmount } = renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByText('S4 작업 보드')).toBeDefined());
    expect(screen.getByText('clemvion')).toBeDefined();
    // 리뷰 탭은 Phase 2 — 비활성 표기가 보인다(scope.md §4.1)
    expect(screen.getByText('Phase 2')).toBeDefined();
    unmount();

    renderAt('/inbox');
    await waitFor(() => expect(screen.getByText('S7 승인함')).toBeDefined());
    expect(screen.queryByText('clemvion')).toBeNull();
  });

  it('/settings 는 멤버 탭으로 리다이렉트한다', async () => {
    renderAt('/settings');
    await waitFor(() => expect(screen.getByText('S8 멤버·역할')).toBeDefined());
  });

  it('/o/:org 는 화면 없이 / 로 리다이렉트한다 (§1.6 — 그림 비대상)', async () => {
    renderAt('/o/acme');
    await waitFor(() => expect(screen.getByText('S1 홈 대시보드')).toBeDefined());
  });

  it('설정 탭 3종이 전부 있다 — git 연동 탭은 Phase 2 (scope.md §4.1)', async () => {
    for (const [path, title] of [
      ['/settings/members', 'S8 멤버·역할'],
      ['/settings/tokens', 'S8 에이전트 토큰'],
      ['/settings/gates', 'S8 게이트 정책'],
    ] as const) {
      const { unmount } = renderAt(path);
      await waitFor(() => expect(screen.getByText(title)).toBeDefined());
      unmount();
    }
  });
});
