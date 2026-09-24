// 받은 요청 일괄 결정 — 선택·확인·부분 실패 (REQ-WEB-181·182·183 · 2026-09-22 사람 결정)
//
// 일괄 승인은 **본문을 열지 않고 누르는 조작**이다. 그래서 이 파일이 지키는 것은 "되는가"
// 가 아니라 그 조작에 달아 둔 브레이크 넷이다.
//
//   ① 고를 수 있는 것과 **승인되는 것**이 다르다 — 서버가 저위험이라 판정한 것만
//      (`can_bulk_approve`) 승인에 실린다. 그 차이가 선택 바에 수로 보인다.
//   ② 누르기 전에 **무엇을 승인하는지 나열**한다.
//   ③ 건마다 `seen_content_hash` 가 실린다 — 일괄이 stale 검사를 건너뛰면 일괄 승인이
//      그 방어의 구멍이 된다.
//   ④ 지나가지 못한 건은 **목록에 남아 이유를 말한다.** 20건을 눌렀는데 18건만 사라지고
//      둘이 조용히 남으면, 사람은 그 둘을 처리했다고 믿는다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/**
 * 받은 요청 넷 — **섞여 있어야 이 검사가 무언가를 지킨다.**
 * 저위험 둘 · 정족수 2(T3) 하나 · 질문 하나.
 */
const CARDS = [
  {
    id: 'a1',
    subject_type: 'spec_version',
    spec_key: 'SPC-A',
    spec_title: '웹챗 위젯',
    content_hash: 'hash-a1',
    can_approve: true,
    can_bulk_approve: true,
    approvals_required: 1,
  },
  {
    id: 'a2',
    subject_type: 'spec_version',
    spec_key: 'SPC-B',
    spec_title: '세션 복원',
    content_hash: 'hash-a2',
    can_approve: true,
    can_bulk_approve: true,
    approvals_required: 1,
  },
  {
    id: 'a3',
    subject_type: 'spec_version',
    spec_key: 'SPC-C',
    spec_title: '권한 모델',
    content_hash: 'hash-a3',
    can_approve: true,
    // T3 — 서버가 일괄에서 뺀 카드다(직군 교차 2인)
    can_bulk_approve: false,
    bulk_block_reason: 'bulk_quorum',
    approvals_required: 2,
  },
  {
    id: 'q1',
    subject_type: 'question',
    title: 'localStorage 인가 서버 세션인가',
    hostname: 'linux-ci-01',
    agent_type: 'codex',
  },
].map((card) => ({
  ...card,
  project_slug: 'clemvion',
  requested_by: '유나',
  requested_at: '2026-09-22T00:00:00Z',
  waiting_seconds: 120,
  decision: null,
  self_requested: false,
}));

let posted: { url: string; body: Record<string, unknown> }[] = [];
/** 일괄 응답 — 검사마다 갈아 끼운다(전건 성공 / 부분 실패) */
let bulkResponse: Record<string, unknown> = { ok: true, decided: 2, failed: 0, results: [] };

beforeEach(() => {
  posted = [];
  bulkResponse = { ok: true, decided: 2, failed: 0, results: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (init?.method === 'POST') {
        posted.push({
          url: u,
          body: init.body === undefined ? {} : (JSON.parse(init.body) as Record<string, unknown>),
        });
        return { ok: true, status: 200, json: async () => bulkResponse };
      }
      // **봉투다**(2026-09-24 · REQ-API-166) — 목록이 커서로 나뉜 뒤로 맨 배열이 아니다
      if (u.includes('/approvals?state=pending')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: CARDS, next_cursor: null, total: CARDS.length }),
        };
      }
      if (u.includes('/approvals?state=decided')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_cursor: null, total: 0 }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          memberships: [{ org_slug: 'default', project_slug: 'clemvion', roles: ['planner'] }],
          count: 0,
          summary: {},
        }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderInbox(path = '/inbox'): void {
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
}

async function selectAll(): Promise<void> {
  await waitFor(() => expect(screen.getAllByTestId('approval-card').length).toBe(4));
  for (const box of screen.getAllByTestId('bulk-select')) fireEvent.click(box);
}

