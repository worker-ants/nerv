// E05-S03 — 읽기 전용 세션 보드(S5 축소판).
//
//   REQ-WEB-019  카드는 신원 3요소·하트비트 상대 시각·리스 잔여·diff 를 표기하고,
//                hostname 이 없는 세션은 렌더링하지 않는다
//   REQ-WEB-020  stale 카드는 "무활동 임계 30:00 초과 → 자동 전이"를 표시한다
//   screens.md §1.5  로딩은 골격, 빈 상태는 막다른 길 금지

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('SessionCard — REQ-WEB-019 필수 표기', () => {
  it('신원 3요소를 전부 적는다 — 누구의 어느 머신인가가 이 화면의 존재 이유다', () => {
    render(<SessionCard card={base} now={NOW} />);
    expect(screen.getByText(/도현/)).toBeDefined();
    expect(screen.getByText('mac-02')).toBeDefined();
    expect(screen.getByText(/claude-code/)).toBeDefined();
  });

  it('하트비트는 상대 시각, 리스는 잔여, diff 는 +N −M', () => {
    render(<SessionCard card={base} now={NOW} />);
    expect(screen.getByText('12초 전')).toBeDefined();
    expect(screen.getByText('08:00')).toBeDefined();
    expect(screen.getByText('+218 −34')).toBeDefined();
  });

  it('클레임한 Task 와 선언 scope 를 보여준다 — 겹침 경고를 읽으려면 필요하다', () => {
    render(<SessionCard card={base} now={NOW} />);
    expect(screen.getByText('CLV-T-1KTDCK')).toBeDefined();
    expect(screen.getByText('codebase/frontend/src/widget/**')).toBeDefined();
  });

  it('hostname 이 없으면 렌더링하지 않는다 (REQ-WEB-019)', () => {
    const { container } = render(<SessionCard card={{ ...base, hostname: '' }} now={NOW} />);
    expect(container.querySelector('[data-testid="session-card"]')).toBeNull();
  });

  it('stale 카드는 왜 그렇게 됐는지까지 적는다 (REQ-WEB-020 · D-13)', () => {
    render(<SessionCard card={{ ...base, state: 'stale' }} now={NOW} />);
    expect(screen.getByText(/무활동 임계 30:00 초과/)).toBeDefined();
    // 상태는 색만이 아니라 라벨로도 나온다(REQ-WEB-033)
    expect(screen.getByText('무응답')).toBeDefined();
  });

  it('상태마다 §4.2 매핑의 토큰을 쓴다 — 엔티티마다 색을 새로 정하지 않는다', () => {
    const { container } = render(
      <SessionCard card={{ ...base, state: 'awaiting_input' }} now={NOW} />,
    );
    expect(container.innerHTML).toContain('bg-status-waiting-soft');
  });
});

describe('SessionBoard — 상태 3종 (screens.md §1.5)', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function renderBoard(): void {
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <SessionBoard projectSlug="clemvion" projectId="p-1" />
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  it('로딩은 골격으로 — 스피너 단독 금지', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    renderBoard();
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
    renderBoard();

    await waitFor(() => expect(screen.getByTestId('session-card')).toBeDefined());
    expect(screen.getByTestId('session-summary')).toBeDefined();
    expect(screen.getByText('활동 중 1')).toBeDefined();
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
    renderBoard();

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
    renderBoard();

    await waitFor(() => expect(screen.getByText('세션을 불러오지 못했습니다.')).toBeDefined());
    expect(screen.getByText('다시 시도')).toBeDefined();
    vi.unstubAllGlobals();
  });
});
