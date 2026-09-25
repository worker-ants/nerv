// 스펙 화면의 주소가 진실이다 — REQ-WEB-211 (2026-09-24 · UI/UX 검토 P08a · SPEC-03·06·07 · SYS-12)
//
// 알림이 연 `?rail=comments` 는 마운트 직후 관계 탭으로 덮였고, 버전 탭의 [차이]·[열기]·닫기는
// 레일·기준선을 버렸다. 기준선으로 목록을 본 사람이 트리·표·레일 줄을 누르면 상세는 최신 승인본을
// 열었다. 트리·표·그래프 보기는 컴포넌트 state 라 상세에 갔다 돌아오면 트리로 돌아와 있었다.

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

const NODES = [
  {
    id: 'n-1',
    key: 'SPC-CWC-007',
    title: '위젯 상태',
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 2,
  },
  {
    id: 'n-2',
    key: 'SPC-CWC-008',
    title: '위젯 캐시',
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  },
];

const RELATIONS = [
  { spec_id: 'n-2', key: 'SPC-CWC-008', title: '위젯 캐시', kind: 'references', direction: 'out' },
];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

const nativeScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  localStorage.clear();
  // jsdom 에는 `scrollIntoView` 가 없다 — 상세로 들어오면 사이드바 트리가 활성 줄로 옮긴다(REQ-WEB-053)
  Element.prototype.scrollIntoView = vi.fn();
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
              project_slug: 'clemvion',
              roles: ['planner'],
            },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }]);
      }
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'clemvion' });
      if (path.endsWith('/specs/tree')) return ok(NODES);
      if (path.endsWith('/specs/graph')) {
        return ok({ nodes: NODES, edges: [{ from_id: 'n-1', to_id: 'n-2', kind: 'references' }] });
      }
      if (path.endsWith('/baselines')) {
        return ok({
          items: [
            { id: 'b-1', name: 'R1', note_md: null, item_count: 2, created_at: '2026-09-01' },
          ],
          total: 1,
        });
      }
      if (path.endsWith('/relations')) return ok({ items: RELATIONS, total: RELATIONS.length });
      if (path.endsWith('/versions')) {
        return ok({
          items: [
            { id: 'v-2', version_no: 2, status: 'approved' },
            { id: 'v-1', version_no: 1, status: 'superseded' },
          ],
          total: 2,
        });
      }
      if (/\/specs\/SPC-CWC-007$/.test(path)) {
        return ok({
          id: 'n-1',
          key: 'SPC-CWC-007',
          title: '위젯 상태',
          type: 'feature',
          version_id: 'v-2',
          version_no: 2,
          doc_status: 'approved',
          body_md: '# 위젯',
          project_id: 'p-1',
          ...(u.includes('baseline=R1') ? { baseline: 'R1', baseline_pinned: true } : {}),
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

/** 주소의 값 — TanStack 은 숫자를 따옴표 없이, 문자열은 그대로 싣는다 */
const hrefParams = (href: string | null): URLSearchParams =>
  new URLSearchParams((href ?? '').split('?')[1] ?? '');

describe('상세의 레일과 버전 이동이 다른 축을 지킨다 (SPEC-03)', () => {
  it('알림이 연 ?rail=comments 가 마운트 뒤에도 그대로다', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-CWC-007?rail=comments');
    await screen.findByTestId('rail-panel-comments');
    // 한 틱이 아니라 넉넉히 기다린다 — 덮어쓰기는 마운트 **뒤**에 일어났다
    await new Promise((r) => setTimeout(r, 300));
    expect(params(history).get('rail')).toBe('comments');
    expect(screen.queryByTestId('rail-panel-comments')).not.toBeNull();
  });

  it('[차이]·[열기]·닫기가 레일과 기준선을 물고 간다', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-CWC-007?rail=versions&baseline=R1');
    fireEvent.click(await screen.findByTestId('diff-open-2'));
    await waitFor(() => expect(params(history).get('diff')).toBe('v1..v2'));
    expect(params(history).get('rail')).toBe('versions');
    expect(params(history).get('baseline')).toBe('R1');

    fireEvent.click(await screen.findByTestId('diff-close'));
    await waitFor(() => expect(params(history).get('diff')).toBeNull());
    expect(params(history).get('rail')).toBe('versions');
    expect(params(history).get('baseline')).toBe('R1');

    fireEvent.click(await screen.findByTestId('version-open-1'));
    await waitFor(() => expect(params(history).get('v')).toBe('1'));
    expect(params(history).get('rail')).toBe('versions');
    expect(params(history).get('baseline')).toBe('R1');
  });
});

describe('기준선을 상세까지 물고 간다 (SPEC-06 · REQ-WEB-135)', () => {
  it('목록의 트리 줄이 ?baseline 을 싣는다', async () => {
    renderAt('/p/clemvion/specs?baseline=R1');
    const trees = await screen.findAllByTestId('spec-tree');
    const full = within(trees.at(-1)!);
    const link = (await full.findByText('위젯 상태')).closest('a');
    expect(hrefParams(link!.getAttribute('href')).get('baseline')).toBe('R1');
  });

  it('표의 제목 링크도 ?baseline 을 싣는다', async () => {
    renderAt('/p/clemvion/specs?view=table&baseline=R1');
    const table = await screen.findByTestId('table-count');
    const link = within(table.parentElement!.parentElement!).getByText('위젯 캐시').closest('a');
    expect(hrefParams(link!.getAttribute('href')).get('baseline')).toBe('R1');
  });

  it('레일의 관계 줄과 사이드바 트리가 ?baseline 을 싣는다', async () => {
    renderAt('/p/clemvion/specs/SPC-CWC-007?baseline=R1');
    const rail = (await screen.findByTestId('rel-tab-all')).closest('aside')!;
    const related = (await within(rail).findByText('위젯 캐시')).closest('a');
    expect(hrefParams(related!.getAttribute('href')).get('baseline')).toBe('R1');
    const sidebar = within((await screen.findAllByTestId('spec-tree'))[0]!);
    const side = (await sidebar.findByText('위젯 캐시')).closest('a');
    expect(hrefParams(side!.getAttribute('href')).get('baseline')).toBe('R1');
  });

  it('상세에서 기준선을 풀 수 있다 — 목록으로 나가지 않고', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-CWC-007?baseline=R1&rail=versions');
    const select = await screen.findByTestId('baseline-select');
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(params(history).get('baseline')).toBeNull());
    expect(params(history).get('rail')).toBe('versions');
  });
});

