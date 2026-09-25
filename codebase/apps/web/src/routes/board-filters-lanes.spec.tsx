// 작업 보드 — 걸린 필터가 보이고, 레인은 한 쪽에서 끝나지 않는다 — REQ-WEB-221 (2026-09-25 · UI/UX 검토 P10c)
//
// 스펙 상세의 "파생 작업 → 전체 보기" 로 온 사람은 `?spec=` 으로 걸러진 보드를 보면서도 그 사실을 알 길이
// 없었고, 요약 숫자는 걸러진 값인데 프로젝트 전체처럼 읽혔으며, 푸는 길이 없었다. `?assignee=` 는 레인에만
// 실려 레인과 요약이 서로 다른 말을 했다(WORK-04). 한 쪽을 채운 레인은 "30+" 를 달았지만 [+N개 더]는 받아
// 둔 카드만 펼쳤고, 빈 ready 레인은 다음 걸음을 주지 않았다(WORK-10).

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

type Row = Record<string, unknown>;

const task = (id: string, status: string): Row => ({
  id,
  key: `CLV-T-${id}`,
  title: `작업 ${id}`,
  status,
  priority: 'P2',
  delegation_complete: true,
});

let asked: string[];
/** 레인별 쪽 — `status` 와 `cursor` 로 고른다 */
let pages: Record<string, { items: Row[]; next_cursor: string | null }[]>;

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  asked = [];
  pages = {
    ready: [{ items: [task('r1', 'ready')], next_cursor: null }],
    blocked: [{ items: [task('b1', 'blocked')], next_cursor: null }],
    backlog: [{ items: [task('k1', 'backlog'), task('k2', 'backlog')], next_cursor: null }],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      asked.push(u);
      const path = u.split('?')[0]!;
      if (path === '/me') {
        return ok({
          id: 'u-me',
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
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'clemvion' }]);
      }
      if (/^\/orgs\/[^/]+\/members$/.test(path)) {
        return ok([
          { user_id: 'u-me', display_name: '지민', project_slug: 'clemvion', role: 'planner' },
          { user_id: 'u-2', display_name: '서연', project_slug: 'clemvion', role: 'developer' },
          {
            user_id: 'u-3',
            display_name: '다른 프로젝트',
            project_slug: 'sudoku',
            role: 'developer',
          },
        ]);
      }
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'clemvion' });
      if (path.endsWith('/specs/tree')) {
        return ok([
          { id: 's-1', key: 'SPC-CWC-007', title: '위젯', type: 'feature', parent_id: null },
        ]);
      }
      if (path === '/projects/clemvion/tasks') {
        const q = new URLSearchParams(u.split('?')[1]);
        const lane = q.get('status') ?? '';
        const list = pages[lane] ?? [{ items: [], next_cursor: null }];
        const cursor = q.get('cursor');
        const index = cursor === null ? 0 : Number(cursor.replace('c', ''));
        return ok(list[index] ?? { items: [], next_cursor: null });
      }
      return ok({ items: [], next_cursor: null, memberships: [], count: 0, summary: {} });
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

const params = (history: ReturnType<typeof createMemoryHistory>): URLSearchParams =>
  new URLSearchParams(history.location.search);