describe('REQ-WEB-181 — 고를 수 있는 것과 승인되는 것', () => {
  it('질문 카드에는 체크박스가 없다 — 질문은 승인하는 것이 아니라 답하는 것이다', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getAllByTestId('approval-card').length).toBe(4));
    // 승인 카드 셋에만 선다
    expect(screen.getAllByTestId('bulk-select')).toHaveLength(3);
  });

  it('처리됨 탭에는 선택이 없다 — 결정된 카드는 조작 대상이 아니라 기록이다', async () => {
    renderInbox('/inbox?state=decided');
    await waitFor(() => expect(screen.queryByTestId('bulk-bar')).toBeNull());
    expect(screen.queryAllByTestId('bulk-select')).toHaveLength(0);
  });

  it('선택 바가 고른 수와 **승인 가능 수를 따로** 말한다 — 그 차이를 누른 뒤에 알면 늦다', async () => {
    renderInbox();
    await selectAll();

    expect(screen.getByTestId('bulk-bar').textContent).toContain('3건 선택');
    // T3 한 건은 빠진다 — 서버가 `can_bulk_approve: false` 로 판정한 카드다
    expect(screen.getByTestId('bulk-approvable').textContent).toContain('승인 가능 2건');
  });
});

describe('REQ-WEB-182 — 누르기 전에 무엇을 승인하는지 나열한다', () => {
  it('확인 패널이 대상만 나열하고, 빠지는 건수를 말한다', async () => {
    renderInbox();
    await selectAll();
    fireEvent.click(screen.getByTestId('bulk-approve'));

    const list = await screen.findByTestId('bulk-list');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.textContent).toContain('SPC-A');
    expect(list.textContent).toContain('SPC-B');
    // 나열되지 않은 것은 승인되지 않는다 — 목록이 곧 동의의 범위다
    expect(list.textContent).not.toContain('SPC-C');
    expect(screen.getByTestId('bulk-skipped').textContent).toContain('1건');
  });

  it('확인을 지나야 서버가 불린다 — 선택은 결정이 아니다', async () => {
    renderInbox();
    await selectAll();
    fireEvent.click(screen.getByTestId('bulk-approve'));
    await screen.findByTestId('bulk-confirm');

    expect(posted).toHaveLength(0);
  });

  it('승인 요청에 **건마다 `seen_content_hash`** 가 실린다', async () => {
    renderInbox();
    await selectAll();
    fireEvent.click(screen.getByTestId('bulk-approve'));
    fireEvent.click(await screen.findByTestId('bulk-submit'));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.url).toContain('/approvals/decisions');
    expect(posted[0]?.body['decision']).toBe('approve');
    expect(posted[0]?.body['items']).toEqual([
      { id: 'a1', seen_content_hash: 'hash-a1' },
      { id: 'a2', seen_content_hash: 'hash-a2' },
    ]);
  });

  it('거절에는 사유가 필수다 — 사유가 비면 서버를 부르지 않는다(REQ-WEB-022)', async () => {
    renderInbox();
    await selectAll();
    fireEvent.click(screen.getByTestId('bulk-reject'));

    const submit = await screen.findByTestId('bulk-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId('bulk-reason'), { target: { value: '범위가 넓습니다' } });
    fireEvent.click(screen.getByTestId('bulk-submit'));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body['comment']).toBe('범위가 넓습니다');
    // **거절은 고른 것 전부다** — 서버가 막는 것은 승인뿐이다(EP-APR-03)
    expect((posted[0]?.body['items'] as unknown[]).length).toBe(3);
  });
});

describe('REQ-WEB-183 — 지나가지 못한 건은 남아서 이유를 말한다', () => {
  it('부분 실패는 실패한 카드만 선택에 남기고 그 자리에 사유를 적는다', async () => {
    bulkResponse = {
      ok: true,
      decided: 1,
      failed: 1,
      results: [
        { id: 'a1', ok: true },
        {
          id: 'a2',
          ok: false,
          kind: 'stale_approval',
          message: '카드를 연 뒤 내용이 바뀌었습니다.',
        },
      ],
    };
    renderInbox();
    await selectAll();
    fireEvent.click(screen.getByTestId('bulk-approve'));
    fireEvent.click(await screen.findByTestId('bulk-submit'));

    const failure = await screen.findByTestId('bulk-failure');
    expect(failure.textContent).toContain('카드를 연 뒤 내용이 바뀌었습니다.');
    // 남은 한 건만 선택에 남는다 — 목록이 통째로 비면 전부 처리됐다는 거짓말이 된다
    await waitFor(() => expect(screen.getByTestId('bulk-bar').textContent).toContain('1건 선택'));
  });
});