describe('보는 방식과 중심이 주소에 있다 (SPEC-07 · SYS-12)', () => {
  it('?view=table 로 열면 표이고, 누른 보기가 주소에 남는다', async () => {
    const history = renderAt('/p/clemvion/specs?view=table');
    const table = await screen.findByTestId('view-table');
    expect(table.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('view-tree').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('view-tree'));
    // 기본은 적지 않는다
    await waitFor(() => expect(params(history).get('view')).toBeNull());
  });

  it('상세의 관계 탭에서 이 문서 중심의 그래프로 간다', async () => {
    renderAt('/p/clemvion/specs/SPC-CWC-007?baseline=R1');
    const link = await screen.findByTestId('rail-graph-link');
    const q = hrefParams(link.getAttribute('href'));
    expect(link.getAttribute('href')?.startsWith('/p/clemvion/specs?')).toBe(true);
    expect(q.get('view')).toBe('graph');
    expect(q.get('focus')).toBe('SPC-CWC-007');
    expect(q.get('baseline')).toBe('R1');
  });
});

describe('주소가 바뀌는 탭은 지금 어느 쪽인지 말한다 (SYS-12)', () => {
  it('받은 요청의 [대기 중|처리됨]에 aria-current', async () => {
    renderAt('/inbox?state=decided');
    const decided = await screen.findByTestId('inbox-tab-decided');
    expect(decided.getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('inbox-tab-pending').getAttribute('aria-current')).toBeNull();
  });
});
