// 버전 기준 — 승인본 · 최신 · 기준선 (2026-09-27 사람 결정 V1~V4 · REQ-WEB-248~251)
//
// 목록이 문서마다 최신 승인본만 읽어서, 승인된 문서 위에 에이전트가 쓴 v2 초안은 목록 · 트리 ·
// 표 · 그래프 어디에도 없었고 상태 필터 "초안" 에도 걸리지 않았다(사람 보고 — /p/sudoku/specs).
// 상세에는 "더 새 버전이 있습니다" 안내가 있었지만 문서를 하나씩 열어야 했다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** 승인된 v1 위에 v2 초안이 있는 문서 하나 · 승인본뿐인 문서 하나 */
const approvedNodes = [
  {
    id: 'n-1',
    key: 'SDK-RULES',
    title: '규칙',
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
    latest_version_no: 2,
    latest_status: 'draft',
    approved_version_no: 1,
  },
  {
    id: 'n-2',
    key: 'SDK-SOLVER',
    title: '풀이기',
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
    latest_version_no: 1,
    latest_status: 'approved',
    approved_version_no: 1,
  },
];
/** 같은 문서를 최신으로 읽은 줄 */
const latestNodes = approvedNodes.map((n) =>
  n.key === 'SDK-RULES' ? { ...n, version_no: 2, doc_status: 'draft' } : n,
);

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
const seen: string[] = [];
const nativeScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  seen.length = 0;
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      seen.push(u);
      const path = u.split('?')[0]!;
      const latest = u.includes('basis=latest');
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
      if (path.endsWith('/specs/tree')) return ok(latest ? latestNodes : approvedNodes);
      if (path.endsWith('/specs/graph')) {
        return ok({ nodes: latest ? latestNodes : approvedNodes, edges: [] });
      }
      if (path.endsWith('/baselines')) {
        return ok({
          items: [
            { id: 'b-1', name: 'R1', note_md: null, item_count: 2, created_at: '2026-09-01' },
          ],
          total: 1,
        });
      }
      if (path.endsWith('/specs/search')) {
        return ok({
          items: [],
          related: [],
          degraded: null,
          ...(latest ? { basis: 'latest' } : { basis: 'approved' }),
        });
      }
      if (path.endsWith('/versions')) {
        return ok({
          items: [
            { id: 'v-2', version_no: 2, status: 'draft' },
            { id: 'v-1', version_no: 1, status: 'approved' },
          ],
          total: 2,
        });
      }
      if (/\/specs\/SDK-RULES$/.test(path)) {
        const pinned = u.includes('baseline=R1');
        return ok({
          id: 'n-1',
          key: 'SDK-RULES',
          title: '규칙',
          type: 'feature',
          version_id: latest ? 'v-2' : 'v-1',
          version_no: latest ? 2 : 1,
          doc_status: latest ? 'draft' : 'approved',
          body_md: '# 규칙',
          project_id: 'p-1',
          latest_version_no: 2,
          latest_status: 'draft',
          // 기준선 사례: 세트는 v1 을 묶었고 그 뒤에 v2 가 승인됐다고 친다
          approved_version_no: pinned ? 2 : 1,
          ...(latest ? { basis: 'latest' } : {}),
          ...(pinned ? { baseline: 'R1', baseline_pinned: true } : {}),
        });
      }
      return ok({ items: [], next_cursor: null, memberships: [], count: 0, summary: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = nativeScrollIntoView;
  cleanup();
});

function renderAt(path: string): ReturnType<typeof createMemoryHistory> {
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
  return history;
}

const params = (history: ReturnType<typeof createMemoryHistory>): URLSearchParams =>
  new URLSearchParams(history.location.search);
const hrefParams = (href: string | null): URLSearchParams =>
  new URLSearchParams((href ?? '').split('?')[1] ?? '');

describe('목록 — 승인본으로 읽어도 진행 중인 다음 버전이 보인다 (V3 · REQ-WEB-249)', () => {
  it('승인본 위에 초안이 있는 줄에만 "v2 초안" 표시가 있고, 누르면 그 버전이 열린다', async () => {
    renderAt('/p/sudoku/specs');
    const chip = await screen.findByTestId('tree-row-newer');
    expect(chip.textContent).toBe('v2 초안');
    expect(hrefParams(chip.getAttribute('href')).get('v')).toBe('2');
    expect(screen.getAllByTestId('tree-row-newer')).toHaveLength(1);
  });

  it('상태별 수에 "새 버전 진행 중" 이 있고, 누르면 최신으로 읽으며 그 문서만 남긴다', async () => {
    const history = renderAt('/p/sudoku/specs');
    const newer = await screen.findByTestId('spec-status-newer');
    expect(newer.textContent).toBe('새 버전 진행 중 1');
    fireEvent.click(newer);
    await waitFor(() => expect(params(history).get('basis')).toBe('latest'));
    expect(params(history).get('status')).toBe('newer');
    await waitFor(() => expect(screen.queryByText('풀이기')).toBeNull());
    expect(screen.getByText('규칙')).toBeDefined();
  });
});

