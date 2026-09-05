// E05-S03 — 읽기 전용 세션 보드(S5 축소판).
//
//   REQ-WEB-019  카드는 신원 3요소·하트비트 상대 시각·리스 잔여·diff 를 표기하고,
//                hostname 이 없는 세션은 렌더링하지 않는다
//   REQ-WEB-020  stale 카드는 "무활동 임계 30:00 초과 → 자동 전이"를 표시한다
//   screens.md §1.5  로딩은 골격, 빈 상태는 막다른 길 금지

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RealtimeProvider } from '../../lib/realtime.js';
import { SessionBoard } from './session-board.js';
import { SessionCard } from './session-card.js';
import type { SessionCard as Card } from './types.js';

afterEach(cleanup);

const base: Card = {
  id: 's-1',
  user_name: '도현',
  hostname: 'mac-02',
  agent_type: 'claude-code',
  state: 'active',
  branch: 'feature/widget-v2',
  diff_added: 218,
  diff_removed: 34,
  last_heartbeat_at: '2026-08-22T11:59:48Z',
  started_at: '2026-08-22T09:29:00Z',
  task_id: 't-1',
  task_key: 'CLV-T-1KTDCK',
  task_title: '위젯 상태별 렌더링',
  claim_id: 'c-1',
  lease_remaining_seconds: 480,
  scope_spec_ids: ['spc-1'],
  scope_file_globs: ['codebase/frontend/src/widget/**'],
};

const NOW = new Date('2026-08-22T12:00:00Z').getTime();

/** 카드도 로케일 안에서 산다 — 상태 배지·하트비트 문구가 카탈로그에서 온다 */
function render(ui: React.ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(<LocaleProvider locale="ko">{ui}</LocaleProvider>);
}

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

// 보드는 이제 `useSessions` 를 쓴다 — 폴링 판정이 실시간 상태를 보므로 그 안에서 산다.
// 예전에는 보드가 자기 쿼리를 따로 들고 있었고, 그래서 페이지의 쿼리와 **둘**이었다.
/**
 * 보드는 **라우터 안에서 산다** — 카드가 세션 상세로 가는 링크를 갖기 때문이다
 * (2026-09-03 · WEB-14: 그 링크가 없어 어느 폭에서도 상세로 갈 길이 없었다).
 */
