// 초안 바로 승인 — 상세의 [바로 승인] · 목록의 "초안 승인" (2026-10-11 사람 결정 · REQ-WEB-303 · 304)
//
// 이 파일이 보는 것은 **무엇을 언제 묻고 무엇을 보내는가**다. 판정(역할 · 사전 검토 · 등급 · 본 지문 · 50건)은
// 서버의 것이고(REQ-API-287 · 289), 화면은 본 지문을 싣고 할 수 없는 사람에게 잠긴 이유를 보인다.

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

const node = (id: string, key: string, parent: string | null, extra: Row = {}): Row => ({
  id,
  key,
  title: `제목 ${key}`,
  type: 'feature',
  parent_id: parent,
  doc_status: 'approved',
  version_no: 1,
  archived_at: null,
  ...extra,
});
/** 뿌리 R 아래 초안 둘(A · B)과 승인본 하나(DONE) */
const NODES = [
  node('r', 'DRF-R', null),
  node('a', 'DRF-A', 'r', { doc_status: 'draft' }),
  node('b', 'DRF-B', 'r', { doc_status: 'draft' }),
  node('d', 'DRF-DONE', 'r'),
];
const DRAFTS: Row[] = [
  {
    version_id: 'ver-a',
    version_no: 1,
    spec_key: 'DRF-A',
    spec_title: '제목 DRF-A',
    content_hash: 'aa11',
    can_approve: true,
    can_bulk_approve: true,
    bulk_block_reason: null,
    body_change: null,
  },
  {
    version_id: 'ver-b',
    version_no: 2,
    spec_key: 'DRF-B',
    spec_title: '제목 DRF-B',
    content_hash: 'bb22',
    can_approve: true,
    can_bulk_approve: true,
    bulk_block_reason: null,
    body_change: null,
  },
];

const DRAFT_DETAIL: Row = {
  spec_id: 's-1',
  key: 'SPC-X',
  title: '위젯 상태',
  type: 'feature',
  project_id: 'p-1',
  body_md: '# 위젯 상태\n\n본문',
  requirements: [],
  recheck: { count: 0, specs: [] },
  version_id: 'v-1',
  version_no: 1,
  doc_status: 'draft',
  content_hash: 'cafe01',
  pending_approval_id: null,
};

