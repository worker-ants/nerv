// 코멘트는 누가·언제·어디에 · 목록의 머리와 행 — REQ-WEB-216 · REQ-API-183 (2026-09-24 · UI/UX 검토 P09c)
//
// 리뷰어는 코멘트 앵커(서버가 정규화하는 slug)를 손으로 적어야 했고, 달린 코멘트에는 작성자·시각·버전이
// 없었으며, 탭의 수는 해결된 것까지 셌다. 실패는 조용했다. 스펙 목록 머리는 상태별 수를 말하지 않았고
// 동결 단추는 누구에게나 같았으며, 행에는 버전·최근 갱신·열린 코멘트가 없었다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';

/** 못 쓰는 단추인가 — 사유가 있으면 포커스가 남는 잠금(`aria-disabled`)이다(REQ-WEB-235) */
const isLocked = (b: Element | null | undefined): boolean =>
  b != null && ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');
/** 잠긴 단추의 사유 — hover·포커스의 말풍선과 aria-describedby 가 같은 값을 읽는다 */
const reasonOf = (b: Element | null | undefined): string | null =>
  b?.getAttribute('data-reason') ?? null;

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

type Row = Record<string, unknown>;

const NOW = Date.now();
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

const SPEC: Row = {
  spec_id: 's-1',
  key: 'SPC-X',
  title: '위젯 상태',
  type: 'feature',
  project_id: 'p-1',
  version_id: 'v-2',
  version_no: 2,
  doc_status: 'draft',
  body_md: '# 위젯 상태\n\n## 개요\n\n본문\n\n## 복원 흐름\n\n본문',
  requirements: [],
  recheck: { count: 0, specs: [] },
};

const COMMENTS: Row[] = [
  {
    id: 'c-1',
    status: 'open',
    anchor: '개요',
    body_md: '여기가 모호하다',
    author_name: '서연',
    created_at: ago(5),
    version_no: 2,
  },
  {
    id: 'c-2',
    status: 'open',
    anchor: '사라진-절',
    body_md: '옛 절에 달았다',
    author_hostname: 'mac-02',
    author_agent_type: 'claude-code',
    created_at: ago(60),
    version_no: 1,
  },
  {
    id: 'c-3',
    status: 'resolved',
    anchor: '개요',
    body_md: '끝난 지적',
    author_name: '서연',
    resolved_by_name: '지민',
    created_at: ago(120),
    version_no: 1,
  },
];

const NODES: Row[] = [
  {
    id: 'n-1',
    key: 'SPC-X',
    title: '위젯 상태',
    type: 'feature',
    parent_id: null,
    doc_status: 'draft',
    version_no: 2,
    updated_at: ago(3),
    open_comments: 2,
  },
  {
    id: 'n-2',
    key: 'SPC-Y',
    title: '위젯 캐시',
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 4,
    updated_at: ago(2 * 24 * 60),
    open_comments: 0,
  },
  {
    id: 'n-3',
    key: 'SPC-Z',
    title: '위젯 테마',
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
    updated_at: ago(60),
    open_comments: 0,
  },
];

