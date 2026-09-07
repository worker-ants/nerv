// 활동 타임라인 — 레일과 세션 상세가 **같은 것을 그린다**(REQ-WEB-141·142)
//
//   REQ-WEB-141  잘렸다고 말만 하지 않는다 — [더 보기]가 `?cursor=` 로 앞쪽을 이어 받고
//                받아 온 쪽은 **시간 순으로** 이어 붙는다(뒤 쪽일수록 과거다)
//   REQ-WEB-142  묶기·실패 강조·원문 펼침이 두 화면에 같이 있다
//
// 2026-09-06 까지 이 목록은 두 벌이었다: 레일에는 넷이 다 있었고 상세에는 하나도 없었다.
// 화면이 좁으면 레일이 접히므로 사람은 상세로 가라는 안내를 받는데, 도착한 곳이 **덜
// 보여 주는 화면**이었다.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { ActivityTimeline, groupRuns } from './activity-timeline.js';
import type { Row } from '../../lib/queries.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function activity(id: string, title: string, extra: Row = {}): Row {
  return { id, seq: Number(id.replace(/\D/g, '')), type: 'action', title, ...extra };
}

/** 요청한 URL 을 기록한다 — 커서가 실제로 실려 나갔는지가 검사 대상이다 */
function stubPages(pages: { items: Row[]; next_cursor: string | null }[]): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      urls.push(String(url));
      const cursor = new URL(String(url), 'http://x').searchParams.get('cursor');
      const page = cursor === null ? pages[0] : pages.find((_, i) => `c${i}` === cursor);
      return { ok: true, status: 200, json: async () => page ?? { items: [], next_cursor: null } };
    }),
  );
  return urls;
}

function renderTimeline(): void {
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RealtimeProvider>
          <ActivityTimeline projectSlug="clemvion" sessionId="s-1" />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('커서로 이어 받는다 (REQ-WEB-141)', () => {
  it('[더 보기]가 `cursor=` 를 실어 두 번째 요청을 내고 목록이 이어 붙는다', async () => {
    const urls = stubPages([
      { items: [activity('a3', '최근 것')], next_cursor: 'c1' },
      { items: [activity('a1', '앞쪽 것')], next_cursor: null },
    ]);
    renderTimeline();

    await screen.findByText('최근 것');
    expect(screen.queryByText('앞쪽 것')).toBeNull();
    // 첫 요청에는 커서가 없다 — 있으면 서버가 첫 쪽을 건너뛴다
    expect(urls[0]).not.toContain('cursor=');

    fireEvent.click(screen.getByTestId('timeline-load-more'));

    await screen.findByText('앞쪽 것');
    await waitFor(() => expect(urls.some((u) => u.includes('cursor=c1'))).toBe(true));
    // **이어 붙는다** — 두 번째 쪽이 첫 쪽을 갈아치우면 [더 보기]는 되돌리기가 된다
    expect(screen.getByText('최근 것')).toBeDefined();
  });

  it('이어 받은 쪽은 **앞에** 붙는다 — 쪽이 과거로 가므로 시간이 거꾸로 흐르면 안 된다', async () => {
    stubPages([
      { items: [activity('a3', '나중')], next_cursor: 'c1' },
      { items: [activity('a1', '먼저')], next_cursor: null },
    ]);
    renderTimeline();
    await screen.findByText('나중');
    fireEvent.click(screen.getByTestId('timeline-load-more'));
    await screen.findByText('먼저');

    const order = screen.getAllByTestId('activity-row').map((li) => li.textContent);
    expect(order[0]).toContain('먼저');
    expect(order[1]).toContain('나중');
  });

  it('마지막 쪽에서는 단추를 감춘다 — 눌러도 아무것도 오지 않는 단추는 두지 않는다', async () => {
    stubPages([{ items: [activity('a1', '전부')], next_cursor: null }]);
    renderTimeline();
    await screen.findByText('전부');
    expect(screen.queryByTestId('timeline-load-more')).toBeNull();
  });

  it('활동이 없으면 빈 상태를 적는다 — 로딩과 "없음" 은 다른 말이다', async () => {
    stubPages([{ items: [], next_cursor: null }]);
    renderTimeline();
    await screen.findByText('아직 활동이 없습니다.');
  });
});

describe('레일이 하던 것을 그대로 한다 (REQ-WEB-142)', () => {
  it('같은 도구가 연달아 나면 묶고 몇 번인지 적는다', async () => {
    stubPages([
      {
        items: [
          activity('a1', 'Bash: ls', { tool_name: 'Bash' }),
          activity('a2', 'Bash: pwd', { tool_name: 'Bash' }),
          activity('a3', 'Bash: cat', { tool_name: 'Bash' }),
        ],
        next_cursor: null,
      },
    ]);
    renderTimeline();
    await screen.findByTestId('run-count');
    expect(screen.getByTestId('run-count').textContent).toContain('3');
    expect(screen.getAllByTestId('activity-row')).toHaveLength(1);
  });

  it('원문은 접힘이 기본이고 펼치면 나온다', async () => {
    stubPages([
      {
        items: [
          activity('a1', 'Bash: ls', {
            tool_name: 'Bash',
            payload: { tool_input: { command: 'ls' } },
          }),
        ],
        next_cursor: null,
      },
    ]);
    renderTimeline();
    const toggle = await screen.findByTestId('activity-toggle');
    expect(screen.queryByTestId('activity-raw')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('activity-raw').textContent).toContain('command');
  });
});

describe('groupRuns — 실패는 묶이지 않는다', () => {
  it('사이에 다른 도구가 끼면 다른 국면이다', () => {
    const groups = groupRuns([
      activity('a1', 'x', { tool_name: 'Bash' }),
      activity('a2', 'y', { tool_name: 'Edit' }),
      activity('a3', 'z', { tool_name: 'Bash' }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('실패는 묶음 안에 숨지 않는다', () => {
    const groups = groupRuns([
      activity('a1', 'x', { tool_name: 'Bash' }),
      activity('a2', 'y', { tool_name: 'Bash', payload: { ok: false } }),
      activity('a3', 'z', { tool_name: 'Bash' }),
    ]);
    expect(groups).toHaveLength(3);
  });
});
