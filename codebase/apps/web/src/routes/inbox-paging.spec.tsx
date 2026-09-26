// 받은 요청의 쪽 넘김 — REQ-API-166 · REQ-WEB-185
//
// **목록이 100건에서 말없이 잘렸고, 그 상한이 오래 기다린 쪽을 잘랐다**(서버가 최근
// 100건을 집고 화면이 다시 오래된 순으로 세웠다 — 실측 2026-09-24: 120건 중 가장 오래
// 기다린 20건이 통째로 빠졌다). 서버가 커서를 주는 지금, 화면이 지켜야 하는 것은 둘이다:
//   ① 다음 쪽이 있으면 **그렇게 말한다**(없으면 단추도 없다 — 누를 것 없는 단추는 거짓말이다)
//   ② 세는 수는 받아 온 쪽이 아니라 **전체**다. 배지와 목록이 어긋나면 지울 수 없는
//      숫자가 남는다(알림 배지에서 이미 겪은 자리 · REQ-WEB-035).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const card = (n: number): Record<string, unknown> => ({
  id: `ap-${n}`,
  subject_type: 'spec_version',
  spec_key: `SPC-${n}`,
  spec_title: `문서 ${n}`,
  project_slug: 'clemvion',
  requested_by: '하나',
  requested_at: '2026-09-24T00:00:00Z',
  waiting_seconds: 600,
  decision: null,
  can_approve: true,
  can_bulk_approve: true,
  approvals_required: 1,
});

/** 전체 5건 · 한 쪽 3건 — 커서가 한 번 더 돌아야 다 보인다 */
const PAGE_ONE = { items: [card(1), card(2), card(3)], next_cursor: 'opaque-1', total: 5 };
const PAGE_TWO = { items: [card(4), card(5)], next_cursor: null, total: 5 };

let asked: string[] = [];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/approvals?')) {
        asked.push(u);
        return {
          ok: true,
          status: 200,
          json: async () => (u.includes('cursor=opaque-1') ? PAGE_TWO : PAGE_ONE),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          memberships: [{ org_slug: 'default', project_slug: 'clemvion', roles: ['planner'] }],
          count: 0,
          summary: {},
        }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): void {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
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

describe('받은 요청의 쪽 넘김 (REQ-API-166)', () => {
  it('머리의 수는 받아 온 쪽이 아니라 전체다 — 3건을 받고 5건이라 적는다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(screen.getAllByTestId('approval-card')).toHaveLength(3));
    expect(screen.getByText('대기 5건')).toBeDefined();
  });

  it('[더 보기] 가 다음 쪽을 커서로 이어 받는다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(screen.getAllByTestId('approval-card')).toHaveLength(3));

    fireEvent.click(screen.getByTestId('inbox-more'));
    await waitFor(() => expect(screen.getAllByTestId('approval-card')).toHaveLength(5));

    // 첫 쪽은 커서 없이, 둘째 쪽은 **서버가 준 그 값** 으로 — 화면은 커서를 만들지 않는다
    expect(asked[0]).not.toContain('cursor=');
    expect(asked[1]).toContain('cursor=opaque-1');
  });

  it('다음 쪽이 없으면 단추도 없다 — 누를 것 없는 단추는 거짓말이다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(screen.getAllByTestId('approval-card')).toHaveLength(3));
    fireEvent.click(screen.getByTestId('inbox-more'));
    await waitFor(() => expect(screen.getAllByTestId('approval-card')).toHaveLength(5));
    expect(screen.queryByTestId('inbox-more')).toBeNull();
  });

  it('이어 받은 카드도 일괄 선택에 든다 — "보이는 항목" 이 그 뜻이다 (REQ-WEB-181)', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(screen.getAllByTestId('approval-card')).toHaveLength(3));
    fireEvent.click(screen.getByTestId('inbox-more'));
    await waitFor(() => expect(screen.getAllByTestId('approval-card')).toHaveLength(5));

    // 선택 바는 하나라도 골라야 나타난다 — [보이는 항목 선택] 은 그 바 안에 있다
    fireEvent.click(screen.getAllByTestId('bulk-select')[0]!);
    await waitFor(() => expect(screen.getByTestId('bulk-bar')).toBeDefined());
    fireEvent.click(screen.getByTestId('bulk-select-all'));
    await waitFor(() => expect(screen.getByTestId('bulk-bar').textContent).toContain('5건 선택'));
  });
});