describe('버전 기준 선택기 (V1 · REQ-WEB-248)', () => {
  it('최신을 고르면 주소에 ?basis=latest 가 남고, 목록 · 그래프 질의가 그 기준을 묻는다', async () => {
    const history = renderAt('/p/sudoku/specs');
    const select = (await screen.findByTestId('basis-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'latest' } });
    await waitFor(() => expect(params(history).get('basis')).toBe('latest'));
    await waitFor(() =>
      expect(seen.some((u) => u.includes('/specs/tree') && u.includes('basis=latest'))).toBe(true),
    );
    expect(seen.some((u) => u.includes('/specs/graph') && u.includes('basis=latest'))).toBe(true);
    // 최신으로 읽으면 줄 자체가 v2 초안이라 따로 표시하지 않는다
    await waitFor(() => expect(screen.queryByTestId('tree-row-newer')).toBeNull());
  });

  it('기준선을 고르면 최신은 풀리고, 기본으로 돌아가면 주소에 아무것도 남지 않는다', async () => {
    const history = renderAt('/p/sudoku/specs?basis=latest');
    const select = (await screen.findByTestId('basis-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.textContent).toContain('R1'));
    fireEvent.change(select, { target: { value: 'baseline:R1' } });
    await waitFor(() => expect(params(history).get('baseline')).toBe('R1'));
    expect(params(history).get('basis')).toBeNull();
    fireEvent.change(screen.getByTestId('basis-select'), { target: { value: '' } });
    await waitFor(() => expect(params(history).get('baseline')).toBeNull());
    expect(params(history).get('basis')).toBeNull();
  });

  it('최신으로 읽는 동안 트리 줄이 기준을 상세까지 넘긴다', async () => {
    renderAt('/p/sudoku/specs?basis=latest');
    const tree = await screen.findByTestId('spec-tree');
    await waitFor(() => expect(within(tree).getByText('규칙')).toBeDefined());
    const link = within(tree).getByText('규칙').closest('a');
    expect(hrefParams(link!.getAttribute('href')).get('basis')).toBe('latest');
  });

  it('검색도 고른 기준으로 묻고, 결과 위에 어느 버전에서 찾았는지 적는다 (REQ-WEB-250)', async () => {
    renderAt('/p/sudoku/specs?basis=latest&q=킬러');
    const basis = await screen.findByTestId('search-basis');
    expect(basis.textContent).toContain('최신 버전 본문에서 찾았습니다');
    expect(seen.some((u) => u.includes('/specs/search') && u.includes('basis=latest'))).toBe(true);
  });
});

describe('상세의 두 안내 (REQ-WEB-251)', () => {
  it('최신으로 읽으면 가장 새 버전을 열고, 승인본의 번호와 그리로 가는 단추를 보여 준다', async () => {
    const history = renderAt('/p/sudoku/specs/SDK-RULES?basis=latest');
    const banner = await screen.findByTestId('spec-latest-basis');
    expect(banner.textContent).toContain('이 문서의 승인본은 v1입니다');
    expect(seen.some((u) => /\/specs\/SDK-RULES\?/.test(u) && u.includes('basis=latest'))).toBe(
      true,
    );
    fireEvent.click(screen.getByTestId('spec-latest-diff'));
    await waitFor(() => expect(params(history).get('diff')).toBe('v1..v2'));
    // 기준은 그대로 남는다 — 차이를 연다고 읽는 기준이 바뀌지 않는다
    expect(params(history).get('basis')).toBe('latest');
  });

  it('기준선으로 읽는데 그 뒤에 승인된 버전이 있으면 알려 준다 (V4)', async () => {
    renderAt('/p/sudoku/specs/SDK-RULES?baseline=R1');
    const banner = await screen.findByTestId('spec-baseline-newer');
    expect(banner.textContent).toContain('기준선 R1 뒤에 승인된 버전이 있습니다: v2');
  });

  it('기본(승인본)으로 읽을 때는 두 안내가 없고, 버전 기준 선택기도 상단에 없다', async () => {
    renderAt('/p/sudoku/specs/SDK-RULES');
    await screen.findByTestId('spec-newer-version');
    expect(screen.queryByTestId('spec-latest-basis')).toBeNull();
    expect(screen.queryByTestId('spec-baseline-newer')).toBeNull();
    expect(screen.queryByTestId('basis-select')).toBeNull();
  });
});
