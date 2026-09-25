// 목록의 주소가 진실이다 — REQ-WEB-212 (2026-09-24 · UI/UX 검토 P08b · WORK-11 · NAV-09)
//
// 리뷰 센터의 필터와 고른 발견, 세션 모니터의 상태 필터와 편 세션은 컴포넌트 state 라 링크로 건넬
// 수 없었고 새로고침에 풀렸다. 로그인 가드는 경로만 실어 보내서 공유받은 `…?finding=` 이 로그인 한
// 번에 사라졌고, 앱 주소(`/`)로 들어온 사람에게는 역할별 첫 화면이 서지 않았다.

import { NERV_ERROR } from '@nerv/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeLastOrg } from '../lib/last-org.js';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { primaryMembership } from '../lib/session.js';
import type { Me } from '../lib/session.js';
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

const ME = {
  id: 'u-1',
  display_name: '지민',
  email: 'jimin@example.com',
  memberships: [
    { org_slug: 'acme', org_name: 'Acme', project_slug: 'acme-web', roles: ['developer'] },
    { org_slug: 'default', org_name: 'Default', project_slug: 'clemvion', roles: ['planner'] },
  ],
};

const FINDINGS: Row[] = [
  {
    id: 'f-1',
    severity: 'critical',
    status: 'open',
    title: '토큰이 평문이다',
    branch: 'feat/x',
    head_sha: 'abcdef1234',
    tags: [],
  },
  {
    id: 'f-2',
    severity: 'warning',
    status: 'open',
    title: '캐시 헤더가 없다',
    branch: 'feat/x',
    head_sha: 'abcdef1234',
    tags: [],
  },
];

const SESSIONS: Row[] = ['s-1', 's-2'].map((id, i) => ({
  id,
  user_id: 'u-1',
  user_name: '지민',
  hostname: i === 0 ? 'mac-01' : 'mac-02',
  agent_type: 'claude-code',
  state: 'active',
  branch: null,
  diff_added: 0,
  diff_removed: 0,
  last_heartbeat_at: '2026-09-24T00:00:00Z',
  started_at: '2026-09-24T00:00:00Z',
  task_id: null,
  task_key: null,
  task_title: null,
  claim_id: null,
  lease_remaining_seconds: null,
  scope_spec_ids: [],
  scope_file_globs: [],
}));

let fetched: string[];
let signedIn: boolean;

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  fetched = [];
  signedIn = true;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      fetched.push(u);
      if (u.includes('/sign-in/email')) {
        signedIn = true;
        return ok({});
      }
      if (u === '/me') {
        return signedIn
          ? ok(ME)
          : {
              ok: false,
              status: 401,
              json: async () => ({
                error: { code: NERV_ERROR.UNAUTHENTICATED, message: '로그인' },
              }),
            };
      }
      if (/^\/orgs\/[^/]+\/projects/.test(u)) {
        return ok([{ id: 'p1', slug: 'clemvion', name: 'Clemvion' }]);
      }
      if (/^\/projects\/clemvion$/.test(u))
        return ok({ id: 'p1', slug: 'clemvion', name: 'Clemvion' });
      if (u.includes('/findings')) {
        return ok({
          items: FINDINGS,
          next_cursor: null,
          limit: 50,
          facets: {
            severity: { critical: 1, warning: 1 },
            status: { open: 2 },
            area: {},
            tag: {},
          },
        });
      }
      if (/\/sessions(\?|$)/.test(u))
        return ok({ items: SESSIONS, next_cursor: null, summary: {} });
      return ok({ items: [], next_cursor: null, summary: {}, memberships: [], count: 0 });
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

const params = (history: ReturnType<typeof createMemoryHistory>): URLSearchParams =>
  new URLSearchParams(history.location.search);

