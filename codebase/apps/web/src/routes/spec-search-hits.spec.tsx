// 검색 결과는 그 종류의 화면으로 간다 · 번호로 찾은 보관 문서는 표시가 붙는다 (2026-10-04 · REQ-WEB-288)
//
// 스펙 목록의 검색 결과는 종류와 상관없이 스펙 상세로 보냈다 — 작업 번호로 찾은 결과를 누르면
// "없는 문서" 가 열렸고, 요구사항 결과는 요구사항 탭을 열지 않았다. ⌘K 는 처음부터 종류대로 보냈다.

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

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

const hit = (over: Record<string, unknown>): Record<string, unknown> => ({
  spec_id: 's-1',
  key: 'SDK-RULES',
  title: '규칙',
  type: 'feature',
  doc_status: 'approved',
  version_no: 1,
  anchor: null,
  snippet: '본문',
  score: 1,
  kind: 'spec',
  matched_by: ['id'],
  archived_at: null,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const path = u.split('?')[0]!;
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            {
              org_slug: 'default',
              org_name: 'Default',
              project_slug: 'sudoku',
              roles: ['planner'],
            },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([{ id: 'p-1', slug: 'sudoku', key: 'SDK', name: 'sudoku' }]);
      }
      if (path === '/projects/sudoku') return ok({ id: 'p-1', slug: 'sudoku', name: 'sudoku' });
      if (path.endsWith('/specs/tree')) return ok([]);
      if (path.endsWith('/specs/graph')) return ok({ nodes: [], edges: [] });
      if (path.endsWith('/specs/search')) {
        return ok({
          items: [
            hit({}),
            hit({
              spec_id: 's-2',
              key: 'SDK-OLD',
              title: '보관한 규칙',
              archived_at: '2026-10-01T00:00:00Z',
            }),
            hit({ spec_id: 's-1', anchor: 'REQ-SDK-001', kind: 'requirement' }),
            hit({
              spec_id: 't-1',
              key: 'SDK-T-ABC123',
              title: '풀이기 작업',
              type: 'ready',
              doc_status: null,
              kind: 'task',
            }),
          ],
          related: [],
          degraded: null,
          basis: 'approved',
        });
      }
      return ok({ items: [], next_cursor: null, memberships: [], count: 0, summary: {} });
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

describe('스펙 목록 검색 결과 (REQ-WEB-288)', () => {
  it('문서는 문서로, 요구사항은 요구사항 탭으로, 작업은 작업 화면으로 간다', async () => {
    renderAt('/p/sudoku/specs?q=SDK');
    const links = await screen.findAllByTestId('search-hit');
    const hrefs = links.map((a) => a.getAttribute('href') ?? '');
    expect(hrefs[0]).toBe('/p/sudoku/specs/SDK-RULES');
    expect(hrefs[2]).toBe('/p/sudoku/specs/SDK-RULES?rail=requirements');
    expect(hrefs[3]).toBe('/p/sudoku/tasks/SDK-T-ABC123');
  });

  it('번호로 찾은 보관 문서에는 보관됨 표시가 붙는다', async () => {
    renderAt('/p/sudoku/specs?q=SDK');
    const links = await screen.findAllByTestId('search-hit');
    expect(within(links[1]!).getByText('보관됨')).toBeTruthy();
    expect(within(links[0]!).queryByText('보관됨')).toBeNull();
  });
});
