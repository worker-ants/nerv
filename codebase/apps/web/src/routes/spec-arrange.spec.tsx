// 정리 모드 — 여러 문서를 고르고 옮기거나 순서를 바꾼다 (2026-10-04 · 사람 결정 M1 · M2 · M4 · REQ-WEB-291)
//
// 이동은 문서마다 [문서 정보] 창에서 하는 것뿐이었고, 순서는 정렬 키 글자를 직접 쳐야 했다. 이 파일이 보는 것은
// 화면의 모양이 아니라 **무엇을 서버에 보내는가**다 — 순서의 판정은 서버(EP-SPEC-25)가 한다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { shiftOrder } from '../features/spec-editor/arrange-bar.js';
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

const node = (id: string, key: string, parent: string | null): Record<string, unknown> => ({
  id,
  key,
  title: `제목 ${key}`,
  type: 'feature',
  parent_id: parent,
  doc_status: 'approved',
  version_no: 1,
  archived_at: null,
});
/** 뿌리 R — 자식 A · B · C, 뿌리 Q */
const NODES = [
  node('r', 'ARR-R', null),
  node('a', 'ARR-A', 'r'),
  node('b', 'ARR-B', 'r'),
  node('c', 'ARR-C', 'r'),
  node('q', 'ARR-Q', null),
];

