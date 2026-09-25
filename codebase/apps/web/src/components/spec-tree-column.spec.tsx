// 스펙 트리의 둘째 열 — 스펙 상세에서만 선다 (2026-09-25 — 사람 결정 D1 · UI/UX 검토 OBS-01 · REQ-WEB-226)
//
// 트리는 사이드바의 마지막 블록이었다: 작업·세션·리뷰에서도 그 화면과 상관없는 문서 목록이 왼쪽 열 대부분을
// 차지했고, 스펙 목록에서는 본문의 전수 트리와 함께 같은 트리가 한 화면에 두 번 섰다. 이 스위트가 지키는 것:
// 트리는 사이드바에 없다 · 목록에는 본문의 것 하나 · 상세에서만 둘째 열로 선다 · 그 머리의 칸은 제목 거르기다 ·
// 넓으면 제자리(접은 것은 남는다), 좁으면 띠가 여는 겹침 패널(Esc·문서를 고르면 닫힌다) · 문서를 옮겨도 열은
// 다시 그려지지 않는다.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    id: 'r',
    key: 'SPC-R',
    title: '뿌리',
    type: 'area',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'a',
    key: 'SPC-A',
    title: '위젯',
    type: 'feature',
    parent_id: 'r',
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'b',
    key: 'SPC-B',
    title: '임베드',
    type: 'feature',
    parent_id: 'r',
    doc_status: 'draft',
    version_no: 1,
  },
];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/specs/tree')) return ok(NODES);
      if (/\/orgs\/[^/]+\/projects/.test(u)) return ok([{ id: 'p-1', slug: 'demo', name: 'Demo' }]);
      if (/\/projects\/demo$/.test(u))
        return ok({ id: 'p-1', slug: 'demo', key: 'DEMO', name: 'Demo' });
      if (u.endsWith('/me'))
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'nerv', org_name: 'NERV', project_slug: null, roles: ['admin'] },
          ],
        });
      return ok({ items: [], summary: {}, next_cursor: null, memberships: [], count: 0 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string) {
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
  return router;
}

/** 열이 제자리에 서는 폭(`xl`)이라고 말한다 — jsdom 에는 `matchMedia` 가 없어 기본은 좁은 화면이다 */
function stubWide(): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(min-width: 80rem)' || query === '(min-width: 48rem)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const column = (): Promise<HTMLElement> => screen.findByTestId('spec-column');

describe('트리가 서는 곳 (OBS-01)', () => {
  it('사이드바에는 트리가 없다 — 세션 화면은 그 폭을 본문이 갖는다', async () => {
    // 작업 보드는 스펙 거르기 칸이 트리 목록을 부른다 — 트리와 상관없는 화면으로 본다
    mount('/p/demo/sessions');
    const rail = await screen.findByTestId('nav-rail');
    await waitFor(() => expect(within(rail).getByTestId('rail-project-current')).toBeDefined());
    // 트리를 세우면 그 목록을 부른다 — 부를 틈을 주고, 부르지 않았는지를 본다(그리는 중인 골격도 트리다)
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some(([url]) => String(url).includes('/specs/tree'))).toBe(false);
    expect(screen.queryByTestId('spec-tree')).toBeNull();
    expect(screen.queryByTestId('spec-column')).toBeNull();
  });

  it('스펙 목록에는 본문의 전수 트리 하나다 — 같은 트리가 한 화면에 두 번 서지 않는다', async () => {
    mount('/p/demo/specs');
    await screen.findAllByText('뿌리');
    expect(screen.getAllByTestId('spec-tree')).toHaveLength(1);
    expect(screen.queryByTestId('spec-column')).toBeNull();
  });

  it('스펙 상세에서는 둘째 열로 선다 — 사이드바 밖이다', async () => {
    mount('/p/demo/specs/SPC-A');
    const col = await column();
    await within(col).findByText('위젯');
    expect(within(col).getByTestId('spec-tree')).toBeDefined();
    expect(within(screen.getByTestId('nav-rail')).queryByTestId('spec-tree')).toBeNull();
    expect(screen.getAllByTestId('spec-tree')).toHaveLength(1);
  });
});

