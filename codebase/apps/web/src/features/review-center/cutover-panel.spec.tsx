// S6 컷오버 관측 — 2026-10-16 · 사람 결정 D6 · E21-S03 · REQ-WEB-330
//
// M1 이중화 기간의 판정 불일치율 · 리뷰 제출 실패율을 로드맵 기준(1% 미만 안정 · 5% 이상 또는 제출 실패 2% 이상 롤백)에 견준 서버의
// 상태로 보인다. admin · planner 에게만, 컷오버 전(`git`)이 아닌 프로젝트에서만 그린다. 라우트째로 그린다 — 보이는 조건이 역할과
// 프로젝트 조회에 걸려 있다.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';
import { NERV_EVENT_PHASE2 } from '@nerv/schema';
import { eventTarget } from '../../lib/event-subject.js';
import { percent } from './cutover-panel.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const REPORT = {
  review_sot: 'dual',
  review_sot_since: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  window: {
    since: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    until: new Date().toISOString(),
    days: 3.2,
    observation_days: 14,
    complete: false,
  },
  comparisons: { total: 200, mismatches: 1, rate: 0.005 },
  submissions: { accepted: 99, failed: 1, total: 100, rate: 0.01 },
  status: 'stable',
  reasons: [],
  thresholds: { stable_below_pct: 1, rollback_mismatch_pct: 5, rollback_submit_failure_pct: 2 },
  recent_mismatches: [
    {
      id: 'c-1',
      branch: 'feat/login',
      head_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      local: 'pass',
      server: 'block',
      hook: 'pre-push',
      reason: '강제 리뷰어 셋이 모두 돌았다',
    },
  ],
};

let roles: string[] = ['planner'];
let sot = 'dual';
let report: Record<string, unknown> = REPORT;
let asked: string[] = [];

beforeEach(() => {
  localStorage.clear();
  roles = ['planner'];
  sot = 'dual';
  report = REPORT;
  asked = [];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      asked.push(path);
      const json = path.includes('/gates/reviews/cutover')
        ? report
        : path.includes('/gates/reviews')
          ? { items: [], total: 0 }
          : path.includes('/findings')
            ? { items: [], facets: { severity: {}, status: {}, tag: {} } }
            : path.includes('/me')
              ? {
                  id: 'u-1',
                  display_name: '하나',
                  memberships: [
                    { org_slug: 'nerv', project_slug: 'clemvion', roles, project_id: 'p-1' },
                  ],
                }
              : path.includes('/projects/clemvion')
                ? {
                    id: 'p-1',
                    slug: 'clemvion',
                    key: 'CLV',
                    name: 'clemvion',
                    org_slug: 'nerv',
                    review_sot: sot,
                    review_sot_since: REPORT.review_sot_since,
                  }
                : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderCenter(): void {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/reviews'] }),
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

describe('컷오버 관측 (REQ-WEB-330)', () => {
  it('이중화 기간이면 planner 에게 두 비율 · 상태 · 단계 · 최근 불일치를 보인다', async () => {
    renderCenter();
    const panel = await screen.findByTestId('cutover-panel');
    expect(panel.textContent).toContain('컷오버 관측');
    expect((await screen.findByTestId('cutover-status')).textContent).toContain(
      '안정: 불일치율 1% 미만',
    );
    expect(screen.getByTestId('cutover-stage').textContent).toContain('M1 이중화 · 3일 전부터');
    expect(screen.getByTestId('cutover-stage').textContent).toContain('관측 3일 / 14일');
    expect(screen.getByTestId('cutover-mismatch').textContent).toBe('판정 불일치 1 / 200건 0.50%');
    expect(screen.getByTestId('cutover-submit').textContent).toBe('리뷰 제출 실패 1 / 100건 1.00%');
    const recent = screen.getByTestId('cutover-recent').textContent ?? '';
    expect(recent).toContain('feat/login');
    expect(recent).toContain('a1b2c3d');
    expect(recent).toContain('로컬 통과 · 서버 막음');
    expect(recent).toContain('pre-push');
    expect(recent).toContain('강제 리뷰어 셋이 모두 돌았다');
    // 저장소의 신규 커밋은 CLI 가 센다고 알린다
    expect(panel.textContent).toContain('nerv cutover report');
  });

  it('롤백 기준이면 그 까닭을 함께 보인다', async () => {
    report = {
      ...REPORT,
      status: 'rollback',
      reasons: ['mismatch_rate', 'submit_failure_rate'],
      comparisons: { total: 100, mismatches: 5, rate: 0.05 },
    };
    renderCenter();
    expect((await screen.findByTestId('cutover-status')).textContent).toContain('롤백 기준 도달');
    expect(screen.getByTestId('cutover-reasons').textContent).toBe(
      '불일치율 5% 이상 · 리뷰 제출 실패율 2% 이상',
    );
  });

  it('비교가 없으면 무엇을 기다리는지 말한다', async () => {
    report = {
      ...REPORT,
      status: 'no_data',
      comparisons: { total: 0, mismatches: 0, rate: null },
      recent_mismatches: [],
    };
    renderCenter();
    expect((await screen.findByTestId('cutover-status')).textContent).toContain(
      '아직 비교가 없습니다',
    );
    expect(screen.getByTestId('cutover-mismatch').textContent).toContain('—');
    expect(screen.queryByTestId('cutover-recent')).toBeNull();
  });

  it('developer 에게는 그리지 않고 지표를 부르지도 않는다', async () => {
    roles = ['developer'];
    renderCenter();
    await screen.findByText('게이트 현황');
    await waitFor(() => expect(asked.some((p) => p.includes('/projects/clemvion'))).toBe(true));
    expect(screen.queryByTestId('cutover-panel')).toBeNull();
    expect(asked.some((p) => p.includes('/gates/reviews/cutover'))).toBe(false);
  });

  it('컷오버 전(git) 프로젝트에는 그리지 않는다', async () => {
    sot = 'git';
    renderCenter();
    await screen.findByText('게이트 현황');
    expect(screen.queryByTestId('cutover-panel')).toBeNull();
    expect(asked.some((p) => p.includes('/gates/reviews/cutover'))).toBe(false);
  });

  it('불일치 알림은 리뷰 센터로 간다 — 컷오버 관측이 거기 있다', () => {
    expect(
      eventTarget({
        type: NERV_EVENT_PHASE2.GATE_VERDICT_MISMATCH,
        project_slug: 'clemvion',
        subject_type: 'project',
      }),
    ).toEqual({ to: '/p/clemvion/reviews' });
  });

  it('비율은 소수 둘째 자리 백분율이고 분모가 0 이면 줄표다', () => {
    expect(percent(0.005)).toBe('0.50%');
    expect(percent(1 / 3)).toBe('33.33%');
    expect(percent(null)).toBe('—');
  });
});