async function renderBoard(
  props: Partial<React.ComponentProps<typeof SessionBoard>> = {},
): Promise<void> {
  const rootRoute = createRootRoute({
    component: () => (
      <RealtimeProvider>
        <SessionBoard projectSlug="clemvion" projectId="p-1" {...props} />
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

describe('SessionCard — REQ-WEB-019 필수 표기', () => {
  it('신원 3요소를 전부 적는다 — 누구의 어느 머신인가가 이 화면의 존재 이유다', async () => {
    render(<SessionCard card={base} now={NOW} />);
    expect(screen.getByText(/도현/)).toBeDefined();
    expect(screen.getByText('mac-02')).toBeDefined();
    expect(screen.getByText(/claude-code/)).toBeDefined();
  });

  it('하트비트는 상대 시각, 리스는 잔여, diff 는 +N −M', async () => {
    render(<SessionCard card={base} now={NOW} />);
    expect(screen.getByText('12초 전')).toBeDefined();
    expect(screen.getByText('08:00')).toBeDefined();
    expect(screen.getByText('+218 −34')).toBeDefined();
  });

  it('클레임한 Task 와 선언 scope 를 보여준다 — 겹침 경고를 읽으려면 필요하다', async () => {
    render(<SessionCard card={base} now={NOW} />);
    expect(screen.getByText('CLV-T-1KTDCK')).toBeDefined();
    expect(screen.getByText('codebase/frontend/src/widget/**')).toBeDefined();
  });

  it('hostname 이 없으면 렌더링하지 않는다 (REQ-WEB-019)', async () => {
    const { container } = render(<SessionCard card={{ ...base, hostname: '' }} now={NOW} />);
    expect(container.querySelector('[data-testid="session-card"]')).toBeNull();
  });

  it('stale 카드는 왜 그렇게 됐는지까지 적는다 (REQ-WEB-020 · D-13)', async () => {
    render(<SessionCard card={{ ...base, state: 'stale' }} now={NOW} />);
    expect(screen.getByText(/무활동 임계 30:00 초과/)).toBeDefined();
    // 상태는 색만이 아니라 라벨로도 나온다(REQ-WEB-033)
    expect(screen.getByText('무응답')).toBeDefined();
  });

  it('상태마다 §4.2 매핑의 토큰을 쓴다 — 엔티티마다 색을 새로 정하지 않는다', async () => {
    const { container } = render(
      <SessionCard card={{ ...base, state: 'awaiting_input' }} now={NOW} />,
    );
    expect(container.innerHTML).toContain('bg-status-waiting-soft');
  });
});

describe('SessionBoard — 상태 3종 (screens.md §1.5)', () => {
  it('로딩은 골격으로 — 스피너 단독 금지', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    await renderBoard();
    expect(screen.getByTestId('session-board-skeleton')).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('데이터가 있으면 카드와 요약 스트립을 보여준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ items: [base], summary: { active: 1 }, next_cursor: null }),
      })),
    );
    await renderBoard();

    await waitFor(() => expect(screen.getByTestId('session-card')).toBeDefined());
    // 스트립은 라벨과 숫자를 **따로** 그린다 — 숫자가 커야 먼저 읽히기 때문이다.
    // 배지 시절의 `'활동 중 1'` 한 덩어리가 아니다(2026-08-23 재검토).
    const strip = within(screen.getByTestId('session-summary'));
    expect(strip.getByText('활동 중')).toBeDefined();
    expect(strip.getByText('1')).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('빈 상태에 막다른 길을 두지 않는다 — 다음 행동을 알려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ items: [], summary: {}, next_cursor: null }),
      })),
    );
    await renderBoard();

    await waitFor(() => expect(screen.getByText('실행 중인 세션이 없습니다.')).toBeDefined());
    expect(screen.getByText(/nerv_bootstrap/)).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('에러는 인라인 카드 + 다시 시도 — 전역 토스트로 중복 알리지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ ok: false, code: null, message: 'boom', details: {} }),
      })),
    );
    await renderBoard();

    await waitFor(() => expect(screen.getByText('세션을 불러오지 못했습니다.')).toBeDefined());
    expect(screen.getByText('다시 시도')).toBeDefined();
    vi.unstubAllGlobals();
  });
});

