// 스펙 상세 요구사항 탭의 「출처: 임포트」 (2026-10-15 · 사람 결정 ④ · REQ-WEB-317)
//
// 작업이 없어 파생하지 않은 요구사항의 구현 상태는 임포트 값이 남는다. 그 값을 덮지 않는 대신 파생한 값과 섞여 읽히지
// 않게 출처를 표시한다 — 판정은 서버의 `impl_status_source` 이고 화면은 작업 수를 세어 다시 판정하지 않는다.

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RealtimeProvider } from '../../lib/realtime.js';
import { RequirementPanel } from './requirement-panel.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('요구사항 탭 — 출처: 임포트 (REQ-WEB-317)', () => {
  it('임포트 값인 줄에만 출처를 표시하고 그 뜻을 말풍선으로 준다', async () => {
    const requirements = [
      {
        id: 'r-1',
        ref: 'REQ-CWC-031',
        statement_md: 'WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다',
        impl_status: 'implemented',
        impl_status_source: 'import',
        task_count: 0,
        evidence_count: 0,
      },
      {
        id: 'r-2',
        ref: 'REQ-CWC-032',
        statement_md: 'WHEN 연결이 끊기면 THE SYSTEM SHALL 메시지를 모은다',
        impl_status: 'in_progress',
        impl_status_source: 'derived',
        task_count: 1,
        evidence_count: 0,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(String(url).includes('/requirements?') ? requirements : {}), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const rootRoute = createRootRoute({
      component: () => (
        <RealtimeProvider>
          <RequirementPanel projectSlug="clemvion" specKey="SPC-CWC-007" />
        </RealtimeProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    await router.load();
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RouterProvider router={router as never} />
        </QueryClientProvider>
      </LocaleProvider>,
    );
    const badges = await screen.findAllByTestId('import-source');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toBe('출처: 임포트');
    expect(badges[0]!.getAttribute('title')).toContain('임포트가 문서에서 읽어 넣었습니다');
  });
});
