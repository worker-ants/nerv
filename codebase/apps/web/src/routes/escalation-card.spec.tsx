// 에스컬레이션 카드 · 유형 칸 · 리뷰 센터의 [CR로 보내기] — REQ-WEB-324 ~ 326 (2026-10-16 · 사람 결정 D3 · E19-S02 · S03)
//
// 발견을 사람에게 넘기면 받은 요청에 카드가 선다. 카드는 원문(발견 · 근거 · 커밋)과 사유 · 기다리는 세션을 보이고, 결정은 그
// 발견의 처분이다(고칠 것 · 유예 · 기각 — 근거 필수). 사유가 spec 이면 변경 요청으로 보낼 수 있다. 변경 요청으로 보낸 카드는
// "구현이 스펙을 바꿨다" 를 알리고, 초안이 아직 승인본과 같으면 검토를 요청할 수 없다는 것을 보인다.

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
import { EscalationCard } from '../features/inbox/escalation-card.js';
import { FindingRail } from '../features/review-center/finding-rail.js';
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

let posts: { path: string; body: unknown }[];
let gets: string[];
let inboxItems: Row[];

const HEAD = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

const ESCALATION: Row = {
  id: 'a-esc',
  subject_type: 'escalation',
  kind: 'escalation',
  subject_id: 'r-1',
  project_slug: 'clemvion',
  project_name: 'Clemvion',
  org_slug: 'default',
  requested_by: '민우',
  requested_hostname: 'linux-ci-01',
  requested_agent_type: 'codex',
  session_waiting: true,
  waiting_seconds: 300,
  can_approve: true,
  can_bulk_approve: false,
  bulk_block_reason: 'bulk_escalation',
  escalate_reason: 'user-decision',
  escalation_blocking: true,
  escalation_rationale: '공개 API 를 바꾸는 일이라 내가 정하지 않는다',
  finding_id: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001',
  finding_title: '응답 필드 이름이 스펙과 다르다',
  finding_severity: 'warning',
  finding_detail_md: '구현은 items 를 돌려주고 스펙은 rows 라고 적는다',
  finding_file_path: 'src/api.ts',
  finding_line_start: 42,
  finding_tags: [],
  escalation_commit: HEAD,
  escalation_branch: 'feat/esc',
  finding_task_key: 'CLV-T-AAAA01',
  finding_task_assignee: '유나',
  decision: null,
};