describe('걸린 필터가 보이고 풀 수 있다 (WORK-04)', () => {
  it('?spec= 으로 들어오면 고르개가 그 스펙을 보이고 "필터 적용 중" 이라 말한다', async () => {
    renderAt('/p/clemvion/tasks?spec=SPC-CWC-007');
    const select = (await screen.findByTestId('filter-spec')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('SPC-CWC-007'));
    expect(screen.getByTestId('board-filtered').textContent).toContain('필터 적용 중');
  });

  it('[필터 지우기] 가 스펙·담당을 풀고 나머지 뷰 상태는 둔다', async () => {
    const history = renderAt('/p/clemvion/tasks?spec=SPC-CWC-007&assignee=u-2&backlog=0');
    fireEvent.click(await screen.findByTestId('filter-clear'));
    await waitFor(() => expect(params(history).get('spec')).toBeNull());
    expect(params(history).get('assignee')).toBeNull();
    expect(params(history).get('backlog')).toBe('false');
    expect(screen.queryByTestId('board-filtered')).toBeNull();
  });

  it('담당 고르개는 나와 이 프로젝트의 멤버를 보이고, 고르면 주소에 남는다', async () => {
    const history = renderAt('/p/clemvion/tasks');
    const select = (await screen.findByTestId('filter-assignee')) as HTMLSelectElement;
    await waitFor(() => expect(select.querySelectorAll('option').length).toBe(3));
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual(['담당: 전체', '담당: 나', '서연']);
    fireEvent.change(select, { target: { value: 'u-2' } });
    await waitFor(() => expect(params(history).get('assignee')).toBe('u-2'));
  });

  it('담당으로 거르면 요약 숫자도 같은 조건으로 센다 — 레인만 거르지 않는다', async () => {
    renderAt('/p/clemvion/tasks?assignee=u-2');
    await screen.findByTestId('column-ready');
    await waitFor(() => {
      // 인자가 없으면 `status=ready` 로 끝난다 — 그 요청(옛 요약)을 놓치지 않게 끝도 본다
      const readyCalls = asked.filter((u) => /status=ready(&|$)/.test(u));
      expect(readyCalls.length).toBeGreaterThan(0);
      // 요약과 레인이 같은 키를 쓰므로 ready 는 담당을 실은 한 벌뿐이다
      for (const call of readyCalls) expect(call).toContain('assignee=u-2');
    });
  });

  it('"내 담당" 을 누르면 내 작업만 남는 주소로 간다', async () => {
    renderAt('/p/clemvion/tasks');
    const mine = await screen.findByText('내 담당');
    await waitFor(() =>
      expect(mine.closest('a')?.getAttribute('href')).toBe('/p/clemvion/tasks?assignee=u-me'),
    );
  });
});

describe('레인은 한 쪽에서 끝나지 않는다 (WORK-10)', () => {
  it('받아 둔 카드를 다 펼치면 [더 받아 오기] 가 다음 쪽을 부른다', async () => {
    pages['ready'] = [
      { items: [task('r1', 'ready')], next_cursor: 'c1' },
      { items: [task('r2', 'ready')], next_cursor: null },
    ];
    renderAt('/p/clemvion/tasks');
    const lane = await screen.findByTestId('column-ready');
    const more = await within(lane).findByTestId('lane-more-ready');
    expect(more.textContent).toBe('더 받아 오기');
    fireEvent.click(more);
    await waitFor(() => expect(within(lane).getByText('작업 r2')).toBeDefined());
    expect(asked.some((u) => u.includes('status=ready') && u.includes('cursor=c1'))).toBe(true);
    // 마지막 쪽이면 단추도 없다
    expect(within(lane).queryByTestId('lane-more-ready')).toBeNull();
  });

  it('빈 ready 레인은 막힌 것과 백로그로 이끈다', async () => {
    pages['ready'] = [{ items: [], next_cursor: null }];
    renderAt('/p/clemvion/tasks');
    const empty = await screen.findByTestId('ready-empty');
    expect(empty.textContent).toContain('준비된 작업이 없습니다');
    await waitFor(() =>
      expect(within(empty).getByTestId('ready-empty-blocked').textContent).toBe('막힘 1건 보기'),
    );
    expect(within(empty).getByTestId('ready-empty-backlog').textContent).toBe('백로그 2건 채우기');
  });

  it('백로그를 끈 채면 "백로그 채우기" 가 백로그 레인을 켠다', async () => {
    pages['ready'] = [{ items: [], next_cursor: null }];
    const history = renderAt('/p/clemvion/tasks?backlog=0');
    const backlog = await screen.findByTestId('ready-empty-backlog');
    expect(screen.queryByTestId('column-backlog')).toBeNull();
    fireEvent.click(backlog);
    await waitFor(() => expect(params(history).get('backlog')).toBeNull());
    expect(await screen.findByTestId('column-backlog')).toBeDefined();
  });
});
