// 작업 상세는 보드 위 시트다 — REQ-WEB-213 (2026-09-24 사람 결정 · UI/UX 검토 P08c · NAV-08 · WORK-05)
//
// 상세가 보드를 갈아 끼우는 페이지였을 때는 "← 보드로" 한 번에 걸어 둔 필터(`?spec=`·`?backlog=0`)가
// 풀렸고, 접은 레인과 펼친 "+N개 더" 도 초기화됐다. 명세는 처음부터 "보드 위 오버레이 + [닫기 ✕]" 였다.

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

const KEYS = ['CLV-T-AAAAAA', 'CLV-T-BBBBBB', 'CLV-T-CCCCCC'];
const TITLES: Record<string, string> = {
  'CLV-T-AAAAAA': '첫째 일',
  'CLV-T-BBBBBB': '둘째 일',
  'CLV-T-CCCCCC': '셋째 일',
};

const summary = (key: string): Row => ({
  id: `t-${key}`,
  key,
  title: TITLES[key],
  status: 'in_progress',
  priority: 'P2',
  updated_at: '2026-09-24T00:00:00Z',
});

const detail = (key: string): Row => ({
  ...summary(key),
  goal_md: '목표',
  output_format_md: 'PR',
  tools_sources_md: '도구',
  boundaries_md: '경계',
  claims: [],
  evidence: [],
  reviews: [],
  dependencies: [],
});

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

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
              project_slug: 'clemvion',
              roles: ['developer'],
            },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'Clemvion' }]);
      }
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'Clemvion' });
      const one = /\/tasks\/(CLV-T-[A-Z]+)$/.exec(path);
      if (one !== null) return ok(detail(one[1]!));
      if (path.endsWith('/tasks')) {
        return ok({
          items: u.includes('status=in_progress') ? KEYS.map(summary) : [],
          next_cursor: null,
        });
      }
      return ok({ items: [], next_cursor: null, summary: {}, memberships: [], count: 0 });
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

async function sheetTitle(): Promise<string> {
  const sheet = await screen.findByTestId('task-sheet');
  return (await within(sheet).findByRole('heading', { level: 1 })).textContent ?? '';
}

describe('상세는 보드 위에 열린다', () => {
  it('상세 주소로 열어도 보드가 뒤에 서 있다 — 시트는 대화상자로 읽힌다', async () => {
    renderAt('/p/clemvion/tasks/CLV-T-BBBBBB');
    const sheet = await screen.findByTestId('task-sheet');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-label')).toContain('CLV-T-BBBBBB');
    expect(await screen.findByTestId('column-in_progress')).toBeTruthy();
    expect(await sheetTitle()).toBe('둘째 일');
  });

  it('카드를 열 때 보드의 필터를 물고 간다 — 파생 폼의 인자는 싣지 않는다', async () => {
    renderAt('/p/clemvion/tasks?backlog=0&from_spec=SPC-X&from_version=v-1');
    const column = await screen.findByTestId('column-in_progress');
    const link = (await within(column).findByText('둘째 일')).closest('a');
    const href = link!.getAttribute('href') ?? '';
    expect(href.startsWith('/p/clemvion/tasks/CLV-T-BBBBBB')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1] ?? '');
    expect(q.get('backlog')).toBe('false');
    expect(q.get('from_spec')).toBeNull();
  });
});

describe('닫아도 보드는 보던 그대로다', () => {
  it('✕ 로 닫으면 걸어 둔 필터가 남는다', async () => {
    const history = renderAt('/p/clemvion/tasks/CLV-T-BBBBBB?backlog=0&spec=SPC-X');
    fireEvent.click(await screen.findByTestId('task-sheet-close'));
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/tasks'));
    expect(params(history).get('backlog')).toBe('false');
    expect(params(history).get('spec')).toBe('SPC-X');
    await waitFor(() => expect(screen.queryByTestId('task-sheet')).toBeNull());
  });

  it('Esc 로도 닫는다 — 입력 중이면 닫지 않는다', async () => {
    const history = renderAt('/p/clemvion/tasks/CLV-T-BBBBBB');
    await screen.findByTestId('task-sheet');
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(history.location.pathname).toBe('/p/clemvion/tasks/CLV-T-BBBBBB');
    input.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/tasks'));
  });

  it('보드는 언마운트되지 않는다 — 접어 둔 레인이 열고 닫은 뒤에도 접혀 있다', async () => {
    renderAt('/p/clemvion/tasks');
    const toggle = await screen.findByTestId('lane-toggle-ready');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const column = await screen.findByTestId('column-in_progress');
    fireEvent.click((await within(column).findByText('둘째 일')).closest('a')!);
    await screen.findByTestId('task-sheet');
    fireEvent.click(screen.getByTestId('task-sheet-close'));
    await waitFor(() => expect(screen.queryByTestId('task-sheet')).toBeNull());
    expect(screen.getByTestId('lane-toggle-ready').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('j · k 로 같은 레인을 훑는다', () => {
  it('다음·앞 작업으로 넘기고, 레인에서의 자리를 적는다', async () => {
    const history = renderAt('/p/clemvion/tasks/CLV-T-BBBBBB?backlog=0');
    expect((await screen.findByTestId('task-sheet-position')).textContent).toContain('2');
    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/tasks/CLV-T-CCCCCC'));
    expect(params(history).get('backlog')).toBe('false');
    await waitFor(async () => expect(await sheetTitle()).toBe('셋째 일'));
    // 끝에서는 더 가지 않는다
    fireEvent.keyDown(window, { key: 'j' });
    expect(history.location.pathname).toBe('/p/clemvion/tasks/CLV-T-CCCCCC');
    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/tasks/CLV-T-BBBBBB'));
  });
});
