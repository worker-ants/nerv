// 결재 지연 · 만료 · 역할 큐 재검토 지표 (2026-10-15 · 사람 결정 둘 · REQ-WEB-310 · 311)
//
// 기본 큐 결재는 2일이 지나도 알림을 더 보내지 않는다 — 받은 요청 카드와 프로젝트 개요의 "지연" 표시가 그 자리다.
// 7일 동안 결정되지 않은 스펙 결재는 만료되어 초안으로 돌아가고 받은 요청의 만료 탭에 남는다. 개요는 최근 30일
// 결재 가운데 하루를 넘긴 비율을 보이고, 기준(30%)을 넘으면 결재를 특정인에게 맡길지 검토하라고 안내한다.

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

type Row = Record<string, unknown>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let asked: string[];
let flow: Row;
let pending: Row[];
let expired: Row[];

const card = (over: Row): Row => ({
  id: 'a-1',
  subject_type: 'spec_version',
  subject_id: 'sv-1',
  decision: null,
  requested_at: '2026-10-10T00:00:00Z',
  project_slug: 'clemvion',
  project_name: 'Clemvion',
  org_slug: 'nerv',
  org_name: 'NERV',
  requested_by: '지민',
  self_requested: false,
  assignee_role: null,
  spec_key: 'SPC-CHAT',
  spec_title: '웹챗',
  version_no: 3,
  approvals_required: 1,
  approvals_given: 0,
  waiting_seconds: 3 * 86400,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  asked = [];
  Element.prototype.scrollIntoView = vi.fn();
  flow = {
    overdue: 2,
    lag: { window_days: 30, total: 12, late: 5, ratio: 5 / 12, threshold: 0.3, review_due: true },
  };
  pending = [
    card({ id: 'a-1', overdue: true, can_approve: true }),
    card({
      id: 'a-2',
      spec_key: 'SPC-NEW',
      waiting_seconds: 600,
      overdue: false,
      can_approve: true,
    }),
  ];
  expired = [card({ id: 'a-9', expired_at: new Date().toISOString(), assignee_role: 'qa' })];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      asked.push(u);
      const path = u.replace(/^.*\/api\/v1/, '').split('?')[0]!;
      if (path === '/me')
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'nerv', org_name: 'NERV', project_slug: 'clemvion', roles: ['admin'] },
          ],
        });
      if (/^\/orgs\/[^/]+\/projects$/.test(path))
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'Clemvion' }]);
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'Clemvion', org_slug: 'nerv' });
      if (path === '/projects/clemvion/approvals/flow') return ok(flow);
      if (path === '/projects/clemvion/inbox')
        return ok({ items: [], next_cursor: null, total: 0, actionable_total: 0 });
      if (path === '/approvals/scopes')
        return ok({ items: [], total: { pending: 0, actionable: 0 } });
      if (path === '/approvals') {
        const state = new URL(u, 'http://x').searchParams.get('state');
        const items = state === 'expired' ? expired : state === 'decided' ? [] : pending;
        return ok({
          items,
          next_cursor: null,
          total: items.length,
          ...(state === 'pending' ? { actionable_total: items.length } : {}),
        });
      }
      return ok({ items: [], next_cursor: null, total: 0, summary: {}, count: 0, totals: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string): void {
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

describe('받은 요청 — 지연과 만료 (REQ-WEB-310)', () => {
  it('2일을 넘긴 카드에만 "지연" 이 붙는다 — 판정은 서버의 overdue 다', async () => {
    mount('/inbox');
    const cards = await screen.findAllByTestId('approval-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByTestId('overdue').textContent).toBe('지연');
    expect(within(cards[1]!).queryByTestId('overdue')).toBeNull();
  });

  it('만료 탭은 결정 없이 끝난 카드를 만료 시각 · 다시 오는 길과 함께 보이고 결정 단추를 두지 않는다', async () => {
    mount('/inbox?state=expired');
    const [expiredCard] = await screen.findAllByTestId('approval-card');
    await waitFor(() => expect(asked.some((u) => u.includes('state=expired'))).toBe(true));
    expect(screen.getByTestId('inbox-tab-expired').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('만료 1건')).toBeTruthy();
    expect(within(expiredCard!).getByTestId('expired-at').textContent).toMatch(/^만료 · /);
    expect(within(expiredCard!).getByTestId('correction-path').textContent).toContain(
      '7일 동안 결정되지 않아 문서가 초안으로 돌아갔습니다',
    );
    expect(within(expiredCard!).queryByTestId('overdue')).toBeNull();
    expect(within(expiredCard!).queryByTestId('decision-comment')).toBeNull();
    expect(within(expiredCard!).queryByRole('button', { name: /승인/ })).toBeNull();
  });

  it('만료된 것이 없으면 그렇다고 말한다', async () => {
    expired = [];
    mount('/inbox?state=expired');
    expect(await screen.findByText('만료된 요청이 없습니다')).toBeTruthy();
  });
});

describe('프로젝트 개요 — 지연 결재와 역할 큐 재검토 지표 (REQ-WEB-311)', () => {
  it('지연 결재 수는 그 프로젝트로 좁힌 받은 요청으로 가고, 30%를 넘으면 재검토를 안내한다', async () => {
    mount('/p/clemvion');
    const chip = await screen.findByTestId('project-waiting-overdue');
    expect(chip.textContent).toContain('지연 결재 2건');
    expect(chip.getAttribute('href')).toBe('/inbox?org=nerv&project=clemvion');
    const lag = await screen.findByTestId('approval-lag');
    expect(lag.textContent).toContain('최근 30일 결재 12건 가운데 5건(42%)이 하루를 넘겼습니다.');
    expect(within(lag).getByTestId('approval-lag-review').textContent).toContain(
      '30%를 넘었습니다',
    );
  });

  it('기준 이하면 비율만 보이고, 셀 결재가 없으면 그 줄을 두지 않는다', async () => {
    flow = {
      overdue: 0,
      lag: { window_days: 30, total: 10, late: 2, ratio: 0.2, threshold: 0.3, review_due: false },
    };
    mount('/p/clemvion');
    const lag = await screen.findByTestId('approval-lag');
    expect(lag.textContent).toContain('10건 가운데 2건(20%)');
    expect(within(lag).queryByTestId('approval-lag-review')).toBeNull();
    expect(screen.queryByTestId('project-waiting-overdue')).toBeNull();
    cleanup();

    flow = {
      overdue: 0,
      lag: { window_days: 30, total: 0, late: 0, ratio: null, threshold: 0.3, review_due: false },
    };
    mount('/p/clemvion');
    await screen.findByTestId('project-waiting');
    expect(screen.queryByTestId('approval-lag')).toBeNull();
  });
});
