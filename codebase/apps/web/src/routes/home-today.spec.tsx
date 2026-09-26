// S1 홈의 "오늘 할 일" 한 줄이 무엇을 적는가 — screens.md §2.1
//
// **어휘를 그대로 찍던 자리다(2026-09-24).** 제목 폴백이 `subject_type` 이라 승인 카드는
// 이 줄에 **`spec_version`** 이라고 떴다 — DB 의 enum 값이고, 사람에게 아무것도 말하지
// 않는다. 2026-09-24 까지 시드에 대기 중인 결재가 한 건도 없어서(질문 하나뿐이었고 그쪽은
// `body_md` 가 있다) **그 줄을 아무도 본 적이 없다** — 시드에 결재를 심자마자 홈 첫 화면에
// 다섯 줄이 그렇게 떴다(실측).
//
// 같은 폴백은 받은 요청 카드가 이미 `subjectFallback` 로 메우고 있었다(REQ-WEB-133).
// 두 화면이 같은 목록(`/approvals`)을 읽으므로 같은 표기를 써야 한다.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

/** 받은 요청 셋 — 제목 재료가 **저마다 다르다**: 스펙 · 키 없는 플랜 · 질문 */
const CARDS = [
  {
    id: 'a1',
    subject_type: 'spec_version',
    spec_key: 'SPC-ACC-007',
    spec_title: '권한 모델 설계',
  },
  // 목록 질의는 스펙에만 제목을 JOIN 한다 — 플랜은 **제목 없이** 온다
  { id: 'a2', subject_type: 'plan' },
  { id: 'q1', subject_type: 'question', title: '스토리지 선택', body_md: '스펙에 명시 없음' },
].map((card) => ({
  ...card,
  project_slug: 'clemvion',
  requested_by: '하나',
  requested_at: '2026-09-24T00:00:00Z',
  waiting_seconds: 600,
  decision: null,
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      // **봉투다**(2026-09-24 · REQ-API-166) — 홈의 수도 `total` 에서 온다
      if (u.includes('/approvals?state=pending')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: CARDS, next_cursor: null, total: CARDS.length }),
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

function renderHome(): void {
  const history = createMemoryHistory({ initialEntries: ['/'] });
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

/** 목록이 실제로 들어온 뒤에 읽는다 — 상자만 서 있을 때 읽으면 늘 빈 문자열이다 */
async function stripText(): Promise<string> {
  renderHome();
  await waitFor(() =>
    expect(screen.getByTestId('today-strip').textContent).toContain('권한 모델 설계'),
  );
  return screen.getByTestId('today-strip').textContent ?? '';
}

describe('오늘 할 일 한 줄의 제목 (screens.md §2.1)', () => {
  it('스펙 승인은 그 문서의 제목과 키를 적는다', async () => {
    expect(await stripText()).toContain('SPC-ACC-007');
  });

  it('제목 재료가 없으면 **그 종류의 이름**을 적는다 — 어휘를 그대로 찍지 않는다', async () => {
    const text = await stripText();
    expect(text).toContain('계획 승인 요청');
    // 이 둘이 화면에 뜨면 회귀다 — `spec_version`·`plan` 은 DB 의 enum 값이다
    expect(text).not.toContain('spec_version');
    expect(text).not.toContain('plan');
  });

  // **카드와 같은 이름으로 부른다**(2026-09-24 · REQ-WEB-204). 예전에는 질문의 본문을 제목 자리에
  // 두어, 누르고 도착한 카드가 같은 요청을 다른 말(제목)로 불렀다
  it('질문은 받은 요청 카드와 같은 제목으로 적는다', async () => {
    const text = await stripText();
    expect(text).toContain('스토리지 선택');
    expect(text).not.toContain('스펙에 명시 없음');
  });

  it('줄을 누르면 받은 요청의 **그 카드**로 간다', async () => {
    renderHome();
    const link = (await screen.findByText('스토리지 선택')).closest('a');
    expect(link?.getAttribute('href')).toBe('/inbox?focus=q1');
  });
});
