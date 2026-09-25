// 키보드 셸 — 본문 건너뛰기 · 헤더 메뉴 · 모달 한 벌 · 알림 행 · 트리 한 칸 — REQ-WEB-224 (2026-09-25 · UI/UX 검토 P11b)
//
// 키보드로 일하는 사람은 매 화면 헤더·사이드바·펼친 트리 전체를 지나야 본문에 닿았고(SYS-X2), 헤더 메뉴는
// Esc 로 닫히지 않고 열림을 말하지 않았다(NAV-12). 모달 넷은 저마다 달라 Tab 이 뒤로 샜고(SYS-06), 알림 행은
// Tab 으로 닿지 않았으며 [읽음]은 포커스해도 투명했다(HUB-X1 · SYS-X3).

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_EVENT } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';
import { Modal } from './ui/modal.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

type Row = Record<string, unknown>;

const NODES: Row[] = [
  {
    id: 'n-1',
    key: 'SPC-A',
    title: '가 문서',
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'n-2',
    key: 'SPC-B',
    title: '나 문서',
    type: 'feature',
    parent_id: 'n-1',
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'n-3',
    key: 'SPC-C',
    title: '다 문서',
    type: 'feature',
    parent_id: null,
    doc_status: 'draft',
    version_no: 1,
  },
];

let posted: string[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const path = u.split('?')[0]!;
      if (init?.method === 'POST') {
        posted.push(path);
        return ok({ ok: true });
      }
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          email: 'jimin@example.com',
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
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'clemvion' });
      if (path.endsWith('/specs/tree')) return ok(NODES);
      if (path.endsWith('/specs/graph')) return ok({ nodes: NODES, edges: [] });
      if (path.includes('unread-count')) return ok({ count: 1, immediate: 1 });
      if (path === '/me/notifications') {
        return ok({
          items: [
            {
              id: 'nt-1',
              state: 'unread',
              event_type: NERV_EVENT.SPEC_APPROVED,
              spec_key: 'SPC-A',
              version_no: 2,
              project_slug: 'clemvion',
              org_slug: 'default',
              actor_name: '서연',
              is_agent: false,
              occurred_at: '2026-09-25T00:00:00Z',
            },
          ],
          next_cursor: null,
        });
      }
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

describe('본문으로 건너뛴다 (SYS-X2)', () => {
  it('셸의 첫 링크가 본문으로 가고, 누르면 main 이 포커스를 받는다', async () => {
    renderAt('/inbox');
    const skip = await screen.findByTestId('skip-to-main');
    expect(skip.textContent).toBe('본문으로 건너뛰기');
    fireEvent.click(skip);
    expect(document.activeElement?.id).toBe('main');
    expect(document.activeElement?.tagName).toBe('MAIN');
  });
});

