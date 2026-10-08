// 스펙 목록에서 한꺼번에 결재 (2026-10-04 · 사람 결정 A1 · A2 · A3 · REQ-WEB-292)
//
// 한꺼번에 결정하는 기능은 받은 요청에만 있었다. 이 파일이 보는 것은 **무엇을 언제 묻고 무엇을 보내는가**다 —
// 판정(자기 승인 · T3 · 50건)은 서버의 것이고, 확인 창은 받은 요청과 한 벌이다.

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

const node = (
  id: string,
  key: string,
  parent: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
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
/** 뿌리 R 아래 검토 중 둘(LOW · T3)과 승인본 하나(DONE) */
const NODES = [
  node('r', 'DEC-R', null),
  node('l', 'DEC-LOW', 'r', { doc_status: 'in_review' }),
  node('h', 'DEC-T3', 'r', { doc_status: 'in_review' }),
  node('d', 'DEC-DONE', 'r'),
];
const PENDING = [
  {
    approval_id: 'ap-low',
    spec_key: 'DEC-LOW',
    spec_title: '제목 DEC-LOW',
    content_hash: 'aa11',
    can_approve: true,
    can_bulk_approve: true,
    bulk_block_reason: null,
    // 확인하고 크게 줄인 초안 — 확인 목록이 그 줄에 따로 표시한다(REQ-WEB-298)
    body_change: {
      before: { bytes: 40000, headings: 31, requirements: 0 },
      after: { bytes: 5000, headings: 5, requirements: 0 },
      requirements_kept: 0,
      shrunk: ['bytes', 'headings'],
      base_version_no: 1,
      acknowledged: true,
    },
  },
  {
    approval_id: 'ap-t3',
    spec_key: 'DEC-T3',
    spec_title: '제목 DEC-T3',
    content_hash: 'bb22',
    can_approve: true,
    can_bulk_approve: false,
    bulk_block_reason: 'bulk_quorum',
  },
];

let asked: string[];
let posted: { url: string; body: unknown; key: string | null }[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
const isLocked = (b: Element | null | undefined): boolean =>
  b != null && ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');

beforeEach(() => {
  localStorage.clear();
  asked = [];
  posted = [];
  Element.prototype.scrollIntoView = vi.fn();
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
        return ok({ decided: 1, failed: 0, results: [{ id: 'ap-low', ok: true }] });
      }
      asked.push(path);
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'default', org_name: 'Default', project_slug: 'demo', roles: ['planner'] },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([{ id: 'p-1', slug: 'demo', key: 'DEMO', name: 'Demo' }]);
      }
      if (path === '/projects/demo') return ok({ id: 'p-1', slug: 'demo', name: 'Demo' });
      if (path.endsWith('/specs/tree')) return ok(NODES);
      if (path.endsWith('/specs/graph')) return ok({ nodes: NODES, edges: [] });
      if (path.endsWith('/specs/pending-approvals')) return ok({ items: PENDING });
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

const box = (key: string): HTMLInputElement =>
  within(screen.getByText(`제목 ${key}`).closest('div')!).getByTestId(
    'tree-select',
  ) as HTMLInputElement;

describe('결재 대기 칩 (REQ-WEB-292)', () => {
  it('켤 때만 묻고, 그 상태를 주소에 남긴다', async () => {
    const history = renderAt('/p/demo/specs');
    const chip = await screen.findByTestId('spec-pending-only');
    expect(asked.some((p) => p.endsWith('/pending-approvals'))).toBe(false);
    fireEvent.click(chip);
    await waitFor(() =>
      expect(new URLSearchParams(history.location.search).get('pending')).toBe('true'),
    );
    await waitFor(() => expect(asked.some((p) => p.endsWith('/pending-approvals'))).toBe(true));
  });

  it('결정할 수 있는 문서만 남고, 그 줄만 고를 수 있다', async () => {
    renderAt('/p/demo/specs?pending=1');
    await screen.findByTestId('decision-bar');
    await screen.findAllByText('제목 DEC-LOW');
    await waitFor(() => expect(screen.queryByText('제목 DEC-DONE')).toBeNull());
    // 조상은 자리를 잡아 주지만 고를 수 없다
    expect(box('DEC-R').disabled).toBe(true);
    expect(box('DEC-LOW').disabled).toBe(false);
  });

  it('고른 것을 받은 요청과 같은 일괄 결정으로 보낸다 — 결재 ID 와 본문 지문을 싣는다', async () => {
    renderAt('/p/demo/specs?pending=1');
    await screen.findAllByText('제목 DEC-LOW');
    fireEvent.click(box('DEC-LOW'));
    fireEvent.click(box('DEC-T3'));
    fireEvent.click(screen.getByTestId('decision-approve'));
    const confirm = await screen.findByTestId('bulk-confirm');
    // T3 는 일괄 승인에서 빠지고 이유가 함께 보인다
    expect(within(confirm).getByTestId('bulk-skipped-list').textContent).toContain('DEC-T3');
    expect(within(confirm).getByTestId('bulk-list').textContent).toContain('DEC-LOW');
    expect(within(confirm).getByTestId('bulk-list').textContent).not.toContain('DEC-T3');
    // 본문을 열지 않고 결정하는 자리 — 크게 줄어든 문서는 줄마다 표시된다(REQ-WEB-298)
    expect(within(confirm).getAllByTestId('bulk-shrunk')).toHaveLength(1);
    fireEvent.click(within(confirm).getByTestId('bulk-submit'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      url: '/approvals/decisions',
      body: { decision: 'approve', items: [{ id: 'ap-low', seen_content_hash: 'aa11' }] },
    });
    expect(posted[0]?.key).toMatch(/^bulk-/);
  });

  it('거절은 사유가 있어야 보낸다', async () => {
    renderAt('/p/demo/specs?pending=1');
    await screen.findAllByText('제목 DEC-LOW');
    fireEvent.click(box('DEC-T3'));
    fireEvent.click(screen.getByTestId('decision-reject'));
    const confirm = await screen.findByTestId('bulk-confirm');
    const submit = within(confirm).getByTestId('bulk-submit');
    expect(isLocked(submit)).toBe(true);
    fireEvent.change(within(confirm).getByTestId('bulk-reason'), {
      target: { value: '요구사항이 빠졌다' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(posted[0]?.body).toMatchObject({
        decision: 'reject',
        comment: '요구사항이 빠졌다',
        items: [{ id: 'ap-t3' }],
      }),
    );
  });

  it('결재 대기를 보는 동안에는 정리 모드를 켜지 않는다', async () => {
    renderAt('/p/demo/specs?pending=1');
    const toggle = await screen.findByTestId('arrange-toggle');
    await waitFor(() => expect(isLocked(toggle)).toBe(true));
  });
});

describe('표의 새 버전 표시 (REQ-WEB-292)', () => {
  it('승인본 위에 검토 중 개정판이 있으면 표에도 보인다', async () => {
    NODES.push(
      node('n', 'DEC-NEWER', 'r', {
        latest_version_no: 3,
        latest_status: 'in_review',
        approved_version_no: 2,
      }),
    );
    try {
      renderAt('/p/demo/specs?view=table');
      const marker = await screen.findByTestId('table-newer');
      expect(marker.textContent).toContain('v3');
    } finally {
      NODES.pop();
    }
  });
});
