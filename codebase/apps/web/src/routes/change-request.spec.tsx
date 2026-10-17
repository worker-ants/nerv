// 변경 요청(CR) 상세와 받은 요청의 CR 카드 — REQ-WEB-320 · 321 (2026-10-16 · 사람 결정 D1 · D2 · E19-S01)
//
// CR 은 승인본 위의 초안을 감싼 제안이다. 상세는 바뀐 요구사항(EP-SPEC-06 · 양 끝 고정) · 승인하면 움직이는 것 · 승인하며
// 함께 할 일 · 결정을 한자리에 둔다. 결재는 그 버전이 받으므로 검토 중이면 그 결재로 승인하고, 고른 제안이 함께 간다.
// 받은 요청에서는 같은 결재가 한 카드다 — 버전이 CR 이면 그 카드가 CR 카드가 된다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';
import { ApprovalCard } from '../features/inbox/approval-card.js';
import { setDecisionGraceForTesting } from '../features/inbox/decision-grace.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

type Row = Record<string, unknown>;
const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

let cr: Row;
let roles: string[];
let posts: { path: string; body: unknown }[];

const IMPACT = {
  spec_key: 'SPC-CWC-007',
  version_no: 5,
  base_version_no: 4,
  delta: { added: [], modified: [], removed: [] },
  tasks: [
    {
      key: 'CLV-T-DONE01',
      title: '재개 복원',
      status: 'done',
      requirement_ref: 'REQ-CWC-001',
      effect: 'reverify',
      claimed: false,
    },
    {
      key: 'CLV-T-BKLG01',
      title: '레거시 문서',
      status: 'backlog',
      requirement_ref: 'REQ-CWC-002',
      effect: 'cancel',
      claimed: false,
    },
    {
      key: 'CLV-T-PROG01',
      title: '레거시 고치기',
      status: 'in_progress',
      requirement_ref: 'REQ-CWC-002',
      effect: 'stop',
      claimed: true,
    },
  ],
  claims: [
    {
      task_key: 'CLV-T-PROG01',
      requirement_ref: 'REQ-CWC-002',
      user_id: 'u-2',
      user_name: '유나',
      session_id: 's-1',
      hostname: 'linux-ci-01',
      agent_type: 'codex',
      affected: true,
    },
  ],
  referencing: [{ key: 'SPC-CWC-009', title: '참조하는 문서', kinds: ['references'] }],
  suggestions: {
    derive: [{ ref: 'REQ-CWC-003', statement: '재시도 배너를 보인다', title: 'REQ-CWC-003 …' }],
    reverify: [{ ref: 'REQ-CWC-001', statement: '30건을 복원한다', done_tasks: ['CLV-T-DONE01'] }],
    cancel: [
      { task_key: 'CLV-T-BKLG01', title: '레거시 문서', ref: 'REQ-CWC-002', status: 'backlog' },
    ],
  },
  counts: {
    added: 1,
    modified: 1,
    removed: 1,
    tasks: 3,
    claims: 1,
    affected_claims: 1,
    referencing: 1,
  },
};

function crRow(over: Row = {}): Row {
  return {
    id: 'cr-1',
    key: 'CLV-C-7QF3K2',
    status: 'in_review',
    risk: 'normal',
    origin: 'agent',
    title: '웹챗 위젯 임베드',
    rationale_md: '재개 30건 · 레거시 임베드 제거',
    // 아무도 고르지 않았다(2026-10-16 사람 결정 · REQ-API-351) — 빈 선택(세 칸이 빈 배열)과 다르다
    planned_actions: null,
    spec_key: 'SPC-CWC-007',
    spec_title: '웹챗 위젯 임베드',
    base_version_no: 4,
    proposed_version_no: 5,
    proposed_version_id: 'v-5',
    proposed_status: 'in_review',
    content_hash: 'h5',
    created_by_user_id: 'u-1',
    author_user_id: 'u-1',
    created_by_name: '지민',
    created_hostname: 'mac-02',
    created_agent_type: 'claude-code',
    project_slug: 'clemvion',
    gate_tier: 'T2',
    approval_id: 'a-1',
    impact: IMPACT,
    web_url: '/p/clemvion/crs/CLV-C-7QF3K2',
    ...over,
  };
}

