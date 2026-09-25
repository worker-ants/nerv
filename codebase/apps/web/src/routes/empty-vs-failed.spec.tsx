// 불러오는 중 · 실패 · 없음을 비어 있음과 가른다 (REQ-WEB-198 · 199 · screens.md §1.5)
//
// 2026-09-24 까지 화면 대부분이 `!isLoading && 0건` 이면 빈 상태를 그렸다 — 실패를 거르지
// 않는 조건이다. 받은 요청을 불러오지 못해도 홈은 "밀린 결정이 없어요" 라고 말했고, 없는
// 작업·문서·프로젝트는 키만 적힌 빈 머리로 섰으며, 다른 조직 알림의 링크는 "없다" 에 막혔다.
// 이 파일은 셋을 앱 전체 배선(routeTree)으로 본다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR, NERV_EVENT, ko } from '@nerv/schema';
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

interface Reply {
  status: number;
  body: unknown;
}
const ok = (body: unknown): Reply => ({ status: 200, body });
const envelope = (status: number, code: string, kind: string): Reply => ({
  status,
  body: {
    ok: false,
    code,
    message: '',
    details: { kind },
    retry_after_s: null,
    next_actions: [],
  },
});
const FAILED = envelope(500, NERV_ERROR.UNAVAILABLE, 'down');
const NOT_FOUND = envelope(409, NERV_ERROR.PRECONDITION, 'not_found');

const MEMBERSHIP = {
  id: 'm1',
  roles: ['admin'],
  org_id: 'o1',
  org_slug: 'default',
  org_name: 'NERV',
  project_id: 'p1',
  project_slug: 'clemvion',
  project_name: 'clemvion',
};
const OTHER_ORG = {
  id: 'm2',
  roles: ['planner'],
  org_id: 'o2',
  org_slug: 'acme',
  org_name: 'Acme',
  project_id: 'p2',
  project_slug: 'sudoku',
  project_name: 'sudoku',
};