// 2026-08-30 사람 요청 — 스트립의 숫자는 보이는데 눌러도 아무 일이 없었다.
// "종료 12건" 을 보고 그 열둘이 무엇인지 알려면 목록 전체를 훑어야 했다.
describe('스트립은 필터다 (REQ-WEB-116)', () => {
  const SUMMARY = { active: 2, complete: 12, stale: 3 };

  function stubList(items: Card[]): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        urls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ items, summary: SUMMARY, next_cursor: null }),
        };
      }),
    );
    return urls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('상태를 고르면 서버에 그 상태만 묻는다 — 200건에서 잘리므로 화면에서 거르지 않는다', async () => {
    const urls = stubList([base]);
    const onStateChange = vi.fn();
    await renderBoard({ onStateChange });
    await screen.findByTestId('session-summary');

    fireEvent.click(screen.getByTestId('session-filter-complete'));
    expect(onStateChange).toHaveBeenCalledWith('complete');

    // 부모가 상태를 쥔다 — 목록과 레일이 같은 조각을 봐야 하기 때문이다
    cleanup();
    await renderBoard({ state: 'complete', onStateChange });
    await waitFor(() => expect(urls.some((u) => u.includes('state=complete'))).toBe(true));
  });

  it('고른 것을 다시 누르면 풀린다 — 켜는 길과 끄는 길이 같은 자리다', async () => {
    stubList([base]);
    const onStateChange = vi.fn();
    await renderBoard({ state: 'stale', onStateChange });
    await screen.findByTestId('session-summary');

    fireEvent.click(screen.getByTestId('session-filter-stale'));
    expect(onStateChange).toHaveBeenCalledWith(null);
  });

  it('숫자는 필터를 따라가지 않는다 — 스트립은 전체 그림이고 목록이 그 조각이다', async () => {
    stubList([base]);
    await renderBoard({ state: 'complete', onStateChange: vi.fn() });
    const strip = await screen.findByTestId('session-summary');
    expect(within(strip).getByTestId('session-filter-complete').textContent).toContain('12');
  });

  it('걸러서 비었으면 "세션이 없다" 고 하지 않는다 — 사람은 필터를 켠 것을 잊는다', async () => {
    stubList([]);
    await renderBoard({ state: 'stale', onStateChange: vi.fn() });
    await waitFor(() => expect(screen.queryByTestId('session-summary')).not.toBeNull());
    // 부트스트랩 안내가 아니라 "그 상태가 없다" + 전부 보기다
    expect(screen.queryByText(/nerv_bootstrap/)).toBeNull();
    expect(screen.getByText('전부 보기')).toBeDefined();
  });

  it('고를 수 없는 화면에서는 단추처럼 굴지 않는다 — 개요 카드의 스트립이 그 자리다', async () => {
    stubList([base]);
    await renderBoard();
    await screen.findByTestId('session-summary');
    expect(screen.getByTestId('session-filter-active').hasAttribute('disabled')).toBe(true);
  });
});

// 2026-09-05 사람 요청 — 스트립에 **있는 상태만** 보였다(실측: sudoku 는 종료·무응답 둘뿐이라
// 나머지 넷은 화면에 아예 없었다). 그러면 폭과 칸이 프로젝트마다 달라 눈이 자리를 다시 찾아야
// 하고, 무엇보다 "오류 0건" 과 "오류라는 상태가 없음" 을 구별할 수 없다.
describe('0 인 상태도 자리를 지킨다 (REQ-WEB-139)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(summary: Record<string, number>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ items: [base], summary, next_cursor: null }),
      })),
    );
  }

  it('여섯 상태가 모두 보인다 — 응답에 없는 것은 0 으로', async () => {
    stub({ complete: 27, stale: 20 });
    await renderBoard({ onStateChange: vi.fn() });
    const strip = within(await screen.findByTestId('session-summary'));
    for (const label of ['대기', '활동 중', '응답 대기', '종료', '오류', '무응답']) {
      expect(strip.getByText(label)).toBeDefined();
    }
    expect(strip.getByTestId('session-filter-error').textContent).toContain('0');
  });

  it('어휘 순서로 앉는다 — GROUP BY 는 순서를 약속하지 않는다', async () => {
    stub({ stale: 20, complete: 27 });
    await renderBoard({ onStateChange: vi.fn() });
    const strip = await screen.findByTestId('session-summary');
    const order = [...strip.querySelectorAll('[data-testid^="session-filter-"]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(order).toEqual([
      'session-filter-pending',
      'session-filter-active',
      'session-filter-awaiting_input',
      'session-filter-complete',
      'session-filter-error',
      'session-filter-stale',
    ]);
  });

  it('0 인 칸은 눌리지 않는다 — 눌러도 빈 목록인 단추는 두지 않는다', async () => {
    stub({ complete: 27, stale: 20 });
    await renderBoard({ onStateChange: vi.fn() });
    await screen.findByTestId('session-summary');
    expect(screen.getByTestId('session-filter-error').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('session-filter-complete').hasAttribute('disabled')).toBe(false);
  });

  it('어휘 밖의 값이 와도 사라지지 않는다 — 조용히 없어지는 칸을 만들지 않는다', async () => {
    stub({ complete: 1, hibernating: 2 });
    await renderBoard({ onStateChange: vi.fn() });
    const strip = within(await screen.findByTestId('session-summary'));
    expect(strip.getByTestId('session-filter-hibernating').textContent).toContain('2');
  });
});