/** POST 응답에 더할 것 — 승인이 확정한 변경 요청(`change_request`) 같은 것(2026-10-17 · REQ-WEB-339) */
let postExtra: Row = {};

beforeEach(() => {
  localStorage.clear();
  postExtra = {};
  setDecisionGraceForTesting(0);
  roles = ['planner'];
  posts = [];
  cr = crRow();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const full = String(url).replace(/^.*\/api\/v1/, '');
      const path = full.split('?')[0]!;
      if (init?.method === 'POST') {
        posts.push({ path, body: init.body === undefined ? null : JSON.parse(init.body) });
        return ok({
          ...cr,
          status: 'rejected',
          quorum: { given: 1, required: 1, satisfied: true },
          ...postExtra,
        });
      }
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'default', org_name: 'Default', project_slug: 'clemvion', roles },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path))
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'Clemvion' }]);
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'Clemvion' });
      if (path === '/projects/clemvion/crs/CLV-C-7QF3K2') return ok(cr);
      if (path === '/projects/clemvion/specs/SPC-CWC-007/diff') {
        return ok({
          from: { version_no: 4, status: 'approved' },
          to: { version_no: 5, status: 'in_review' },
          requirements: [
            { ref: 'REQ-CWC-001', delta: 'modified', statement_md: '30건을 복원한다' },
            { ref: 'REQ-CWC-002', delta: 'removed', statement_md: '레거시 모드로 그린다' },
            { ref: 'REQ-CWC-003', delta: 'added', statement_md: '재시도 배너를 보인다' },
            { ref: 'REQ-CWC-004', delta: 'unchanged', statement_md: '그대로' },
          ],
          body_diff: [
            { op: 'same', text: '# 웹챗' },
            { op: 'del', text: '- REQ-CWC-002 …' },
            { op: 'add', text: '- REQ-CWC-003 …' },
          ],
        });
      }
      return ok({ items: [], next_cursor: null, total: 0, summary: {}, count: 0, totals: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setDecisionGraceForTesting();
  cleanup();
});