let roles: string[];
let detail: Row;
let checkVerdict: Row;
let asked: string[];
let posted: { url: string; body: unknown; key: string | null }[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
const isLocked = (b: Element | null | undefined): boolean =>
  b != null && ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  roles = ['planner'];
  detail = DRAFT_DETAIL;
  checkVerdict = { verdict: 'warning', findings: [] };
  asked = [];
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const path = u.split('?')[0]!;
      if ((init?.method ?? 'GET') === 'POST') {
        const headers = new Headers(init?.headers);
        posted.push({
          url: path,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
          key: headers.get('Idempotency-Key'),
        });
        if (path.endsWith('/specs/approve-drafts')) {
          return ok({
            ok: true,
            batch_id: 'b-1',
            approved: 1,
            waiting: 0,
            failed: 1,
            results: [
              { version_id: 'ver-a', ok: true, status: 'approved', spec_key: 'DRF-A' },
              {
                version_id: 'ver-b',
                ok: false,
                kind: 'precheck_blocked',
                message: '사전 검토에서 막혔습니다.',
              },
            ],
          });
        }
        return ok({ status: 'approved', gate_tier: 'T2', approval_id: null, web_url: '/' });
      }
      asked.push(path);
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
      if (path.endsWith('/specs/approvable-drafts')) return ok({ items: DRAFTS });
      if (path.endsWith('/specs/pending-approvals')) return ok({ items: [] });
      if (path.endsWith('/check')) return ok(checkVerdict);
      if (path === '/projects/demo/specs/SPC-X') return ok(detail);
      // 초안을 감싼 변경 요청 — 아무도 고르지 않았다(`planned_actions: null`)
      if (path === '/projects/demo/crs/DEMO-C-7QF3K2') {
        return ok({
          key: 'DEMO-C-7QF3K2',
          status: 'open',
          planned_actions: null,
          impact: {
            suggestions: {
              derive: [{ ref: 'REQ-X-003' }, { ref: 'REQ-X-004' }],
              reverify: [{ ref: 'REQ-X-001', done_tasks: ['DEMO-T-1'] }],
              cancel: [{ task_key: 'DEMO-T-2' }],
            },
          },
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

const box = (key: string): HTMLInputElement =>
  within(screen.getByText(`제목 ${key}`).closest('div')!).getByTestId(
    'tree-select',
  ) as HTMLInputElement;

describe('스펙 상세의 [바로 승인] (REQ-WEB-303)', () => {
  it('초안이면 [검토 요청] 곁에 선다 — 누르면 무엇을 한꺼번에 하는지 먼저 말한다', async () => {
    renderAt('/p/demo/specs/SPC-X');
    const button = await screen.findByTestId('direct-approve');
    await waitFor(() => expect(isLocked(button)).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByTestId('impact-preview');
    expect(dialog.getAttribute('data-intent')).toBe('approve');
    expect(within(dialog).getByTestId('direct-approve-hint').textContent).toContain(
      '검토 요청과 내 승인을 한 번에',
    );
    fireEvent.click(within(dialog).getByTestId('impact-confirm'));
    // **본 지문을 싣는다** — 초안은 가변이라 그 사이 고쳐 쓴 본문을 승인하지 않게 한다(REQ-API-287)
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      url: '/projects/demo/spec-versions/v-1/approve',
      body: { seen_content_hash: 'cafe01' },
    });
    expect(posted[0]?.key).not.toBeNull();
  });

  it('초안이 변경 요청이면 승인하며 함께 할 일을 받은 요청 카드와 같은 문장으로 적는다 — 고르지 않았으면 기본값', async () => {
    detail = {
      ...DRAFT_DETAIL,
      change_request: { id: 'cr-1', key: 'DEMO-C-7QF3K2', status: 'open', web_url: '/' },
    };
    renderAt('/p/demo/specs/SPC-X');
    const button = await screen.findByTestId('direct-approve');
    await waitFor(() => expect(isLocked(button)).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByTestId('impact-preview');
    const plan = await within(dialog).findByTestId('impact-cr-plan');
    expect(plan.textContent).toContain(
      '승인하면 기본값대로 파생 작업 2건 · 재검증 작업 1건을 만듭니다.',
    );
    expect(plan.textContent).toContain('보관 제안 1건은 변경 요청 화면에서 고릅니다.');
    expect(within(dialog).getByTestId('impact-cr').textContent).toContain(
      '함께 할 일을 바꾸려면 변경 요청 화면에서 고릅니다.',
    );
    // 고르지 않은 승인은 `cr_actions` 를 보내지 않는다 — 기본값은 서버가 정한다
    fireEvent.click(within(dialog).getByTestId('impact-confirm'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ seen_content_hash: 'cafe01' });
  });

  it('[검토 요청]은 그대로 검토 요청을 보낸다 — 같은 창이 무엇을 보내는지 가른다', async () => {
    renderAt('/p/demo/specs/SPC-X');
    fireEvent.click(await screen.findByTestId('submit-review'));
    const dialog = await screen.findByTestId('impact-preview');
    expect(dialog.getAttribute('data-intent')).toBe('submit');
    expect(within(dialog).queryByTestId('direct-approve-hint')).toBeNull();
    fireEvent.click(within(dialog).getByTestId('impact-confirm'));
    await waitFor(() => expect(posted[0]?.url).toBe('/projects/demo/spec-versions/v-1/submit'));
  });

  it('바로 승인할 수 없는 역할에는 잠긴 채 누가 할 수 있는지 보인다', async () => {
    roles = ['developer'];
    renderAt('/p/demo/specs/SPC-X');
    const button = await screen.findByTestId('direct-approve');
    await waitFor(() => expect(isLocked(button)).toBe(true));
    // 잠긴 이유가 누가 할 수 있는지 말한다 — 목록은 서버와 같은 식에서 나온다(DIRECT_APPROVE_ROLES)
    expect(button.getAttribute('data-reason')).toContain('admin · planner');
  });

  it('사전 검토가 막으면 검토 요청처럼 잠긴다', async () => {
    checkVerdict = {
      verdict: 'block',
      findings: [{ severity: 'block', checker: 'requirement-shape', message: '번호 겹침' }],
    };
    renderAt('/p/demo/specs/SPC-X');
    const button = await screen.findByTestId('direct-approve');
    await waitFor(() => expect(isLocked(button)).toBe(true));
  });
});

describe('스펙 목록의 "초안 승인" (REQ-WEB-304)', () => {
  it('켤 때만 묻고, 그 상태를 주소에 남긴다', async () => {
    const history = renderAt('/p/demo/specs');
    const chip = await screen.findByTestId('spec-drafts-only');
    await waitFor(() => expect(isLocked(chip)).toBe(false));
    expect(asked.some((p) => p.endsWith('/approvable-drafts'))).toBe(false);
    fireEvent.click(chip);
    await waitFor(() =>
      expect(new URLSearchParams(history.location.search).get('drafts')).toBe('true'),
    );
    await waitFor(() => expect(asked.some((p) => p.endsWith('/approvable-drafts'))).toBe(true));
  });

  it('결재 대기와 배타다 — 하나를 켜면 다른 하나는 꺼진다', async () => {
    const history = renderAt('/p/demo/specs?drafts=1');
    fireEvent.click(await screen.findByTestId('spec-pending-only'));
    await waitFor(() => {
      const search = new URLSearchParams(history.location.search);
      expect(search.get('pending')).toBe('true');
      expect(search.get('drafts')).toBeNull();
    });
  });

  it('바로 승인할 수 없는 역할에는 칩이 잠긴다 — 묻지도 않는다', async () => {
    roles = ['developer'];
    renderAt('/p/demo/specs?drafts=1');
    const chip = await screen.findByTestId('spec-drafts-only');
    await waitFor(() => expect(isLocked(chip)).toBe(true));
    expect(asked.some((p) => p.endsWith('/approvable-drafts'))).toBe(false);
  });

  it('초안만 남고, 고른 것을 본 지문과 함께 보낸다 — 처리하지 못한 것은 이유와 함께 남는다', async () => {
    renderAt('/p/demo/specs?drafts=1');
    await screen.findByTestId('draft-approve-bar');
    await screen.findAllByText('제목 DRF-A');
    await waitFor(() => expect(screen.queryByText('제목 DRF-DONE')).toBeNull());
    // 조상은 자리만 잡는다
    expect(box('DRF-R').disabled).toBe(true);

    fireEvent.click(screen.getByTestId('draft-select-all'));
    fireEvent.click(screen.getByTestId('draft-approve'));
    const confirm = await screen.findByTestId('bulk-confirm');
    // 무엇을 한꺼번에 하는지 먼저 말한다 — 검토 요청이 함께 나간다
    expect(within(confirm).getByTestId('bulk-hint').textContent).toContain(
      '검토 요청과 승인을 한 번에',
    );
    expect(within(confirm).getByTestId('bulk-list').textContent).toContain('DRF-A');
    expect(within(confirm).getByTestId('bulk-list').textContent).toContain('DRF-B');
    fireEvent.click(within(confirm).getByTestId('bulk-submit'));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      url: '/projects/demo/specs/approve-drafts',
      body: {
        items: [
          { version_id: 'ver-a', seen_content_hash: 'aa11' },
          { version_id: 'ver-b', seen_content_hash: 'bb22' },
        ],
      },
    });
    expect(posted[0]?.key).toMatch(/^drafts-/);
    const failures = await screen.findByTestId('draft-approve-failures');
    expect(failures.textContent).toContain('DRF-B');
    expect(failures.textContent).toContain('사전 검토에서 막혔습니다.');
  });

  it('초안 승인을 보는 동안에는 정리 모드를 켜지 않는다', async () => {
    renderAt('/p/demo/specs?drafts=1');
    const toggle = await screen.findByTestId('arrange-toggle');
    await waitFor(() => expect(isLocked(toggle)).toBe(true));
  });
});
