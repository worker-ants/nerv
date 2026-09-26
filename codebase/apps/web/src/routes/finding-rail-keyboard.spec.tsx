// 발견은 읽은 자리에서 처분하고, 키보드로도 고른다 — REQ-WEB-222 (2026-09-25 · UI/UX 검토 P10d)
//
// 레일에서 전문과 코멘트를 읽은 QA 는, 처분하려면 가운데 큐로 눈을 옮겨 같은 카드를 다시 찾아야 했고 폼도
// 그 카드 아래에 열렸다. 네 단추는 무엇을 요구하는지 말하지 않았다(title 은 권한이 없을 때만). 발견 카드와
// 세션 줄은 `article` 의 클릭으로만 골라져 키보드로는 레일에 닿을 수 없었다(WORK-12).

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCard } from '../features/session-monitor/session-card.js';
import type { SessionCard as SessionCardData } from '../features/session-monitor/types.js';
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

const FIRST = {
  id: '0f3a91c2-7d10-4b55-9a3e-1c2d3e4f5a6b',
  severity: 'critical',
  status: 'open',
  category: 'security',
  title: '세션 토큰이 평문 저장',
  tags: [],
  file_path: 'src/widget/session.ts',
  line_start: 88,
  occurrence_count: 1,
  head_sha: '9a41c2ffee11',
  branch: 'feature/widget-v2',
  round_no: 1,
  spec_key: null,
  detail_md: '서버 세션으로 옮겨야 한다.',
  suggestion_md: null,
};
const SECOND = {
  ...FIRST,
  id: '11112222-3333-4444-5555-666677778888',
  severity: 'warning',
  title: '캐시 헤더 TTL 미지정',
};

