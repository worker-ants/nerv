// 스펙 메타 다이얼로그 — 보관은 한 번 묻고, Esc 로 닫히며, 막힌 이유로 가는 길이 있다
// (screens.md §2.4 "[아카이브…] 확인" · REQ-WEB-200 · 2026-09-24 UI/UX 검토 SPEC-11)

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { MetaDialog } from './meta-dialog.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderDialog(
  reply: { status: number; body: unknown },
  options: { archived?: boolean; tree?: Record<string, unknown>[] } = {},
): {
  onClose: ReturnType<typeof vi.fn>;
  calls: string[];
  bodies: unknown[];
} {
  const onClose = vi.fn();
  const calls: string[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    // 쓰기만 센다 — 실시간 공급자가 부르는 읽기는 이 검사의 것이 아니다
    if ((init?.method ?? 'GET') !== 'GET') {
      calls.push(`${init?.method ?? 'GET'} ${String(url).replace(/^.*\/api\/v1/, '')}`);
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
    } else if (options.tree !== undefined && String(url).includes('/specs/tree')) {
      return { ok: true, status: 200, json: async () => options.tree };
    }
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  // 막힌 이유가 링크라 라우터 안에서 그린다
  const root = createRootRoute({
    component: () => (
      <MetaDialog
        projectSlug="clemvion"
        // 트리는 프로젝트 UUID 가 있을 때만 읽는다 — 하위 목록을 보는 검사만 그것을 준다
        projectId={options.tree === undefined ? undefined : ('p-1' as never)}
        specKey="SPC-A"
        title="문서"
        canEdit
        archived={options.archived ?? false}
        onClose={onClose}
      />
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={new QueryClient()}>
        <RealtimeProvider>
          <RouterProvider router={router as never} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return { onClose, calls, bodies };
}

describe('문서 정보 · 보관', () => {
  it('하위가 있으면 함께 보관될 문서를 보이고, 가지째 보관하라고 보낸다 (REQ-WEB-290)', async () => {
    const node = (id: string, key: string, parent: string | null): Record<string, unknown> => ({
      id,
      key,
      title: `제목 ${key}`,
      type: 'feature',
      parent_id: parent,
      doc_status: 'approved',
      version_no: 1,
    });
    const { calls, bodies } = renderDialog(
      { status: 200, body: { archived_keys: ['SPC-A', 'SPC-A1', 'SPC-A2'] } },
      { tree: [node('a', 'SPC-A', null), node('a1', 'SPC-A1', 'a'), node('a2', 'SPC-A2', 'a1')] },
    );
    const list = await screen.findByTestId('archive-descendants');
    expect(list.textContent).toContain('하위 문서 2편');
    expect(list.textContent).toContain('SPC-A1');
    expect(list.textContent).toContain('SPC-A2');
    fireEvent.click(screen.getByTestId('meta-archive'));
    expect(screen.getByTestId('meta-archive-confirming').textContent).toContain('하위 문서 2편');
    fireEvent.click(screen.getByTestId('meta-archive-confirm'));
    await waitFor(() => expect(calls).toEqual(['POST /projects/clemvion/specs/SPC-A/archive']));
    expect(bodies[0]).toEqual({ descendants: true });
  });

  it('하위가 없으면 목록도 없고 그냥 보관한다', async () => {
    const { bodies } = renderDialog({ status: 200, body: {} }, { tree: [] });
    await screen.findByTestId('meta-save');
    expect(screen.queryByTestId('archive-descendants')).toBeNull();
    fireEvent.click(screen.getByTestId('meta-archive'));
    fireEvent.click(screen.getByTestId('meta-archive-confirm'));
    await waitFor(() => expect(bodies).toEqual([{}]));
  });

  it('이미 보관된 문서에는 [보관]이 없다 — 되살리는 길은 배너의 [복구]다 (REQ-WEB-287)', async () => {
    renderDialog({ status: 200, body: {} }, { archived: true });
    await screen.findByTestId('meta-save');
    expect(screen.queryByTestId('meta-archive')).toBeNull();
  });

  it('확인 전에는 보관하지 않는다 — 되살리는 길을 함께 말한다', async () => {
    const { calls } = renderDialog({ status: 200, body: {} });
    fireEvent.click(await screen.findByTestId('meta-archive'));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId('meta-archive-confirming').textContent).toContain('[복구]');
    fireEvent.click(screen.getByTestId('meta-archive-confirm'));
    await waitFor(() => expect(calls).toEqual(['POST /projects/clemvion/specs/SPC-A/archive']));
  });

  it('Esc 는 확인만 닫고, 한 번 더 누르면 다이얼로그를 닫는다', async () => {
    const { onClose } = renderDialog({ status: 200, body: {} });
    fireEvent.click(await screen.findByTestId('meta-archive'));
    fireEvent.keyDown(screen.getByTestId('meta-archive-cancel'), { key: 'Escape' });
    expect(screen.queryByTestId('meta-archive-confirming')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('막힌 이유는 누를 수 있다 — 정리할 문서·작업으로 가는 링크', async () => {
    renderDialog({
      status: 409,
      body: {
        ok: false,
        code: NERV_ERROR.PRECONDITION,
        message: '',
        details: {
          kind: 'archive_blocked',
          blockers: [
            { kind: 'child_spec', key: 'SPC-A-1' },
            { kind: 'active_claim', key: 'CLV-T-AAAAAA' },
          ],
        },
        retry_after_s: null,
        next_actions: [],
      },
    });
    fireEvent.click(await screen.findByTestId('meta-archive'));
    fireEvent.click(screen.getByTestId('meta-archive-confirm'));
    await screen.findByTestId('archive-blocked');
    expect(screen.getByRole('link', { name: 'SPC-A-1' }).getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-A-1',
    );
    expect(screen.getByRole('link', { name: 'CLV-T-AAAAAA' }).getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-AAAAAA',
    );
  });
});

/**
 * **명세의 칸 넷**(2026-09-28 · REQ-WEB-267 · 4.5 §2.4 "제목·부모(트리 피커)·정렬 키·owner_role").
 * 예전에는 제목과 "상위 문서 키" 입력 둘뿐이라 부모를 옮기려면 키를 외워 쳐야 했고, 지금 부모가
 * 무엇인지 보이지 않았으며, 정렬 키 · 주인 역할은 API 가 받는데 칸이 없었다.
 */
describe('메타 칸 넷 — 부모는 트리에서 고른다 (REQ-WEB-267)', () => {
  // A ─ B(이 문서) ─ C   ·   D
  const TREE = [
    { id: 'a', key: 'SPC-A', title: '제품', parent_id: null },
    { id: 'b', key: 'SPC-B', title: '로그인', parent_id: 'a' },
    { id: 'c', key: 'SPC-C', title: '소셜 로그인', parent_id: 'b' },
    { id: 'd', key: 'SPC-D', title: '운영', parent_id: null },
  ];

  function renderMeta(meta: { ownerRole?: string | null } = {}): {
    patches: Record<string, unknown>[];
  } {
    const patches: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') patches.push(JSON.parse(String(init.body)));
      const body = String(url).includes('/specs/tree') ? TREE : {};
      return { ok: true, status: 200, json: async () => body };
    });
    const root = createRootRoute({
      component: () => (
        <MetaDialog
          projectSlug="clemvion"
          projectId={'p-1' as never}
          specKey="SPC-B"
          title="로그인"
          parentKey="SPC-A"
          sortKey="020"
          ownerRole={meta.ownerRole ?? null}
          canEdit
          onClose={() => undefined}
        />
      ),
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={new QueryClient()}>
          <RealtimeProvider>
            <RouterProvider router={router as never} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
    return { patches };
  }

  it('지금 부모를 보이고, 자기와 자기 아래는 고를 수 없다', async () => {
    renderMeta();
    await screen.findByTestId('meta-parent-SPC-D');
    expect(screen.getByTestId('meta-parent-current').textContent).toContain('SPC-A');
    expect(screen.getByTestId('meta-parent-SPC-A').getAttribute('aria-checked')).toBe('true');
    expect((screen.getByTestId('meta-parent-SPC-B') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('meta-parent-SPC-C') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('meta-parent-SPC-D') as HTMLButtonElement).disabled).toBe(false);
  });

  it('바뀐 것이 없으면 저장할 수 없고, 맨 위로 옮기면 parent_key 하나만 보낸다', async () => {
    const { patches } = renderMeta();
    await screen.findByTestId('meta-parent-root');
    expect((screen.getByTestId('meta-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('meta-parent-root'));
    fireEvent.click(screen.getByTestId('meta-save'));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ parent_key: null });
  });

  it('정렬 키와 주인 역할을 바꾸면 그 둘만 보낸다', async () => {
    const { patches } = renderMeta();
    await screen.findByTestId('meta-parent-root');
    fireEvent.change(screen.getByTestId('meta-sort-key'), { target: { value: '010' } });
    fireEvent.change(screen.getByTestId('meta-owner-role'), { target: { value: 'designer' } });
    fireEvent.click(screen.getByTestId('meta-save'));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ sort_key: '010', owner_role: 'designer' });
  });

  it('주인 역할을 한 번 정하면 "정하지 않음" 은 고를 수 없다 — 비우는 길이 API 에 없다', async () => {
    renderMeta({ ownerRole: 'planner' });
    const select = (await screen.findByTestId('meta-owner-role')) as HTMLSelectElement;
    expect(select.value).toBe('planner');
    expect([...select.options].map((o) => o.value)).not.toContain('');
  });
});
