// 구현 현황의 영역별 분해 — REQ-WEB-309 · 서버 REQ-API-297 (2026-10-11)
//
// 프로젝트 전체의 여섯 칸만으로는 "어느 영역이 비었나" 에 답하지 못했다. 카드 아래에 영역마다 막대와 수를 두고,
// 경고 셋은 0 이 아닐 때만 적는다. 영역 밖 스펙은 마지막 한 줄이다. 영역 이름은 그 영역의 드릴다운으로 간다
// (2026-10-15 · REQ-WEB-315 — 예전에는 영역 문서를 열었다).

import { cleanup, render, screen, within } from '@testing-library/react';
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

type Row = Record<string, unknown>;
const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

let areas: Row[];

beforeEach(() => {
  localStorage.clear();
  areas = [
    {
      area_key: 'area-chat',
      area_title: '웹챗',
      total: 3,
      implemented: 2,
      verified: 1,
      in_progress: 0,
      evidence_missing: 1,
      empty_promises: 1,
      reverify_required: 0,
    },
    {
      area_key: null,
      area_title: null,
      total: 2,
      implemented: 1,
      verified: 0,
      in_progress: 0,
      evidence_missing: 0,
      empty_promises: 0,
      reverify_required: 0,
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url)
        .replace(/^.*\/api\/v1/, '')
        .split('?')[0]!;
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            {
              org_slug: 'default',
              org_name: 'Default',
              project_slug: 'clemvion',
              roles: ['planner'],
            },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path))
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'Clemvion' }]);
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'Clemvion' });
      if (path === '/projects/clemvion/coverage') {
        return ok({ totals: { total: 5, implemented: 3, verified: 1 }, areas, specs: [] });
      }
      return ok({ items: [], next_cursor: null, total: 0, summary: {}, count: 0, totals: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderOverview(): void {
  const history = createMemoryHistory({ initialEntries: ['/p/clemvion'] });
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

describe('구현 현황 — 영역별 (REQ-WEB-309)', () => {
  it('영역마다 한 줄 — 제목은 그 영역의 드릴다운으로 가고, 경고는 0 이 아닌 것만 적는다', async () => {
    renderOverview();
    const rows = await screen.findAllByTestId('coverage-area');
    expect(rows).toHaveLength(2);
    const chat = rows[0]!;
    expect(within(chat).getByRole('link', { name: '웹챗' }).getAttribute('href')).toBe(
      '/p/clemvion/coverage?area=area-chat',
    );
    expect(chat.textContent).toContain('구현 2 · 검증 1 / 3');
    expect(chat.textContent).toContain('증적 없음 1');
    expect(chat.textContent).toContain('작업 없음 1');
    expect(chat.textContent).not.toContain('다시 검증 필요');
    // 영역 밖 — 그 무리도 드릴다운으로 간다(영역 문서는 없다)
    expect(rows[1]!.textContent).toContain('영역에 들지 않은 스펙');
    expect(within(rows[1]!).getByRole('link').getAttribute('href')).toBe(
      '/p/clemvion/coverage?area=-',
    );
  });

  it('영역이 없으면 그 칸을 두지 않는다', async () => {
    areas = [];
    renderOverview();
    await screen.findByText('구현 현황');
    expect(screen.queryByTestId('coverage-areas')).toBeNull();
  });
});