beforeEach(() => {
  localStorage.clear();
  setDecisionGraceForTesting(0);
  posts = [];
  gets = [];
  inboxItems = [ESCALATION];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const full = String(url).replace(/^.*\/api\/v1/, '');
      const path = full.split('?')[0]!;
      if (init?.method === 'POST') {
        posts.push({ path, body: init.body === undefined ? null : JSON.parse(init.body) });
        return ok({ change_request: { key: 'CLV-C-7QF3K2' }, decision: 'reject' });
      }
      gets.push(full);
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
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
      if (path === '/approvals') {
        return ok({
          items: inboxItems,
          next_cursor: null,
          total: inboxItems.length,
          actionable_total: inboxItems.length,
          kind_counts: {
            spec: 0,
            cr: 1,
            plan: 0,
            question: 2,
            escalation: 3,
            finding: 0,
            gate_bypass: 0,
          },
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

async function renderAlone(node: React.JSX.Element): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => <RealtimeProvider>{node}</RealtimeProvider>,
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

describe('에스컬레이션 카드 — 원문 · 사유 · 기다리는 세션 (REQ-WEB-325)', () => {
  it('넘긴 발견의 원문과 근거 · 커밋 · 위치 · 작업 · 기다리는 세션을 보인다', async () => {
    await renderAlone(<EscalationCard card={ESCALATION} />);
    const card = screen.getByTestId('escalation-card');
    expect(card.getAttribute('data-kind')).toBe('escalation');
    expect(card.textContent).toContain('응답 필드 이름이 스펙과 다르다');
    expect(screen.getByTestId('escalation-reason').textContent).toContain('제품 결정');
    expect(screen.getByTestId('escalation-waiting').textContent).toContain(
      '세션이 이 결정을 기다리는 중',
    );
    const original = screen.getByTestId('escalation-original');
    expect(original.textContent).toContain('구현은 items 를 돌려주고 스펙은 rows 라고 적는다');
    expect(original.textContent).toContain('src/api.ts:42');
    expect(screen.getByTestId('escalation-commit').textContent).toContain(HEAD.slice(0, 12));
    expect(original.textContent).toContain('작업 CLV-T-AAAA01 · 담당 유나');
    expect(screen.getByTestId('escalation-rationale').textContent).toContain(
      '공개 API 를 바꾸는 일이라',
    );
    expect(screen.getByTestId('escalation-finding-link').getAttribute('href')).toBe(
      '/p/clemvion/reviews?finding=0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001',
    );
    // 사유가 spec 이 아니면 변경 요청으로 보내는 길은 없다
    expect(screen.queryByTestId('escalation-to-cr')).toBeNull();
  });

  it('결정은 그 발견의 처분이다 — 근거 없이는 보내지 않고, 고른 처분이 그대로 간다', async () => {
    await renderAlone(<EscalationCard card={ESCALATION} />);
    fireEvent.click(screen.getByTestId('escalation-dismissed'));
    expect(screen.getByTestId('escalation-missing').textContent).toContain(
      '근거를 적어야 결정할 수 있습니다.',
    );
    expect(posts).toHaveLength(0);
    fireEvent.change(screen.getByTestId('escalation-comment'), {
      target: { value: '  rows 가 계약이다 — 구현을 고친다  ' },
    });
    fireEvent.click(screen.getByTestId('escalation-fix'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: '/approvals/a-esc/decision',
      body: { decision: 'approve', resolution: 'fix', comment: 'rows 가 계약이다 — 구현을 고친다' },
    });
  });

  it('누른 처분은 다른 카드처럼 5초 들고 있다가 보낸다 — 그 사이 [취소]로 무른다 (REQ-WEB-237)', async () => {
    setDecisionGraceForTesting(60_000);
    await renderAlone(<EscalationCard card={ESCALATION} active />);
    fireEvent.change(screen.getByTestId('escalation-comment'), {
      target: { value: '이번 릴리스 범위 밖이다' },
    });
    fireEvent.click(screen.getByTestId('escalation-wont_fix'));
    const strip = screen.getByTestId('decision-grace');
    expect(strip.getAttribute('data-state')).toBe('held');
    expect(strip.textContent).toContain('유예');
    expect(screen.queryByTestId('escalation-fix')).toBeNull();
    expect(posts).toHaveLength(0);
    // `z` 는 강조된 카드에서 무른다 — 단추와 같다
    fireEvent.keyDown(window, { key: 'z' });
    await waitFor(() => expect(screen.queryByTestId('decision-grace')).toBeNull());
    expect(screen.getByTestId('escalation-fix')).toBeTruthy();
    fireEvent.click(screen.getByTestId('escalation-dismissed'));
    fireEvent.click(screen.getByTestId('decision-cancel'));
    await waitFor(() => expect(screen.queryByTestId('decision-grace')).toBeNull());
    expect(posts).toHaveLength(0);
  });

  it('사유가 spec 이고 spec_drift 발견이면 변경 요청으로 보낸다 — 태그가 없으면 까닭과 함께 잠긴다', async () => {
    await renderAlone(
      <EscalationCard
        card={{ ...ESCALATION, escalate_reason: 'spec', finding_tags: ['spec_drift'] }}
      />,
    );
    fireEvent.click(screen.getByTestId('escalation-to-cr'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe(
      '/projects/clemvion/findings/0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001/change-request',
    );
    cleanup();
    await renderAlone(<EscalationCard card={{ ...ESCALATION, escalate_reason: 'spec' }} />);
    const locked = screen.getByTestId('escalation-to-cr');
    expect(
      locked.getAttribute('aria-disabled') ?? String(locked.hasAttribute('disabled')),
    ).not.toBe('false');
  });

  it('처리됨 카드는 무엇으로 정했는지와 남긴 근거를 보이고 단추가 없다', async () => {
    await renderAlone(
      <EscalationCard
        card={{
          ...ESCALATION,
          decision: 'reject',
          decided_at: new Date().toISOString(),
          escalation_resolution: 'wont_fix',
          comment_md: '다음 분기에 본다',
        }}
      />,
    );
    expect(screen.getByTestId('escalation-decided').textContent).toContain('유예');
    expect(screen.getByTestId('decision-note').textContent).toContain('다음 분기에 본다');
    expect(screen.queryByTestId('escalation-fix')).toBeNull();
  });
});

describe('변경 요청으로 보낸 카드 — 구현이 스펙을 바꿨다 (REQ-WEB-324)', () => {
  const DRIFT: Row = {
    ...ESCALATION,
    id: 'a-drift',
    kind: 'cr',
    escalate_reason: 'spec',
    session_waiting: false,
    escalation_blocking: false,
    escalation_cr_key: 'CLV-C-7QF3K2',
    escalation_cr_status: 'open',
    escalation_cr_unchanged: true,
    escalation_cr_spec_key: 'SPC-CWC-007',
    escalation_cr_version_no: 5,
    escalation_cr_base_version_no: 4,
    cr_findings: [
      {
        id: 'f-1',
        title: '응답 필드 이름이 스펙과 다르다',
        severity: 'warning',
        commit_sha: HEAD,
      },
    ],
  };

  it('CR 키 · 버전 · 초안 상태 · 출처 발견과 커밋을 보이고, 초안이 승인본과 같으면 검토를 요청할 수 없다고 말한다', async () => {
    await renderAlone(<EscalationCard card={DRIFT} />);
    const card = screen.getByTestId('escalation-card');
    expect(card.getAttribute('data-kind')).toBe('cr');
    expect(card.textContent).toContain('구현이 스펙을 바꿨습니다');
    expect(screen.getByTestId('escalation-cr-link').getAttribute('href')).toBe(
      '/p/clemvion/crs/CLV-C-7QF3K2',
    );
    expect(screen.getByTestId('escalation-cr-body').textContent).toContain('SPC-CWC-007 v4 → v5');
    expect(screen.getByTestId('escalation-cr-state').textContent).toContain(
      '초안이 아직 승인본과 같아 검토를 요청할 수 없습니다.',
    );
    expect(screen.getByTestId('escalation-cr-edit').getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-CWC-007?v=5',
    );
    expect(screen.getByTestId('drift-findings').textContent).toContain(HEAD.slice(0, 12));
    // 처분 단추는 없다 — 결정은 그 CR 의 결말이다
    expect(screen.queryByTestId('escalation-fix')).toBeNull();
  });

  it('변경 요청 거절은 사유가 필수이고 그 CR 의 거절로 간다', async () => {
    await renderAlone(<EscalationCard card={DRIFT} />);
    fireEvent.click(screen.getByTestId('escalation-cr-reject'));
    expect(posts).toHaveLength(0);
    fireEvent.change(screen.getByTestId('escalation-comment'), {
      target: { value: '스펙의 rows 가 계약이다' },
    });
    fireEvent.click(screen.getByTestId('escalation-cr-reject'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: '/projects/clemvion/crs/CLV-C-7QF3K2/reject',
      body: { reason: '스펙의 rows 가 계약이다' },
    });
  });

  it('스펙 결재의 CR 카드도 출처 발견 · 커밋을 보인다', async () => {
    await renderAlone(
      <ApprovalCard
        card={{
          id: 'a-1',
          subject_type: 'spec_version',
          project_slug: 'clemvion',
          spec_key: 'SPC-CWC-007',
          version_no: 5,
          requested_by: '지민',
          waiting_seconds: 60,
          can_approve: true,
          cr_key: 'CLV-C-7QF3K2',
          cr_base_version_no: 4,
          cr_origin: 'spec_drift',
          cr_findings: DRIFT['cr_findings'],
        }}
      />,
    );
    const drift = screen.getByTestId('drift-findings');
    expect(drift.textContent).toContain('구현에서 거슬러 온 변경 요청입니다');
    expect(drift.textContent).toContain('응답 필드 이름이 스펙과 다르다');
  });
});

describe('받은 요청의 유형 칸 (REQ-WEB-326)', () => {
  it('유형마다 대기 수를 보이고, 고르면 그 유형만 서버에 묻는다 — 주소에 남는다', async () => {
    renderAt('/inbox');
    const filter = await screen.findByTestId('inbox-kind-filter');
    expect((await within(filter).findByTestId('inbox-kind-count-escalation')).textContent).toBe(
      '3',
    );
    expect(within(filter).getByTestId('inbox-kind-count-question').textContent).toBe('2');
    // 에스컬레이션 카드는 따로 그린다 — 일괄에 넣는 칸이 없다
    expect(await screen.findByTestId('escalation-card')).toBeTruthy();
    expect(screen.queryByTestId('bulk-select')).toBeNull();
    fireEvent.click(within(filter).getByTestId('inbox-kind-escalation'));
    await waitFor(() =>
      expect(gets.some((g) => g.startsWith('/approvals?') && g.includes('kind=escalation'))).toBe(
        true,
      ),
    );
    expect(
      within(screen.getByTestId('inbox-kind-filter'))
        .getByTestId('inbox-kind-escalation')
        .getAttribute('aria-current'),
    ).toBe('true');
  });

  it('주소의 유형으로 열면 그 유형으로 묻고, 어휘 밖의 값은 버린다', async () => {
    renderAt('/inbox?kind=cr');
    await screen.findByTestId('inbox-kind-filter');
    await waitFor(() => expect(gets.some((g) => g.includes('kind=cr'))).toBe(true));
    cleanup();
    gets = [];
    renderAt('/inbox?kind=phase2');
    await screen.findByTestId('inbox-kind-filter');
    await waitFor(() => expect(gets.some((g) => g.startsWith('/approvals?'))).toBe(true));
    expect(gets.filter((g) => g.startsWith('/approvals?') && g.includes('kind='))).toEqual([]);
  });
});

describe('리뷰 센터의 [CR로 보내기] (REQ-WEB-324)', () => {
  const FINDING: Row = {
    id: 'f-1',
    title: '응답 필드 이름이 스펙과 다르다',
    severity: 'warning',
    status: 'open',
    tags: ['spec_drift'],
    branch: 'feat/esc',
    head_sha: HEAD,
  };

  it('spec_drift 발견이면 planner · admin 이 보낸다 — 아니면 까닭과 함께 잠긴다', async () => {
    await renderAlone(
      <FindingRail
        finding={FINDING}
        projectSlug="clemvion"
        canResolve
        canComment
        canPromote
        canSendToCr
      />,
    );
    fireEvent.click(screen.getByTestId('rail-send-to-cr'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe('/projects/clemvion/findings/f-1/change-request');
    cleanup();
    await renderAlone(
      <FindingRail
        finding={FINDING}
        projectSlug="clemvion"
        canResolve
        canComment
        canPromote
        canSendToCr={false}
      />,
    );
    fireEvent.click(screen.getByTestId('rail-send-to-cr'));
    expect(posts).toHaveLength(1);
  });

  it('열린 CR 에 묶였으면 그 CR 로 가는 링크다 · 태그가 없으면 단추가 없다 · 넘긴 처분이면 사유를 보인다', async () => {
    await renderAlone(
      <FindingRail
        finding={{
          ...FINDING,
          change_request_key: 'CLV-C-7QF3K2',
          change_request_status: 'open',
        }}
        projectSlug="clemvion"
        canResolve
        canComment
        canPromote
        canSendToCr
      />,
    );
    expect(screen.getByTestId('rail-cr-link').getAttribute('href')).toBe(
      '/p/clemvion/crs/CLV-C-7QF3K2',
    );
    expect(screen.queryByTestId('rail-send-to-cr')).toBeNull();
    cleanup();
    await renderAlone(
      <FindingRail
        finding={{
          ...FINDING,
          tags: [],
          resolution_kind: 'escalated',
          escalate_reason: 'infra',
          escalation_blocking: true,
        }}
        projectSlug="clemvion"
        canResolve
        canComment
        canPromote
        canSendToCr
      />,
    );
    expect(screen.queryByTestId('rail-to-cr')).toBeNull();
    expect(screen.getByTestId('rail-escalated').textContent).toContain('에스컬레이션 · 인프라');
    expect(screen.getByTestId('rail-escalated').textContent).toContain('세션이 결정을 기다립니다');
  });
});
