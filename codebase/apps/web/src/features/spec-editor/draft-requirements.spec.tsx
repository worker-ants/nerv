// 초안의 요구사항 변경 미리보기 (2026-09-28 · SPEC-14 · REQ-WEB-278)
//
// 요구사항 행은 승인될 때 만들어져서, 초안을 보는 동안 요구사항 탭은 승인본의 약속만 보였다. 승인본이 있으면 버전
// 비교(EP-SPEC-06)로 무엇이 늘고 줄었는지를, 승인된 적 없으면 본문의 요구사항 줄로 "승인되면 무엇이 생기나" 를 본다.

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

async function withProviders(ui: React.ReactElement): Promise<void> {
  const rootRoute = createRootRoute({ component: () => <RealtimeProvider>{ui}</RealtimeProvider> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

/** 요구사항 목록은 비었다(초안) · 비교는 넘겨준 줄을 준다 */
function stubFetch(diff: unknown[], calls: string[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) => {
      const u = String(url);
      calls.push(u);
      const body = u.includes('/diff?') ? { requirements: diff, body_diff: [] } : [];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

const DRAFT = { id: 'v-4', versionNo: 4, status: 'draft' };

describe('초안의 요구사항 변경 (REQ-WEB-278)', () => {
  it('승인본이 있으면 그 버전 대비 추가 · 변경 · 삭제를 세고, 비교를 연다', async () => {
    const calls: string[] = [];
    stubFetch(
      [
        { ref: 'REQ-CWC-040', delta: 'added', statement_md: 'WHEN 새 방문자가 …' },
        { ref: 'REQ-CWC-031', delta: 'modified', statement_md: 'WHEN 방문자가 위젯을 …' },
        { ref: 'REQ-CWC-010', delta: 'unchanged', statement_md: '그대로' },
      ],
      calls,
    );
    const onOpenDiff = vi.fn();
    await withProviders(
      <RequirementPanel
        projectSlug="clemvion"
        specKey="SPC-CWC-007"
        version={DRAFT}
        approvedNo={3}
        draftBody=""
        onOpenDiff={onOpenDiff}
      />,
    );
    const section = await screen.findByTestId('draft-requirements');
    await waitFor(() => expect(section.textContent).toContain('추가 1 · 변경 1 · 삭제 0'));
    expect(section.textContent).toContain('v3 대비');
    expect(section.textContent).toContain('REQ-CWC-040');
    expect(section.textContent).not.toContain('REQ-CWC-010');
    expect(calls.some((u) => u.includes('/specs/SPC-CWC-007/diff?from=3&to=4'))).toBe(true);
    fireEvent.click(screen.getByTestId('draft-requirements-diff'));
    expect(onOpenDiff).toHaveBeenCalledWith(3, 4);
  });

  it('승인된 적 없는 초안은 본문의 요구사항 줄로 "승인되면 무엇이 생기나" 를 센다 — 비교를 부르지 않는다', async () => {
    const calls: string[] = [];
    stubFetch([], calls);
    await withProviders(
      <RequirementPanel
        projectSlug="clemvion"
        specKey="SPC-NEW"
        version={{ id: 'v-1', versionNo: 1, status: 'draft' }}
        approvedNo={null}
        draftBody={
          '# 제목\n\n- REQ-NEW-001 WHEN 누르면 THE SYSTEM SHALL 연다\nREQ-NEW-002 WHEN 닫으면 THE SYSTEM SHALL 지운다\n'
        }
      />,
    );
    const section = await screen.findByTestId('draft-requirements');
    expect(section.textContent).toContain('승인되면 요구사항 2개가 생깁니다');
    expect(section.textContent).toContain('REQ-NEW-002');
    expect(calls.some((u) => u.includes('/diff?'))).toBe(false);
  });

  it('승인본을 볼 때는 미리보기가 없다', async () => {
    stubFetch([]);
    await withProviders(
      <RequirementPanel
        projectSlug="clemvion"
        specKey="SPC-CWC-007"
        version={{ id: 'v-3', versionNo: 3, status: 'approved' }}
        approvedNo={3}
      />,
    );
    await screen.findByTestId('requirements-empty');
    expect(screen.queryByTestId('draft-requirements')).toBeNull();
  });
});