/** 검사마다 갈아 끼운다 — 돌려주지 않으면 기본 응답 */
let override: (
  path: string,
  init: { method?: string; headers?: Record<string, string> },
) => Reply | undefined = () => undefined;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  override = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: unknown, init: { method?: string; headers?: Record<string, string> } = {}) => {
        const path = String(url).replace(/^.*\/api\/v1/, '');
        const pick = override(path, init);
        const reply =
          pick ??
          (/^\/me(\?|$)/.test(path)
            ? ok({
                id: 'u1',
                email: 'me@example.com',
                display_name: '나',
                avatar_url: null,
                memberships: [MEMBERSHIP, OTHER_ORG],
              })
            : /^\/orgs\/[^/]+\/projects/.test(path)
              ? ok([{ id: 'p1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }])
              : /^\/projects\/clemvion(\?|$)/.test(path)
                ? ok({ id: 'p1', slug: 'clemvion', name: 'clemvion', gate_policy: {} })
                : ok({ items: [], next_cursor: null, total: 0, count: 0, summary: {} }));
        return {
          ok: reply.status < 400,
          status: reply.status,
          json: async () => reply.body,
        };
      },
    ),
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

describe('실패는 "없다" 가 아니다 (REQ-WEB-198)', () => {
  it('홈 — 받은 요청을 불러오지 못하면 "밀린 결정이 없어요" 라고 말하지 않는다', async () => {
    override = (path) => (path.startsWith('/approvals') ? FAILED : undefined);
    renderAt('/');

    await screen.findByTestId('error-state');
    const heading = screen.getByRole('heading', { level: 1 }).textContent ?? '';
    expect(heading).toContain('받은 요청을 불러오지 못했습니다');
    expect(heading).not.toContain('없어요');
    expect(screen.queryByText(ko['home.nothing_waiting'])).toBeNull();
    expect(screen.getByRole('button', { name: ko['common.retry'] })).toBeDefined();
  });

  it('받은 요청 — 실패를 빈 목록으로 그리지 않는다', async () => {
    override = (path) => (path.startsWith('/approvals') ? FAILED : undefined);
    renderAt('/inbox');
    await screen.findByTestId('error-state');
    expect(screen.queryByText(ko['home.nothing_waiting'])).toBeNull();
  });

  it('알림 — 실패를 빈 목록으로 그리지 않는다', async () => {
    override = (path) => (/^\/me\/notifications(\?|$)/.test(path) ? FAILED : undefined);
    renderAt('/notifications');
    await screen.findByTestId('error-state');
    expect(screen.queryByText(ko['notif.empty'])).toBeNull();
  });

  it('멤버 — 받아 오기 전·실패한 뒤에 "멤버가 없습니다" 라고 말하지 않는다', async () => {
    override = (path) => (/^\/orgs\/[^/]+\/members/.test(path) ? FAILED : undefined);
    renderAt('/settings/members');
    await screen.findByTestId('error-state');
    expect(screen.queryByText(ko['settings.members.empty'])).toBeNull();
  });

  it('게이트 정책 — 불러오지 못한 정책은 저장할 수 없다(기본값으로 덮이지 않게)', async () => {
    override = (path) => (/^\/projects\/clemvion(\?|$)/.test(path) ? FAILED : undefined);
    renderAt('/settings/gates');
    await screen.findAllByTestId('error-state');
    const save = screen.getByRole('button', { name: ko['common.save'] }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});

describe('없는 것은 무엇이 없는지 말한다 (REQ-WEB-199)', () => {
  it('없는 작업 — 키만 적힌 빈 머리가 아니라 "찾을 수 없습니다" 와 목록으로 가는 길', async () => {
    override = (path) => (path.startsWith('/projects/clemvion/tasks/') ? NOT_FOUND : undefined);
    renderAt('/p/clemvion/tasks/CLV-T-NOPE00');
    const box = await screen.findByTestId('not-found');
    expect(box.textContent).toContain('CLV-T-NOPE00');
    expect(screen.getByText(ko['state.back_to_list'])).toBeDefined();
    // 번역되지 않은 키가 배지로 서지 않는다(예전: `status.task`)
    expect(document.body.textContent).not.toContain('status.task');
  });

  it('없는 문서 — "초안" 배지가 붙은 빈 문서가 아니다', async () => {
    override = (path) =>
      /^\/projects\/clemvion\/specs\/SPC-NOPE(\?|$)/.test(path) ? NOT_FOUND : undefined;
    renderAt('/p/clemvion/specs/SPC-NOPE');
    const box = await screen.findByTestId('not-found');
    expect(box.textContent).toContain('SPC-NOPE');
    expect(screen.queryByTestId('spec-title')).toBeNull();
  });

  it('멤버가 아닌 프로젝트 — 빈 프로젝트가 아니라 멤버가 아니라고 말한다', async () => {
    override = (path) =>
      /^\/projects\/clemvion(\?|$)/.test(path)
        ? envelope(403, NERV_ERROR.FORBIDDEN, 'no_membership')
        : undefined;
    renderAt('/p/clemvion');
    const box = await screen.findByTestId('not-found');
    expect(box.textContent).toContain('멤버가 아닙니다');
  });

  it('없는 주소 — 영문 한 줄이 아니라 셸 안에서 말하고 홈으로 가는 길을 준다', async () => {
    renderAt('/no/such/place');
    const box = await screen.findByTestId('not-found');
    expect(box.textContent).toContain(ko['state.not_found']);
    expect(box.textContent).toContain('/no/such/place');
    expect(screen.getByText(ko['state.go_home'])).toBeDefined();
  });
});

describe('다른 조직의 것은 조직을 바꿔 연다 (REQ-WEB-199)', () => {
  it('지금 조직에 없는 프로젝트의 주소는 그 프로젝트가 있는 조직으로 옮겨 연다', async () => {
    // 서버는 지금 조직(X-Nerv-Org) 안에서만 찾는다 — acme 로 물을 때만 sudoku 가 있다
    override = (path, init) => {
      if (!/^\/projects\/sudoku(\?|$)/.test(path)) return undefined;
      return init.headers?.['X-Nerv-Org'] === 'acme'
        ? ok({ id: 'p2', slug: 'sudoku', name: 'sudoku' })
        : NOT_FOUND;
    };
    const history = renderAt('/p/sudoku/tasks?backlog=0');
    await waitFor(() => expect(localStorage.getItem('nerv.last-org')).toBe('acme'));
    // 전환이 말하고, 뷰 상태까지 싣고 그 자리로 **한 번** 돌아온다 — 옮겨 가는 동안 지금 주소를
    // 다시 읽으면 전환 주소가 전환 주소를 싣는 고리가 끝없이 돌았다(구현 중 실측)
    await screen.findByText(/Acme\(으\)로 전환했습니다/);
    await waitFor(() => expect(history.location.pathname).toBe('/p/sudoku/tasks'));
    // 뷰 상태가 살아 왔다 — 보드가 `?backlog=0` 을 읽게 된 뒤로(P08c) 라우터는 그것을 자기 표기
    // (`false`)로 다시 적는다. 예전에는 읽지 못한 값이 날것으로 남아 있어 모양만 같았다
    expect(new URLSearchParams(history.location.search).get('backlog')).toBe('false');
    expect(screen.queryByTestId('not-found')).toBeNull();
  });

  it('다른 조직의 알림을 누르면 조직 전환을 거쳐 그 자리로 간다', async () => {
    override = (path) =>
      /^\/me\/notifications(\?|$)/.test(path)
        ? ok({
            items: [
              {
                id: 'n1',
                state: 'read',
                event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
                spec_key: 'SUD-VISION',
                project_slug: 'sudoku',
                org_slug: 'acme',
                actor_name: '지민',
                is_agent: false,
                occurred_at: '2026-09-24T00:00:00Z',
              },
            ],
            next_cursor: null,
          })
        : undefined;
    const history = renderAt('/notifications');
    fireEvent.click(await screen.findByTestId('notification-row'));
    await waitFor(() => expect(localStorage.getItem('nerv.last-org')).toBe('acme'));
    await waitFor(() => expect(history.location.pathname).toBe('/p/sudoku/specs/SUD-VISION'));
  });
});
