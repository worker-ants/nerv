// 고정한 문서의 ★ — 스펙 목록의 트리 · 표 (2026-10-17 사람 결정 · 권장안 A · screens.md §1.3a · REQ-WEB-337)
//
// 핀은 퀵 스위처(⌘K)에서 고정하고 서버에 남는다(REQ-WEB-329). 명세는 「목록 · 트리에도 ★로 표기한다」고 적어 두고 구현이
// 없었다. 이 스위트가 지키는 것: 이 프로젝트에서 내가 고정한 문서만 ★ · 다른 프로젝트의 같은 키는 아니다 · 작업 · 변경 요청
// 핀은 문서가 아니다 · ★는 단추가 아니라 글자로 뜻을 주는 표시다 · 표도 같다.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

const node = (id: string, key: string, title: string): Record<string, unknown> => ({
  id,
  key,
  title,
  type: 'feature',
  parent_id: null,
  doc_status: 'approved',
  version_no: 1,
  archived_at: null,
});
const NODES = [
  node('s1', 'SPC-PINNED', '고정한 문서'),
  node('s2', 'SPC-OTHER', '다른 프로젝트에서 같은 키'),
  node('s3', 'SPC-PLAIN', '고정하지 않은 문서'),
];
const PINS = [
  { id: 'p1', target_type: 'spec', key: 'SPC-PINNED', project_slug: 'clemvion', position: 0 },
  // 다른 프로젝트의 핀은 이 목록의 것이 아니다
  { id: 'p2', target_type: 'spec', key: 'SPC-OTHER', project_slug: 'sudoku', position: 1 },
  // 같은 키라도 작업 핀은 문서가 아니다
  { id: 'p3', target_type: 'task', key: 'SPC-PLAIN', project_slug: 'clemvion', position: 2 },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      if (u.includes('/specs/tree')) return ok(NODES);
      if (u.includes('/specs/graph')) return ok({ nodes: NODES, edges: [] });
      if (u.endsWith('/me/pins')) return ok({ items: PINS });
      return ok({
        id: 'p1',
        items: [],
        memberships: [{ org_slug: 'default', project_slug: 'clemvion', roles: ['planner'] }],
        count: 0,
        summary: {},
      });
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

const rowOf = (title: string): HTMLElement =>
  screen.getByText(title).closest('a, tr') as HTMLElement;

describe('스펙 목록의 ★ — 고정한 문서 (REQ-WEB-337)', () => {
  it('트리: 이 프로젝트에서 고정한 문서에만 ★ — 다른 프로젝트 · 작업 핀은 아니다', async () => {
    renderAt('/p/clemvion/specs');
    await waitFor(() => expect(screen.getAllByTestId('pin-mark')).toHaveLength(1));
    expect(within(rowOf('고정한 문서')).getByTestId('pin-mark')).toBeTruthy();
    expect(within(rowOf('다른 프로젝트에서 같은 키')).queryByTestId('pin-mark')).toBeNull();
    expect(within(rowOf('고정하지 않은 문서')).queryByTestId('pin-mark')).toBeNull();
  });

  it('★는 단추가 아니라 뜻을 글자로 주는 표시다 — 고정 · 해제는 퀵 스위처에서 한다', async () => {
    renderAt('/p/clemvion/specs');
    const mark = await screen.findByTestId('pin-mark');
    expect(mark.tagName).toBe('SPAN');
    expect(mark.getAttribute('aria-label')).toBe('고정한 문서');
    expect(mark.getAttribute('title')).toContain('퀵 스위처');
  });

  it('표에도 같은 ★', async () => {
    renderAt('/p/clemvion/specs?view=table');
    await waitFor(() => expect(screen.getAllByTestId('pin-mark')).toHaveLength(1));
    // 표에서는 제목이 링크이고 ★는 그 칸의 이웃이다 — 줄(tr)로 찾는다
    const row = screen.getByText('고정한 문서').closest('tr') as HTMLElement;
    expect(within(row).getByTestId('pin-mark')).toBeTruthy();
  });
});
