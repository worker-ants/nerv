// 2026-10-15 사람 결정 둘의 화면 — 되돌리기 터미널 카드(REQ-WEB-312) · 요구사항 다음 번호 복사 칸(REQ-WEB-313)
//
// 웹은 본문을 쓰지 않는다(REQ-WEB-173). 그래서 둘 다 단추나 폼이 아니라 **에이전트에게 넘길 글**을 보인다 — 되돌리기는
// 옛 버전 보기에 둔 명령 한 줄이고, 요구사항은 서버가 제안한 다음 번호로 만든 EARS 한 줄이다.

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
import { RequirementPanel, requirementPrefixOf } from './requirement-panel.js';
import { RevertHandoffCard } from './terminal-handoff.js';

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

const ROWS = [
  {
    id: 'r-1',
    ref: 'REQ-CWC-031',
    statement_md: '…',
    priority: 'must',
    impl_status: 'unimplemented',
    task_count: 1,
    evidence_count: 0,
  },
  {
    id: 'r-2',
    ref: 'REQ-CWC-033',
    statement_md: '…',
    priority: 'must',
    impl_status: 'unimplemented',
    task_count: 1,
    evidence_count: 0,
  },
];

/** 주소마다 답한다 — 다음 번호는 접두를 그대로 돌려준다 */
function stubRoutes(roles: string[]): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo) => {
      const url = String(input);
      asked.push(url);
      const prefix = /next-ref\?prefix=([^&]*)/.exec(url)?.[1];
      const json =
        prefix !== undefined
          ? { ref: `REQ-${decodeURIComponent(prefix)}-034`, prefix: decodeURIComponent(prefix) }
          : url.includes('/requirements')
            ? ROWS
            : url.includes('/me')
              ? {
                  id: 'u-1',
                  display_name: '지민',
                  memberships: [{ org_slug: 'nerv', project_slug: 'clemvion', roles }],
                }
              : { items: [], memberships: [] };
      return Promise.resolve(
        new Response(JSON.stringify(json), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return asked;
}

describe('REQ-WEB-313 다음 번호 + EARS 한 줄 복사 칸', () => {
  it('이 문서의 접두로 서버에 다음 번호를 묻고, 그 번호로 만든 한 줄을 복사하게 한다', async () => {
    const asked = stubRoutes(['planner']);
    await withProviders(<RequirementPanel projectSlug="clemvion" specKey="SPC-CWC-007" />);
    const line = await screen.findByTestId('next-requirement-line');
    expect(line.textContent).toBe('- REQ-CWC-034 WHEN <조건>이면 THE SYSTEM SHALL <동작>한다');
    expect(
      asked.some((u) => u.includes('/projects/clemvion/requirements/next-ref?prefix=CWC')),
    ).toBe(true);
    expect(screen.getByTestId('next-requirement-copy')).toBeTruthy();
    // 번호는 제안이고 승인이 확정한다 — 에이전트가 줄의 끝에 넣는다는 것도 함께 보인다
    expect(screen.getByTestId('next-requirement').textContent).toContain('승인될 때 확정');
  });

  it('접두를 고치면 그 접두로 다시 묻고, 모양이 틀리면 묻지 않고 규칙을 보인다', async () => {
    const asked = stubRoutes(['developer']);
    await withProviders(<RequirementPanel projectSlug="clemvion" specKey="SPC-CWC-007" />);
    await screen.findByTestId('next-requirement-line');
    fireEvent.change(screen.getByTestId('next-requirement-prefix'), { target: { value: 'pay2' } });
    await waitFor(() =>
      expect(screen.getByTestId('next-requirement-line').textContent).toContain('REQ-PAY2-034'),
    );
    fireEvent.change(screen.getByTestId('next-requirement-prefix'), { target: { value: '2PAY' } });
    expect(await screen.findByTestId('next-requirement-invalid')).toBeTruthy();
    expect(screen.queryByTestId('next-requirement-line')).toBeNull();
    expect(asked.some((u) => u.includes('prefix=2PAY'))).toBe(false);
  });

  it('초안을 쓸 수 없는 역할(viewer)에게는 보이지 않는다', async () => {
    stubRoutes(['viewer']);
    await withProviders(<RequirementPanel projectSlug="clemvion" specKey="SPC-CWC-007" />);
    await screen.findByText('REQ-CWC-031');
    expect(screen.queryByTestId('next-requirement')).toBeNull();
  });

  it('접두는 이 문서가 쓰는 것이 먼저고, 없으면 스펙 키의 가운데 토막이다', () => {
    expect(requirementPrefixOf('SPC-CWC-007', ['REQ-C24NODE-002'])).toBe('C24NODE');
    expect(requirementPrefixOf('SPC-CWC-007', [])).toBe('CWC');
    expect(requirementPrefixOf('sud-area-play', [])).toBe('AREA');
    expect(requirementPrefixOf('migrations', [])).toBe('MIGRATIONS');
    expect(requirementPrefixOf('CLV-007', [])).toBe('');
  });
});

describe('REQ-WEB-312 옛 버전 보기의 되돌리기 카드', () => {
  it('그 버전으로 되돌리는 명령 한 줄을 보인다 — 새 초안을 만드는 것은 에이전트다', async () => {
    await withProviders(<RevertHandoffCard specKey="SPC-CWC-007" versionNo={3} blockedBy={null} />);
    expect(screen.getByTestId('revert-command').textContent).toBe(
      'claude "/nerv:spec revert SPC-CWC-007 3"',
    );
    expect(screen.getByTestId('revert-handoff').textContent).toContain('검토를 거칩니다');
    expect(screen.getByTestId('revert-copy')).toBeTruthy();
  });

  it('열린 초안이나 검토 중인 버전이 있으면 명령 대신 까닭과 할 일을 보인다', async () => {
    await withProviders(
      <RevertHandoffCard
        specKey="SPC-CWC-007"
        versionNo={3}
        blockedBy={{ versionNo: 6, status: 'draft' }}
      />,
    );
    expect(screen.queryByTestId('revert-command')).toBeNull();
    expect(screen.getByTestId('revert-blocked').textContent).toContain('열린 초안(v6)');
    expect(screen.getByTestId('revert-blocked').textContent).toContain('v3 본문으로');
    cleanup();

    await withProviders(
      <RevertHandoffCard
        specKey="SPC-CWC-007"
        versionNo={3}
        blockedBy={{ versionNo: 6, status: 'in_review' }}
      />,
    );
    expect(screen.getByTestId('revert-blocked').textContent).toContain('검토 중인 버전(v6)');
  });
});