function renderAt(path: string): void {
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

describe('CR 상세 — 델타 · 영향 · 함께 할 일 · 결정 (REQ-WEB-320)', () => {
  it('키 · 상태 · 승인본에서 초안으로 · 위험도 · 게이트 티어와 바뀐 요구사항만 보인다', async () => {
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    expect((await screen.findByTestId('cr-key')).textContent).toContain('CLV-C-7QF3K2');
    expect(screen.getByTestId('cr-status').textContent).toContain('검토 중');
    const byline = screen.getByTestId('cr-byline');
    expect(byline.textContent).toContain('v4 → v5');
    expect(byline.textContent).toContain('에이전트 세션이 연 제안');
    expect(screen.getByTestId('cr-risk').textContent).toContain('위험도 보통');
    expect(screen.getByTestId('cr-gate').textContent).toContain('게이트 티어 T2');
    // 델타 — 양 끝이 고정이고 바뀐 요구사항만이다(그대로인 004 는 없다)
    expect((await screen.findByTestId('diff-fixed-range')).textContent).toContain('v4 → v5');
    const delta = screen.getByTestId('diff-requirements');
    expect(delta.textContent).toContain('REQ-CWC-003');
    expect(delta.textContent).not.toContain('REQ-CWC-004');
  });

  it('영향 — 작업마다 몫을 보이고 바뀐 요구사항의 클레임을 표시한다', async () => {
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    const impact = await screen.findByTestId('cr-impact');
    expect(within(impact).getByTestId('cr-impact-summary').textContent).toContain(
      '파생 작업 3건 · 진행 중 클레임 1건(바뀌거나 빠진 요구사항 1건) · 참조 문서 1건',
    );
    const effects = within(impact)
      .getAllByTestId('cr-task-effect')
      .map((e) => e.textContent);
    expect(effects).toEqual(['재검증 제안', '보관 제안', '중단 확인']);
    expect(within(impact).getByTestId('cr-claim').getAttribute('data-affected')).toBe('true');
    expect(within(impact).getByTestId('cr-referencing').textContent).toContain('SPC-CWC-009');
  });

  it('검토 중이면 그 결재로 승인한다 — 고른 제안이 함께 간다(만들기 둘은 켜져 있고 보관은 사람이 켠다)', async () => {
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    const derive = await screen.findByTestId('cr-pick-derive');
    expect((derive as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('cr-pick-reverify') as HTMLInputElement).checked).toBe(true);
    const cancel = screen.getByTestId('cr-pick-cancel');
    expect((cancel as HTMLInputElement).checked).toBe(false);
    fireEvent.click(cancel);
    fireEvent.click(screen.getByTestId('cr-approve'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: '/approvals/a-1/decision',
      body: {
        decision: 'approve',
        seen_content_hash: 'h5',
        cr_actions: {
          derive: ['REQ-CWC-003'],
          reverify: ['REQ-CWC-001'],
          cancel: ['CLV-T-BKLG01'],
        },
      },
    });
  });

  it('아무도 고르지 않았으면 기본 체크와 함께 "이 화면을 거치지 않고 승인해도 기본값" 을 적는다', async () => {
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    await screen.findByTestId('cr-pick-derive');
    expect(screen.getByTestId('cr-actions-default').textContent).toContain(
      '이 화면을 거치지 않고 승인하면 파생 · 재검증 작업은 만들고 보관은 하지 않습니다.',
    );
  });

  it('빈 선택을 골라 두었으면 그대로 보인다 — 기본 체크로 되돌리지 않는다', async () => {
    cr = crRow({ planned_actions: { derive: [], reverify: [], cancel: [] } });
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    const derive = await screen.findByTestId('cr-pick-derive');
    expect((derive as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('cr-pick-reverify') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId('cr-actions-default')).toBeNull();
  });

  it('열린 CR 의 거절은 사유가 있어야 보낸다 · 작성자에게만 철회가 있다', async () => {
    cr = crRow({ status: 'open', proposed_status: 'draft', approval_id: null, gate_tier: null });
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    expect((await screen.findByTestId('cr-gate')).textContent).toContain('검토를 요청할 때');
    fireEvent.click(screen.getByTestId('cr-reject'));
    expect(await screen.findByText('사유를 적어야 거절할 수 있습니다.')).toBeTruthy();
    expect(posts).toEqual([]);
    fireEvent.change(screen.getByTestId('cr-reason'), { target: { value: '범위 밖' } });
    fireEvent.click(screen.getByTestId('cr-reject'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: '/projects/clemvion/crs/CLV-C-7QF3K2/reject',
      body: { reason: '범위 밖' },
    });
    expect(screen.getByTestId('cr-withdraw')).toBeTruthy();
  });

  it('남의 CR 에는 철회가 없고, planner · admin 이 아니면 거절이 잠긴다', async () => {
    cr = crRow({
      status: 'open',
      proposed_status: 'draft',
      created_by_user_id: 'u-9',
      author_user_id: 'u-9',
    });
    roles = ['developer'];
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    const reject = await screen.findByTestId('cr-reject');
    expect(
      (reject as HTMLButtonElement).disabled || reject.getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    expect(screen.queryByTestId('cr-withdraw')).toBeNull();
  });

  it('승인하면 토스트가 그때 만든 작업 수와 기본값이었는지를 적는다 (2026-10-17 · REQ-WEB-339)', async () => {
    postExtra = {
      change_request: {
        key: 'CLV-C-7QF3K2',
        actions_source: 'default',
        created_tasks: [
          { key: 'CLV-T-NEW001', kind: 'derive', ref: 'REQ-CWC-003' },
          { key: 'CLV-T-NEW002', kind: 'reverify', ref: 'REQ-CWC-001' },
        ],
        archived_tasks: [],
      },
    };
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    fireEvent.click(await screen.findByTestId('cr-approve'));
    expect(
      await screen.findByText(
        '승인했습니다. 변경 요청으로 작업 2건을 만들었습니다. 고른 것이 없어 기본값을 적용했습니다.',
      ),
    ).toBeTruthy();
  });

  it('승인된 CR 은 그때 만든 작업과 보관한 작업을 보인다', async () => {
    cr = crRow({
      status: 'approved',
      proposed_status: 'approved',
      approval_id: null,
      outcome: {
        actions_source: 'default',
        created_tasks: [{ key: 'CLV-T-NEW001', kind: 'derive', ref: 'REQ-CWC-003' }],
        archived_tasks: ['CLV-T-BKLG01'],
        skipped: [],
        reason: null,
      },
    });
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    const outcome = await screen.findByTestId('cr-outcome');
    expect(outcome.textContent).toContain('CLV-T-NEW001');
    expect(outcome.textContent).toContain('CLV-T-BKLG01');
    // 고른 것이 없어 기본값이 한 일이다 — 「왜 이 작업이 생겼나」에 답한다(2026-10-17 · REQ-WEB-339)
    expect(screen.getByTestId('cr-outcome-source').textContent).toContain('기본값');
    expect(screen.queryByTestId('cr-approve')).toBeNull();
  });

  it('거절된 CR 은 초안을 버렸다고 말하고 사유를 보인다', async () => {
    cr = crRow({
      status: 'rejected',
      proposed_status: 'discarded',
      approval_id: null,
      outcome: {
        created_tasks: [],
        archived_tasks: [],
        skipped: [],
        reason: '이번 분기 범위가 아니다',
      },
    });
    renderAt('/p/clemvion/crs/CLV-C-7QF3K2');
    const closed = await screen.findByTestId('cr-closed');
    expect(closed.textContent).toContain('거절됨 — 초안(v5)을 버렸습니다.');
    expect(closed.textContent).toContain('이번 분기 범위가 아니다');
  });
});

describe('받은 요청의 CR 카드 — 같은 결재는 한 카드다 (REQ-WEB-321)', () => {
  async function renderCard(card: Row): Promise<void> {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute({
      component: () => (
        <RealtimeProvider>
          <ApprovalCard card={card} />
        </RealtimeProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    await router.load();
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <RouterProvider router={router as never} />
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  const CARD: Row = {
    id: 'a-1',
    subject_type: 'spec_version',
    subject_id: 'v-5',
    project_slug: 'clemvion',
    spec_key: 'SPC-CWC-007',
    spec_title: '웹챗 위젯 임베드',
    version_no: 5,
    requested_by: '지민',
    waiting_seconds: 120,
    can_approve: true,
    content_hash: 'h5',
    cr_id: 'cr-1',
    cr_key: 'CLV-C-7QF3K2',
    cr_status: 'in_review',
    cr_base_version_no: 4,
    cr_delta: {
      added: 1,
      modified: 1,
      removed: 1,
      items: [
        { kind: 'added', ref: 'REQ-CWC-003', statement: '재시도 배너를 보인다' },
        { kind: 'modified', ref: 'REQ-CWC-001', statement: '30건을 복원한다' },
        { kind: 'removed', ref: 'REQ-CWC-002', statement: '레거시 모드로 그린다' },
      ],
    },
    cr_impact: {
      tasks: 3,
      claims: 1,
      affected_claims: 1,
      referencing: 1,
      suggestions: 3,
      cancel_suggestions: 1,
    },
    // 아무도 고르지 않았다 — 수는 서버가 센 기본값이다(2026-10-16 사람 결정 · REQ-API-351)
    cr_planned: { chosen: false, derive: 1, reverify: 1, cancel: 0 },
  };

  it('변경 요청 배지 · CR 키 · 델타의 수와 원문 · 영향 · 고를 곳을 보인다', async () => {
    await renderCard(CARD);
    const card = screen.getByTestId('approval-card');
    expect(card.textContent).toContain('변경 요청');
    expect(within(card).getByTestId('cr-link').textContent).toContain('CLV-C-7QF3K2');
    expect(within(card).getByTestId('cr-link').getAttribute('href')).toBe(
      '/p/clemvion/crs/CLV-C-7QF3K2',
    );
    expect(within(card).getByTestId('cr-delta-counts').textContent).toContain(
      '추가 1 · 변경 1 · 삭제 1',
    );
    expect(within(card).getByTestId('cr-delta-items').textContent).toContain(
      '재시도 배너를 보인다',
    );
    expect(within(card).getByTestId('cr-impact-line').textContent).toContain(
      '영향: 파생 작업 3 · 진행 중 클레임 1 · 참조 문서 1',
    );
    // 아무도 고르지 않았으면 이 카드의 [승인]이 기본값을 적용한다 — 무엇이 만들어지는지 미리 적는다
    const line = within(card).getByTestId('cr-planned-line');
    expect(line.getAttribute('data-source')).toBe('default');
    expect(line.textContent).toContain(
      '승인하면 기본값대로 파생 작업 1건 · 재검증 작업 1건을 만듭니다.',
    );
    // 보관은 기본값에 들지 않는다 — 고르려면 변경 요청 화면으로 간다
    expect(line.textContent).toContain('보관 제안 1건은 변경 요청 화면에서 고릅니다.');
    // 결재 단추는 그대로 한 벌이다 — 같은 결재를 두 카드로 만들지 않는다
    expect(screen.getAllByTestId('approval-card')).toHaveLength(1);
  });

  it('고른 것이 있으면 승인하면 골라 둔 대로 무엇을 하는지 말한다', async () => {
    await renderCard({ ...CARD, cr_planned: { chosen: true, derive: 1, reverify: 1, cancel: 1 } });
    const line = screen.getByTestId('cr-planned-line');
    expect(line.getAttribute('data-source')).toBe('chosen');
    expect(line.textContent).toContain('승인하면 골라 둔 대로 작업 2건을 만들고 1건을 보관합니다.');
    expect(line.textContent).not.toContain('보관 제안');
  });

  it('빈 선택을 골라 두었으면 승인해도 만들지 않는다고 말한다 — 기본값을 말하지 않는다', async () => {
    await renderCard({ ...CARD, cr_planned: { chosen: true, derive: 0, reverify: 0, cancel: 0 } });
    expect(screen.getByTestId('cr-planned-line').textContent).toContain(
      '아무것도 하지 않기로 골라 두었습니다. 승인해도 작업을 만들지 않습니다.',
    );
  });

  it('고르지 않았고 기본값으로 만들 것도 보관 제안도 없으면 할 일이 없다고 말한다', async () => {
    await renderCard({
      ...CARD,
      cr_impact: { ...(CARD['cr_impact'] as Row), suggestions: 0, cancel_suggestions: 0 },
      cr_planned: { chosen: false, derive: 0, reverify: 0, cancel: 0 },
    });
    expect(screen.getByTestId('cr-planned-line').textContent).toContain(
      '승인과 함께 할 일은 없습니다.',
    );
  });

  it('CR 이 아닌 스펙 결재 카드는 예전 그대로다', async () => {
    const { cr_key: _k, cr_delta: _d, cr_impact: _i, cr_planned: _p, ...plain } = CARD;
    await renderCard(plain);
    expect(screen.queryByTestId('cr-summary')).toBeNull();
  });
});