describe('리뷰 센터 — 필터와 고른 발견이 주소에 있다 (WORK-11)', () => {
  it('주소의 필터로 열리고 서버에도 그렇게 묻는다 — 기본(open)은 적지 않아도 선다', async () => {
    renderAt('/p/clemvion/reviews?severity=critical&area=spec');
    await screen.findByText('토큰이 평문이다');
    const asked = fetched.find((u) => u.includes('/findings'))!;
    expect(asked).toContain('severity=critical');
    expect(asked).toContain('area=spec');
    expect(asked).toContain('status=open');
    expect(screen.getByTestId('facet-critical').getAttribute('aria-pressed')).toBe('true');
  });

  it('`status=all` 이면 상태로 거르지 않는다', async () => {
    renderAt('/p/clemvion/reviews?status=all');
    await screen.findByText('토큰이 평문이다');
    expect(fetched.find((u) => u.includes('/findings'))).not.toContain('status=');
  });

  it('필터를 누르면 주소가 바뀌고, 고른 발견은 풀린다', async () => {
    const history = renderAt('/p/clemvion/reviews?finding=f-1');
    fireEvent.click(await screen.findByTestId('facet-warning'));
    await waitFor(() => expect(params(history).get('severity')).toBe('warning'));
    expect(params(history).get('finding')).toBeNull();
  });

  it('발견을 고르면 ?finding= 이 바뀌고, 레일이 그 링크를 복사한다', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const history = renderAt('/p/clemvion/reviews');
    fireEvent.click(await screen.findByText('캐시 헤더가 없다'));
    await waitFor(() => expect(params(history).get('finding')).toBe('f-2'));
    fireEvent.click(await screen.findByTestId('finding-copy-link'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toMatch(
      /\/p\/clemvion\/reviews\?finding=f-2$/,
    );
  });

  it('브랜치를 풀어도 걸어 둔 다른 필터는 그대로다', async () => {
    const history = renderAt('/p/clemvion/reviews?branch=feat%2Fx&severity=critical');
    fireEvent.click(await screen.findByTestId('branch-filter-clear'));
    await waitFor(() => expect(params(history).get('branch')).toBeNull());
    expect(params(history).get('severity')).toBe('critical');
  });
});

describe('세션 모니터 — 거른 상태와 편 세션이 주소에 있다 (WORK-11)', () => {
  it('?state= 로 거르고 ?s= 의 세션을 레일에 편다', async () => {
    renderAt('/p/clemvion/sessions?state=active&s=s-2');
    await screen.findByTestId('activity-rail');
    expect(fetched.some((u) => /\/sessions\?/.test(u) && u.includes('state=active'))).toBe(true);
    expect(screen.getByTestId('activity-rail').textContent).toContain('mac-02');
  });

  it('줄을 고르면 ?s= 가 바뀐다', async () => {
    const history = renderAt('/p/clemvion/sessions');
    const cards = await screen.findAllByTestId('session-card');
    fireEvent.click(cards[1]!);
    await waitFor(() => expect(params(history).get('s')).toBe('s-2'));
  });
});

describe('로그인 — 가던 곳과 뷰 상태를 잃지 않는다 (NAV-09)', () => {
  it('가드가 경로만이 아니라 **쿼리까지** 실어 보낸다', async () => {
    signedIn = false;
    const history = renderAt('/p/clemvion/reviews?finding=f-1');
    await waitFor(() => expect(history.location.pathname).toBe('/login'));
    expect(params(history).get('redirect')).toBe('/p/clemvion/reviews?finding=f-1');
  });

  it('로그인하면 그 주소 그대로 돌아간다', async () => {
    signedIn = false;
    const history = renderAt('/login?redirect=%2Fp%2Fclemvion%2Freviews%3Ffinding%3Df-1');
    fireEvent.change(await screen.findByLabelText('이메일'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/reviews'));
    expect(params(history).get('finding')).toBe('f-1');
  });

  it('`/` 로 튕겨 왔으면 역할별 첫 화면이다 — 기억된 조직의 역할로', async () => {
    signedIn = false;
    writeLastOrg('default');
    const history = renderAt('/login?redirect=%2F');
    fireEvent.change(await screen.findByLabelText('이메일'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    // default 조직의 planner → 받은 요청. 첫 멤버십(acme 의 developer)이었다면 작업 보드였다
    await waitFor(() => expect(history.location.pathname).toBe('/inbox'));
  });

  it('밖으로 나가는 주소는 받지 않는다', async () => {
    signedIn = false;
    const history = renderAt('/login?redirect=%2F%2Fevil.example%2Fx');
    fireEvent.change(await screen.findByLabelText('이메일'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByLabelText('이메일').closest('form')!);
    await waitFor(() => expect(history.location.pathname).not.toBe('/login'));
    expect(history.location.pathname.startsWith('//')).toBe(false);
  });
});

describe('첫 화면의 멤버십 고르기', () => {
  it('기억된 조직의 멤버십이 먼저다 — 그 조직에 없을 때만 전체에서 고른다', () => {
    const me = ME as unknown as Me;
    expect(primaryMembership(me, 'default')?.org_slug).toBe('default');
    expect(primaryMembership(me, 'nowhere')?.org_slug).toBe('acme');
    expect(primaryMembership(me)?.org_slug).toBe('acme');
  });
});