let roles: string[];
let resolveFails: boolean;
let posted: string[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  roles = ['planner'];
  resolveFails = false;
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const path = u.split('?')[0]!;
      if (init?.method === 'POST') {
        posted.push(path);
        if (path.endsWith('/resolve') && resolveFails) {
          return {
            ok: false,
            status: 403,
            json: async () => ({
              ok: false,
              code: NERV_ERROR.FORBIDDEN,
              message: '',
              details: {},
              retry_after_s: null,
              next_actions: [],
            }),
          };
        }
        return ok({ ok: true });
      }
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'default', org_name: 'Default', project_slug: 'clemvion', roles },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'clemvion' }]);
      }
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'clemvion' });
      if (path.endsWith('/specs/tree')) return ok(NODES);
      if (path.endsWith('/specs/graph')) return ok({ nodes: NODES, edges: [] });
      if (path.endsWith('/comments')) return ok({ items: COMMENTS });
      if (path.endsWith('/requirements')) {
        return ok([
          { id: 'r-1', ref: 'REQ-CWC-031', statement_md: '복원한다', impl_status: 'unimplemented' },
        ]);
      }
      if (path === '/projects/clemvion/specs/SPC-X') return ok(SPEC);
      return ok({ items: [], next_cursor: null, total: 0, memberships: [], count: 0, summary: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('코멘트 — 누가·언제·어느 버전에, 앵커는 고른다 (SPEC-04)', () => {
  it('줄마다 작성자·시각·버전을 적고, 에이전트가 단 것은 기계를 적는다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?rail=comments');
    const rows = await screen.findAllByTestId('comment-row');
    const human = rows.find((r) => r.textContent?.includes('여기가 모호하다'))!;
    expect(within(human).getByTestId('comment-author').textContent).toContain('서연');
    expect(human.textContent).toContain('v2');
    expect(human.textContent).toContain('5분 전');
    const agent = rows.find((r) => r.textContent?.includes('옛 절에 달았다'))!;
    expect(within(agent).getByTestId('comment-author').textContent).toContain('mac-02');
  });

  it('탭의 수는 열린 것만이다 — 해결된 것은 접힌 채 따로 본다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?rail=comments');
    const tab = await screen.findByTestId('rail-tab-comments');
    await waitFor(() => expect(tab.textContent).toContain('2'));
    expect(screen.queryByText('끝난 지적')).toBeNull();
    fireEvent.click(screen.getByTestId('comments-resolved-toggle'));
    expect(await screen.findByText('끝난 지적')).toBeTruthy();
    expect(screen.getByText(/지민 이\(가\) 해결함/)).toBeTruthy();
  });

  it('가리키던 헤딩이 사라진 코멘트는 "앵커 유실" 로 머리에 모은다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?rail=comments');
    const lost = await screen.findByTestId('comments-lost');
    expect(lost.textContent).toContain('옛 절에 달았다');
    expect(lost.textContent).not.toContain('여기가 모호하다');
  });

  it('앵커는 본문의 헤딩과 요구사항에서 고른다 — slug 를 손으로 적지 않는다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?rail=comments');
    const select = (await screen.findByTestId('comment-anchor-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(3));
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('개요');
    expect(values).toContain('복원-흐름');
    expect(values).toContain('REQ-CWC-031');
  });

  it('해소가 실패하면 그렇다고 말한다 — 조용히 아무 일도 없던 자리다', async () => {
    resolveFails = true;
    renderAt('/p/clemvion/specs/SPC-X?rail=comments');
    const rows = await screen.findAllByTestId('comment-row');
    fireEvent.click(within(rows[0]!).getByTestId('comment-resolve'));
    // 기본 처리기가 사유를 말한다 — 문구는 코드의 카탈로그 문구다(apierr.forbidden)
    expect((await screen.findAllByText(/권한이 없습니다/)).length).toBeGreaterThan(0);
  });
});

describe('스펙 목록 — 머리의 상태별 수 · 동결 역할 · 행의 메타 (SPEC-13)', () => {
  it('상태별 수를 말하고, 누르면 그 상태로 거른 트리다', async () => {
    const history = renderAt('/p/clemvion/specs');
    const summary = await screen.findByTestId('spec-status-summary');
    await waitFor(() =>
      expect(within(summary).getByTestId('spec-status-approved').textContent).toContain('2'),
    );
    expect(within(summary).getByTestId('spec-status-draft').textContent).toContain('1');
    fireEvent.click(within(summary).getByTestId('spec-status-draft'));
    await waitFor(() =>
      expect(new URLSearchParams(history.location.search).get('status')).toBe('draft'),
    );
  });

  it('동결은 planner·admin 의 것이다 — 아닌 사람에게는 잠긴 채 이유를 보인다', async () => {
    roles = ['developer'];
    renderAt('/p/clemvion/specs');
    const freeze = (await screen.findByTestId('freeze-baseline')) as HTMLButtonElement;
    await waitFor(() => expect(isLocked(freeze)).toBe(true));
    expect(reasonOf(freeze)).toContain('planner');
  });

  it('전수 트리의 행이 버전·최근 갱신·열린 코멘트를 적는다', async () => {
    renderAt('/p/clemvion/specs');
    const trees = await screen.findAllByTestId('spec-tree');
    const full = within(trees.at(-1)!);
    const row = (await full.findByText('위젯 상태')).closest('a')!;
    const meta = within(row).getByTestId('tree-row-meta');
    expect(meta.textContent).toContain('v2');
    expect(meta.textContent).toContain('3분 전');
    expect(within(meta).getByTestId('tree-row-comments').textContent).toContain('2');
  });
});
