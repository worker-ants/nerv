// 받은 요청의 수는 내가 누를 수 있는 것이다 — REQ-WEB-217 · REQ-API-184 (2026-09-25 · UI/UX 검토 P10a)
//
// 헤더 배지·홈의 인사("결정 3건이 밀려 있어요")·받은 요청 머리가 `total` 을 쓰는 동안, 그 수에는
// **내가 승인할 수 없는 카드**가 섞였다 — 내가 요청한 것 · 내가 쓴 초안 · 내 에이전트가 올린 스펙.
// 그 카드는 요청 시각 순으로 목록 한가운데 끼어 승인 단추가 잠긴 채 "다른 승인자가 처리해야
// 합니다" 라고 말했고, 할 수 있는 것을 다 해도 배지는 0 이 되지 않았다(2026-09-24 사람 결정 D2).

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

type Row = Record<string, unknown>;

const base = {
  project_slug: 'clemvion',
  requested_by: '하나',
  requested_at: '2026-09-24T00:00:00Z',
  waiting_seconds: 600,
  decision: null,
  approvals_required: 1,
};

/** 누를 수 있는 셋 — 결재 둘과 질문 하나 */
const OPEN: Row[] = [
  {
    ...base,
    id: 'ap-1',
    subject_type: 'spec_version',
    spec_key: 'SPC-OPEN-1',
    spec_title: '열린 문서',
    can_approve: true,
    can_bulk_approve: true,
  },
  {
    ...base,
    id: 'ap-2',
    subject_type: 'plan',
    task_key: 'CLV-T-2',
    task_title: '열린 플랜',
    can_approve: true,
    can_bulk_approve: true,
  },
  { ...base, id: 'q-1', subject_type: 'question', title: '어느 쪽으로 갈까' },
];

/** 잠긴 둘 — 서버가 뒤로 보낸다(REQ-API-184) */
const LOCKED: Row[] = [
  {
    ...base,
    id: 'ap-8',
    subject_type: 'spec_version',
    spec_key: 'SPC-MINE-8',
    spec_title: '내가 올린 문서',
    can_approve: false,
    can_approve_reason: 'self_requested',
    can_bulk_approve: false,
  },
  {
    ...base,
    id: 'ap-9',
    subject_type: 'spec_version',
    spec_key: 'SPC-MINE-9',
    spec_title: '내가 쓴 초안',
    can_approve: false,
    can_approve_reason: 'author',
    can_bulk_approve: false,
  },
];

let pending: { items: Row[]; next_cursor: string | null; total: number; actionable_total: number };

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  pending = { items: [...OPEN, ...LOCKED], next_cursor: null, total: 5, actionable_total: 3 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/approvals?state=pending')) {
        return { ok: true, status: 200, json: async () => pending };
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
          immediate: 0,
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

const cardCount = (): number => screen.queryAllByTestId('approval-card').length;

describe('받은 요청 — 수는 누를 수 있는 것이다 (REQ-WEB-217)', () => {
  it('헤더 배지와 머리의 수가 누를 수 있는 수다 — 잠긴 카드는 세지 않는다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(cardCount()).toBe(3));
    expect(screen.getByText('대기 3건')).toBeDefined();
    expect(screen.getByTestId('inbox-badge').textContent).toBe('3');
  });

  it('잠긴 카드는 끝의 접힌 묶음이다 — 펴면 이유와 함께 선다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(cardCount()).toBe(3));
    const toggle = screen.getByTestId('inbox-locked-toggle');
    expect(toggle.textContent).toContain('다른 사람의 결정을 기다리는 것 2건');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('내가 올린 문서')).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() => expect(cardCount()).toBe(5));
    // 잠긴 이유는 카드마다 그대로 적힌다(REQ-WEB-145) — 묶음은 순서를 정할 뿐이다
    expect(screen.getByText('내가 올린 문서')).toBeDefined();
    expect(screen.getByTestId('inbox-locked').textContent).toContain('요청을 취소하려면');
  });

  it('찾아온 카드가 묶음 안이면 묶음을 편다 — `?focus=` 가 닿는다', async () => {
    renderAt('/inbox?focus=ap-9');
    await waitFor(() => expect(cardCount()).toBe(5));
    expect(screen.getByTestId('inbox-locked-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('focus-missing')).toBeNull();
  });

  it('잠긴 구역에 닿은 뒤로는 묶음을 펴야 더 받는다 — 남은 쪽은 모두 잠긴 카드다', async () => {
    pending = {
      items: [...OPEN, LOCKED[0]!],
      next_cursor: 'opaque-2',
      total: 6,
      actionable_total: 3,
    };
    renderAt('/inbox');
    await waitFor(() => expect(cardCount()).toBe(3));
    expect(screen.getByTestId('inbox-locked-toggle').textContent).toContain('3건');
    expect(screen.queryByTestId('inbox-more')).toBeNull();
    fireEvent.click(screen.getByTestId('inbox-locked-toggle'));
    expect(await screen.findByTestId('inbox-more')).toBeDefined();
  });
});

describe('홈 — 인사와 오늘 할 일도 같은 수다 (REQ-WEB-217)', () => {
  it('인사말은 누를 수 있는 수를 말하고, 오늘 할 일에 잠긴 카드가 없다', async () => {
    renderAt('/');
    const strip = await screen.findByTestId('today-strip');
    await waitFor(() => expect(strip.textContent).toContain('열린 문서'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('결정할 일이 3건');
    expect(strip.textContent).not.toContain('내가 올린 문서');
    // 수에서는 뺐지만 사라지지는 않는다 — 남의 결정을 기다리는 것이 따로 선다
    expect(screen.getByTestId('home-others-waiting').textContent).toContain('2건');
  });

  it('누를 것이 없으면 "밀린 결정이 없습니다" 다 — 내가 올린 것만 남아 있어도', async () => {
    pending = { items: LOCKED, next_cursor: null, total: 2, actionable_total: 0 };
    renderAt('/');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
        '기다리는 결정이 없습니다',
      ),
    );
    expect(screen.getByTestId('home-others-waiting').textContent).toContain('2건');
  });
});