describe('헤더 메뉴는 키보드로도 열고 닫는다 (NAV-12)', () => {
  it('열림을 말하고, 열면 첫 항목으로 가며, Esc 로 닫고 연 단추로 돌아간다', async () => {
    renderAt('/inbox');
    const trigger = await screen.findByTestId('user-menu');
    expect(trigger.getAttribute('aria-haspopup')).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    const menu = document.getElementById('shell-menu-user')!;
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(document.getElementById('shell-menu-user')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('포커스가 메뉴 밖으로 나가면 닫힌다', async () => {
    renderAt('/inbox');
    const trigger = await screen.findByTestId('help-menu');
    fireEvent.click(trigger);
    await waitFor(() => expect(document.getElementById('shell-menu-help')).not.toBeNull());
    screen.getByTestId('skip-to-main').focus();
    await waitFor(() => expect(document.getElementById('shell-menu-help')).toBeNull());
  });
});

describe('모달 한 벌 (SYS-06)', () => {
  function Harness(): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return (
      <LocaleProvider locale="ko">
        <button type="button" onClick={() => setOpen(true)}>
          열기
        </button>
        {open && (
          <Modal label="시험 모달" onClose={() => setOpen(false)} testId="modal">
            <input aria-label="첫 칸" />
            <button type="button">끝 단추</button>
          </Modal>
        )}
      </LocaleProvider>
    );
  }

  it('aria-modal 이고, 첫 칸으로 가며, Tab 이 안을 돌고, Esc 면 연 단추로 돌아간다', async () => {
    render(<Harness />);
    const opener = screen.getByText('열기');
    opener.focus();
    fireEvent.click(opener);
    const modal = await screen.findByTestId('modal');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('첫 칸')));
    const last = screen.getByText('끝 단추');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('첫 칸'));
    fireEvent.keyDown(screen.getByLabelText('첫 칸'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('modal')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe('화면의 모달도 그 한 벌을 쓴다 (SYS-06)', () => {
  it('기준선 대화상자는 aria-modal 이고 Esc 로 닫히며 [기준선 생성]으로 돌아간다', async () => {
    renderAt('/p/clemvion/specs');
    const open = await screen.findByTestId('freeze-baseline');
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    open.focus();
    fireEvent.click(open);
    const dialog = await screen.findByTestId('freeze-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('freeze-dialog')).toBeNull());
    expect(document.activeElement).toBe(open);
  });
});

describe('알림 행을 키보드로 연다 (HUB-X1 · SYS-X3)', () => {
  it('행의 본문은 링크다 — 누르면 읽음으로 하고 그 자리로 간다', async () => {
    const history = renderAt('/notifications');
    const link = await screen.findByTestId('notification-link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toContain('/p/clemvion/specs/SPC-A');
    // 안 읽음은 글자로 말한다 — role 없는 점의 aria-label 은 읽히지 않았다
    expect(link.textContent).toContain('읽지 않음');
    fireEvent.click(link);
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/specs/SPC-A'));
    expect(posted).toContain('/me/notifications/nt-1/read');
  });

  it('[읽음] 은 포커스·터치에서도 보인다', async () => {
    renderAt('/notifications');
    const row = await screen.findByTestId('notification-row');
    const read = within(row).getByRole('button', { name: '읽음' });
    expect(read.className).toContain('group-focus-within:opacity-100');
    expect(read.className).toContain('[@media(hover:none)]:opacity-100');
  });
});

describe('스펙 트리는 Tab 한 칸이다 (NAV-12 · SYS-X2)', () => {
  const fullTree = async (): Promise<HTMLElement> => {
    renderAt('/p/clemvion/specs');
    await waitFor(() => expect(screen.getAllByTestId('spec-tree').length).toBeGreaterThan(0));
    const trees = screen.getAllByTestId('spec-tree');
    const tree = trees[trees.length - 1]!;
    await within(tree).findByText('가 문서');
    return tree;
  };
  const rowLink = (tree: HTMLElement, key: string): HTMLElement =>
    tree.querySelector<HTMLElement>(`[data-tree-key="${key}"]`)!;

  it('줄 하나만 Tab 을 받고 펼침 단추는 Tab 순서에 없다 — tree/treeitem 으로 읽힌다', async () => {
    const tree = await fullTree();
    const tabbable = [...tree.querySelectorAll<HTMLElement>('[data-tree-key]')].filter(
      (el) => el.tabIndex === 0,
    );
    expect(tabbable).toHaveLength(1);
    for (const toggle of within(tree).getAllByTestId('tree-toggle'))
      expect(toggle.tabIndex).toBe(-1);
    expect(within(tree).getByRole('tree')).toBeDefined();
    expect(within(tree).getAllByRole('treeitem').length).toBe(3);
  });

  it('↓↑ 로 옮기고 ← 로 접고 → 로 편다', async () => {
    const tree = await fullTree();
    const first = rowLink(tree, 'SPC-A');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(rowLink(tree, 'SPC-B')));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    // 잎에서 ← 는 부모로 간다
    await waitFor(() => expect(document.activeElement).toBe(rowLink(tree, 'SPC-A')));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() => expect(rowLink(tree, 'SPC-B')).toBeNull());
    const item = rowLink(tree, 'SPC-A').closest('[role="treeitem"]')!;
    expect(item.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(rowLink(tree, 'SPC-A'), { key: 'ArrowRight' });
    await waitFor(() => expect(rowLink(tree, 'SPC-B')).not.toBeNull());
    fireEvent.keyDown(rowLink(tree, 'SPC-A'), { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(rowLink(tree, 'SPC-C')));
  });
});