describe('찾는 칸 — 둘째 열의 머리는 제목 거르기다', () => {
  it('제목·키로 거른다 — 문서 검색은 ⌘K 의 일이다', async () => {
    mount('/p/demo/specs/SPC-A');
    const col = await column();
    await within(col).findByText('임베드');
    const filter = within(col).getByTestId('tree-title-filter');
    expect(filter.getAttribute('placeholder')).toBe('제목·키로 거르기');
    fireEvent.change(filter, { target: { value: '위젯' } });
    expect(within(col).queryByText('임베드')).toBeNull();
    expect(within(col).getByText('위젯')).toBeDefined();
    fireEvent.change(filter, { target: { value: 'spc-b' } });
    expect(within(col).getByText('임베드')).toBeDefined();
  });
});

describe('좁은 폭 — 띠가 여는 겹침 패널 (REQ-WEB-164 와 같은 규칙)', () => {
  it('처음에는 닫혀 있고 띠의 단추가 연다', async () => {
    mount('/p/demo/specs/SPC-A');
    const col = await column();
    const toggle = within(col).getByTestId('spec-column-toggle');
    expect(col.dataset['open']).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('spec-column-panel');
    expect(screen.getByTestId('spec-column-panel').className).toContain('hidden');

    fireEvent.click(toggle);
    expect(col.dataset['open']).toBe('true');
    expect(screen.getByTestId('spec-column-panel').className).not.toContain('hidden');
    // 좁으면 본문을 밀지 않고 덮는다
    expect(screen.getByTestId('spec-column-panel').className).toContain('absolute');
  });

  it('Esc 로 닫히고 연 단추로 돌아온다', async () => {
    mount('/p/demo/specs/SPC-A');
    const col = await column();
    fireEvent.click(within(col).getByTestId('spec-column-toggle'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(col.dataset['open']).toBe('false');
    expect(document.activeElement).toBe(within(col).getByTestId('spec-column-toggle'));
  });

  it('문서를 고르면 닫힌다 — 그 문서를 읽을 차례다', async () => {
    const router = mount('/p/demo/specs/SPC-A');
    const col = await column();
    fireEvent.click(within(col).getByTestId('spec-column-toggle'));
    fireEvent.click(await within(col).findByText('임베드'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/demo/specs/SPC-B'));
    expect(col.dataset['open']).toBe('false');
    // 좁은 폭의 열고 닫음은 그 순간의 것이다 — 넓은 폭의 기억을 건드리지 않는다
    expect(localStorage.getItem('nerv.spec-column')).toBeNull();
  });
});

describe('넓은 폭 — 제자리에 선다', () => {
  it('처음에는 열려 있고, 접은 것은 남는다', async () => {
    stubWide();
    mount('/p/demo/specs/SPC-A');
    const col = await column();
    expect(col.dataset['open']).toBe('true');
    const panel = screen.getByTestId('spec-column-panel');
    expect(panel.className).not.toContain('absolute');
    // 열려 있으면 [접기]는 트리 머리줄 끝에 있다(트리가 선 뒤의 것을 누른다 — 불러오는 동안의 자리는 곧 바뀐다)
    await within(panel).findByText('위젯');
    const hide = within(panel).getByTestId('spec-column-toggle');
    expect(hide.getAttribute('aria-label')).toBe('스펙 트리 접기');
    fireEvent.click(hide);
    expect(col.dataset['open']).toBe('false');
    expect(localStorage.getItem('nerv.spec-column')).toBe('closed');
    cleanup();

    mount('/p/demo/specs/SPC-A');
    const again = await column();
    expect(again.dataset['open']).toBe('false');
    expect(within(again).getByTestId('spec-column-toggle').getAttribute('aria-label')).toBe(
      '스펙 트리 펴기',
    );
  });

  it('문서를 옮겨도 열은 다시 그려지지 않는다 — 접어 둔 가지가 그대로다', async () => {
    stubWide();
    const router = mount('/p/demo/specs/SPC-A');
    const col = await column();
    await within(col).findByText('임베드');
    // 뿌리를 접는다 — 보는 문서(SPC-A)를 품은 가지라 그 줄이 표시를 단다
    fireEvent.click(within(col).getAllByTestId('tree-toggle')[0]!);
    expect(within(col).queryByText('임베드')).toBeNull();

    await act(() =>
      router.navigate({ to: '/p/$proj/specs/$spec', params: { proj: 'demo', spec: 'SPC-R' } }),
    );
    expect(screen.getByTestId('spec-column')).toBe(col);
    expect(col.dataset['open']).toBe('true');
    expect(within(col).queryByText('임베드')).toBeNull();
  });
});