let roles: string[];
let posted: { url: string; body: unknown }[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
/** 잠긴 단추 — 이유가 있으면 `aria-disabled` 로 잠긴다(포커스와 말풍선이 남는다) */
const isLocked = (b: Element | null | undefined): boolean =>
  b != null && ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');
const reasonOf = (b: Element | null | undefined): string | null =>
  b?.getAttribute('data-reason') ?? null;

beforeEach(() => {
  localStorage.clear();
  roles = ['planner'];
  posted = [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const path = u.split('?')[0]!;
      if ((init?.method ?? 'GET') === 'POST') {
        posted.push({
          url: path,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
        // 맡은 작업이 있는 문서 — 보관이 막힌다
        if (path.endsWith('/specs/ARR-Q/archive')) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              code: NERV_ERROR.PRECONDITION,
              message: '보관할 수 없습니다.',
              details: {
                kind: 'archive_blocked',
                blockers: [{ kind: 'active_claim', key: 'T-1' }],
              },
            }),
          };
        }
        if (path.endsWith('/archive')) return ok({ archived_keys: ['x', 'y', 'z', 'w'] });
        return ok({ changed: [] });
      }
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [{ org_slug: 'default', org_name: 'Default', project_slug: 'demo', roles }],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([{ id: 'p-1', slug: 'demo', key: 'DEMO', name: 'Demo' }]);
      }
      if (path === '/projects/demo') return ok({ id: 'p-1', slug: 'demo', name: 'Demo' });
      if (path.endsWith('/specs/tree')) return ok(NODES);
      if (path.endsWith('/specs/graph')) return ok({ nodes: NODES, edges: [] });
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

async function openArrange(path = '/p/demo/specs'): Promise<void> {
  renderAt(path);
  await screen.findAllByText('제목 ARR-B');
  fireEvent.click(await screen.findByTestId('arrange-toggle'));
  await screen.findByTestId('arrange-bar');
}

const box = (key: string): HTMLInputElement =>
  within(screen.getByText(`제목 ${key}`).closest('div')!).getByTestId(
    'tree-select',
  ) as HTMLInputElement;

describe('순서 계산 — 고른 것끼리의 순서를 지키고 끝에 닿은 것은 그대로 둔다', () => {
  it('한 칸씩 옮긴다', () => {
    expect(shiftOrder(['A', 'B', 'C'], new Set(['C']), 'up')).toEqual(['A', 'C', 'B']);
    expect(shiftOrder(['A', 'B', 'C'], new Set(['A']), 'down')).toEqual(['B', 'A', 'C']);
    expect(shiftOrder(['A', 'B', 'C', 'D'], new Set(['B', 'C']), 'up')).toEqual([
      'B',
      'C',
      'A',
      'D',
    ]);
  });

  it('더 갈 곳이 없으면 바뀐 것이 없다 — 단추를 끈다', () => {
    expect(shiftOrder(['A', 'B'], new Set(['A']), 'up')).toBeNull();
    expect(shiftOrder(['A', 'B'], new Set(['A', 'B']), 'down')).toBeNull();
  });
});

describe('정리 모드 (REQ-WEB-291)', () => {
  it('켜면 줄마다 고르는 칸이 생기고, 형제의 순서를 서버에 보낸다', async () => {
    await openArrange();
    fireEvent.click(box('ARR-C'));
    expect(screen.getByTestId('arrange-count').textContent).toContain('1편');
    fireEvent.click(screen.getByTestId('arrange-up'));
    await waitFor(() =>
      expect(posted).toEqual([
        {
          url: '/projects/demo/specs/arrange',
          body: { parent_key: 'ARR-R', keys: ['ARR-A', 'ARR-C', 'ARR-B'] },
        },
      ]),
    );
  });

  it('줄에서 Space 로도 고른다', async () => {
    await openArrange();
    const row = screen.getByText('제목 ARR-A').closest('a')!;
    fireEvent.keyDown(row, { key: ' ' });
    expect(box('ARR-A').checked).toBe(true);
  });

  it('고른 것을 다른 부모 아래로 옮긴다 — 트리 순서대로 보낸다', async () => {
    await openArrange();
    fireEvent.click(box('ARR-C'));
    fireEvent.click(box('ARR-A'));
    fireEvent.click(screen.getByTestId('arrange-move'));
    const dialog = await screen.findByTestId('arrange-move-dialog');
    // 고른 것과 그 아래는 고를 수 없다
    expect((within(dialog).getByTestId('meta-parent-ARR-A') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(within(dialog).getByTestId('meta-parent-ARR-Q'));
    fireEvent.click(within(dialog).getByTestId('arrange-move-confirm'));
    await waitFor(() =>
      expect(posted).toEqual([
        {
          url: '/projects/demo/specs/arrange',
          body: { parent_key: 'ARR-Q', keys: ['ARR-A', 'ARR-C'] },
        },
      ]),
    );
  });

  it('필터가 켜져 있으면 순서를 바꾸지 않는다 — 보이지 않는 문서 사이로 들어간다', async () => {
    await openArrange('/p/demo/specs?type=feature');
    fireEvent.click(box('ARR-C'));
    const up = screen.getByTestId('arrange-up');
    expect(isLocked(up)).toBe(true);
    expect(reasonOf(up)).toContain('필터');
    // 옮기기는 된다 — 새 자리의 맨 뒤라 보이지 않는 형제와 상관없다
    expect((screen.getByTestId('arrange-move') as HTMLButtonElement).disabled).toBe(false);
  });

  it('부모가 다른 문서는 함께 순서를 바꾸지 않는다', async () => {
    await openArrange();
    fireEvent.click(box('ARR-A'));
    fireEvent.click(box('ARR-Q'));
    const up = screen.getByTestId('arrange-up');
    expect(isLocked(up)).toBe(true);
    expect(reasonOf(up)).toContain('같은 상위 문서');
  });

  it('[보관]은 고른 것을 하위까지 보관한다 — 조상을 함께 골랐으면 위쪽만 보낸다', async () => {
    await openArrange();
    fireEvent.click(box('ARR-R'));
    fireEvent.click(box('ARR-A'));
    fireEvent.click(screen.getByTestId('arrange-archive'));
    expect(screen.getByTestId('arrange-archive-confirming').textContent).toContain('합쳐 4편');
    fireEvent.click(screen.getByTestId('arrange-archive-confirm'));
    await waitFor(() =>
      expect(posted).toEqual([
        { url: '/projects/demo/specs/ARR-R/archive', body: { descendants: true } },
      ]),
    );
  });

  it('막힌 문서는 이유와 함께 막대 아래에 남고, 나머지는 보관된다', async () => {
    await openArrange();
    fireEvent.click(box('ARR-B'));
    fireEvent.click(box('ARR-Q'));
    fireEvent.click(screen.getByTestId('arrange-archive'));
    fireEvent.click(screen.getByTestId('arrange-archive-confirm'));
    const refused = await screen.findByTestId('arrange-refused');
    expect(refused.textContent).toContain('ARR-Q');
    expect(refused.textContent).not.toContain('ARR-B');
    expect(posted.map((p) => p.url)).toEqual([
      '/projects/demo/specs/ARR-B/archive',
      '/projects/demo/specs/ARR-Q/archive',
    ]);
  });

  it('planner · admin 이 아니면 잠긴 채 이유를 보인다', async () => {
    roles = ['developer'];
    renderAt('/p/demo/specs');
    await screen.findAllByText('제목 ARR-B');
    const toggle = await screen.findByTestId('arrange-toggle');
    await waitFor(() => expect(isLocked(toggle)).toBe(true));
    expect(reasonOf(toggle)).toContain('planner');
  });
});
