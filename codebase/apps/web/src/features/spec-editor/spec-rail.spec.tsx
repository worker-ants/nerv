// S3 우측 레일의 넷 — 요구사항 · 파생 Task · 소스 보기 · 터미널 이어쓰기 (screens.md §2.4)
//
// 넷 다 2026-09-06 까지 **저장소에 없었다.** 명세는 컴포넌트 이름까지 적어 두었고
// REQ-WEB-031 은 "저장 실패 시 **소스 보기와 함께** 실패 리포트" 를 요구하는데, 그 소스
// 보기가 없어 차단만 있고 볼 것이 없는 화면이었다.

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RealtimeProvider } from '../../lib/realtime.js';
import { RequirementPanel } from './requirement-panel.js';
import { SourceView, SourceViewToggle } from './source-view.js';
import { TerminalHandoffCard } from './terminal-handoff.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 라우터 안에서 산다 — 패널이 스펙·Task·도움말로 데려간다(§1.5 막다른 길 금지) */
async function withProviders(ui: React.ReactElement): Promise<void> {
  const rootRoute = createRootRoute({ component: () => <RealtimeProvider>{ui}</RealtimeProvider> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

function stubFetch(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

describe('요구사항 패널', () => {
  it('약속을 목록으로 보인다 — 커버리지 숫자는 "어느 요구사항인지" 를 말하지 못한다', async () => {
    stubFetch([
      {
        id: 'r-1',
        ref: 'REQ-CWC-031',
        statement_md: 'WHEN 위젯을 처음 열면 …',
        priority: 'must',
        impl_status: 'in_progress',
        task_count: 2,
        evidence_count: 1,
      },
    ]);
    await withProviders(<RequirementPanel projectSlug="clemvion" specKey="SPC-CWC-007" />);
    await waitFor(() => expect(screen.getByText('REQ-CWC-031')).toBeTruthy());
    expect(screen.queryByTestId('empty-promise')).toBeNull();
  });

  it('**빈 약속을 붉게 세운다** — Task 도 증적도 0 인 요구사항이 목록에서 눈에 띈다(FR-13)', async () => {
    stubFetch([
      {
        id: 'r-2',
        ref: 'REQ-CWC-032',
        statement_md: '…',
        priority: null,
        impl_status: 'unimplemented',
        task_count: 0,
        evidence_count: 0,
      },
    ]);
    await withProviders(<RequirementPanel projectSlug="clemvion" specKey="SPC-CWC-007" />);
    await waitFor(() => expect(screen.getByTestId('empty-promise')).toBeTruthy());
    // 우선순위가 없으면 **없다고 적는다** — `must` 로 채워 보이면 원본의 선언처럼 읽힌다
    expect(screen.getByText('우선순위 없음')).toBeTruthy();
  });

  it('0건이면 막다른 길이 아니라 다음 행동으로 데려간다(§1.5)', async () => {
    stubFetch([]);
    await withProviders(<RequirementPanel projectSlug="clemvion" specKey="SPC-CWC-007" />);
    await waitFor(() => expect(screen.getByText(/요구사항 블록이 없습니다/)).toBeTruthy());
  });
});

describe('소스 보기 (REQ-WEB-031)', () => {
  it('원문을 그대로 낸다 — 저장을 막은 것이 무엇인지는 렌더링이 아니라 바이트에 있다', async () => {
    await withProviders(<SourceView body={'| a \\| b |\n| --- |'} />);
    expect(screen.getByTestId('source-view').textContent).toContain('\\|');
  });

  it('토글은 눌린 상태를 말한다 — 색만으로 구분하지 않는다', async () => {
    const onToggle = vi.fn();
    await withProviders(<SourceViewToggle on={true} onToggle={onToggle} />);
    const button = screen.getByTestId('source-view-toggle');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('터미널 이어쓰기', () => {
  it('스펙 키가 든 복사용 명령 한 줄이다 — 손으로 옮겨 적으면 오타가 세션 하나를 버린다', async () => {
    await withProviders(<TerminalHandoffCard specKey="SPC-CWC-007" />);
    expect(screen.getByTestId('handoff-command').textContent).toBe(
      'claude "/nerv:spec edit SPC-CWC-007"',
    );
  });
});