let wide: boolean;

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  wide = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const path = String(url);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      if (init?.method === 'POST') return ok({ ok: true });
      if (path.includes('/comments')) return ok({ items: [] });
      if (path.includes('/findings')) {
        return ok({ items: [FIRST, SECOND], facets: { severity: {}, status: {}, tag: {} } });
      }
      if (path.includes('/gates/reviews')) return ok({ items: [], total: 0 });
      if (path.includes('/me')) {
        return ok({
          id: 'u-1',
          display_name: '규아',
          memberships: [
            { org_slug: 'nerv', project_slug: 'clemvion', roles: ['qa'], project_id: 'p-1' },
          ],
        });
      }
      if (path.includes('/projects/clemvion')) {
        return ok({ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', org_slug: 'nerv' });
      }
      return ok({ items: [], memberships: [], count: 0, summary: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): ReturnType<typeof createMemoryHistory> {
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
  return history;
}

const findingParam = (history: ReturnType<typeof createMemoryHistory>): string | null =>
  new URLSearchParams(history.location.search).get('finding');

describe('읽은 자리에서 처분한다 (REQ-WEB-222)', () => {
  it('레일에 처분 넷이 서고, 누르면 폼이 레일 안에 열려 근거 칸으로 간다', async () => {
    renderAt(`/p/clemvion/reviews?finding=${FIRST.id}`);
    const rail = within(await screen.findByTestId('review-rail'));
    fireEvent.click(await rail.findByTestId('rail-resolve-dismissed'));
    const dialog = await rail.findByTestId('resolve-dialog');
    expect(document.activeElement).toBe(within(dialog).getByTestId('resolve-rationale'));
    expect(rail.getByTestId('rail-resolve-dismissed').getAttribute('aria-pressed')).toBe('true');
  });

  it('카드의 단추는 그 발견으로 레일을 열고 폼을 거기 띄운다 — 카드 아래에는 열지 않는다', async () => {
    const history = renderAt('/p/clemvion/reviews');
    const cards = await screen.findAllByTestId('finding-card');
    fireEvent.click(within(cards[1]!).getByTestId('resolve-wont_fix'));
    await waitFor(() => expect(findingParam(history)).toBe(SECOND.id));
    const rail = within(await screen.findByTestId('review-rail'));
    expect(await rail.findByTestId('resolve-dialog')).toBeDefined();
    expect(within(cards[1]!).queryByTestId('resolve-dialog')).toBeNull();
    // 유예는 "나중에 할 일" 과 헷갈린다 — Task 로 올리는 길을 곁에서 말한다
    expect(rail.getByTestId('resolve-wont-fix-hint').textContent).toContain('작업으로 등록');
  });

  it('처분 단추는 권한이 있어도 무엇을 요구하는지 말한다', async () => {
    renderAt('/p/clemvion/reviews');
    const card = within((await screen.findAllByTestId('finding-card'))[0]!);
    expect(card.getByTestId('resolve-fixed').getAttribute('title')).toContain('커밋 SHA');
    expect(card.getByTestId('resolve-spec_change').getAttribute('title')).toContain('스펙');
    expect(card.getByTestId('resolve-wont_fix').getAttribute('title')).toContain('작업으로');
  });

  it('좁은 폭에서도 폼은 그 카드 아래에 편 레일 안에 선다', async () => {
    wide = false;
    renderAt('/p/clemvion/reviews');
    const cards = await screen.findAllByTestId('finding-card');
    fireEvent.click(within(cards[0]!).getByTestId('resolve-fixed'));
    const inline = within(await screen.findByTestId('finding-rail-inline'));
    expect(await inline.findByTestId('resolve-dialog')).toBeDefined();
  });
});

describe('키보드로 고른다 (REQ-WEB-222)', () => {
  it('카드의 제목은 단추다 — 누르면 그 발견을 고른다', async () => {
    const history = renderAt('/p/clemvion/reviews');
    const selects = await screen.findAllByTestId('finding-select');
    expect(selects[0]!.tagName).toBe('BUTTON');
    fireEvent.click(selects[1]!);
    await waitFor(() => expect(findingParam(history)).toBe(SECOND.id));
    await waitFor(() =>
      expect(screen.getAllByTestId('finding-select')[1]!.getAttribute('aria-current')).toBe('true'),
    );
  });

  it('j/k 로 큐를 훑는다 — 입력 칸 안에서는 듣지 않는다', async () => {
    const history = renderAt('/p/clemvion/reviews');
    await screen.findAllByTestId('finding-card');
    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(findingParam(history)).toBe(FIRST.id));
    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(findingParam(history)).toBe(SECOND.id));
    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => expect(findingParam(history)).toBe(FIRST.id));
    // 코멘트에 j 를 쓰는 중이면 다른 발견으로 넘어가지 않는다
    const input = await screen.findByTestId('comment-input');
    fireEvent.keyDown(input, { key: 'j' });
    expect(findingParam(history)).toBe(FIRST.id);
  });
});

describe('세션 줄도 키보드로 고른다 (REQ-WEB-222)', () => {
  const card: SessionCardData = {
    id: 's-1',
    user_id: 'u-1',
    user_name: '유나',
    hostname: 'linux-ci-01',
    agent_type: 'codex',
    state: 'active',
    branch: null,
    diff_added: 0,
    diff_removed: 0,
    last_heartbeat_at: null,
    started_at: '2026-09-25T00:00:00Z',
    task_id: null,
    task_key: null,
    task_title: null,
    claim_id: null,
    lease_remaining_seconds: null,
    scope_spec_ids: [],
    scope_file_globs: [],
  };

  it('고를 수 있는 줄이면 이름이 단추다', () => {
    const onSelect = vi.fn();
    render(
      <LocaleProvider locale="ko">
        <SessionCard card={card} onSelect={onSelect} selected />
      </LocaleProvider>,
    );
    const button = screen.getByTestId('session-select');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-current')).toBe('true');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('고를 수 없는 줄(개요)에는 단추를 세우지 않는다', () => {
    render(
      <LocaleProvider locale="ko">
        <SessionCard card={card} />
      </LocaleProvider>,
    );
    expect(screen.queryByTestId('session-select')).toBeNull();
  });
});
