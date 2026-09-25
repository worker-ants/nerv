// 무엇에 일어났나 — REQ-WEB-210 · REQ-API-181 (2026-09-24 · UI/UX 검토 P07b)
//
// 홈과 개요의 활동 줄은 "초안 수정 · 관리자 · 16일 전" 만 적어 어느 스펙인지 알 수 없었고 눌리지도
// 않았다. 에이전트가 초안을 저장할 때마다 한 줄씩 쌓여 여덟 줄이 같은 말이었다. 홈의 숫자 셋도
// 눌리지 않았고, 알림 센터의 결재 요청·질문은 키도 제목도 없이 "승인 요청" 만 반복했다.

import { NERV_EVENT, NERV_EVENT_PHASE2 } from '@nerv/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collapseRepeats, eventSubject, eventTarget } from '../lib/event-subject.js';
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

const at = (minute: number): string => `2026-09-24T00:${String(minute).padStart(2, '0')}:00.000Z`;

/** 에이전트가 같은 초안을 세 번 저장하고, 사람이 다른 스펙을 승인했다 */
const EVENTS: Row[] = [
  ...[3, 2, 1].map((m) => ({
    id: `d-${String(m)}`,
    type: NERV_EVENT.SPEC_DRAFT_UPDATED,
    subject_type: 'spec_version',
    subject_id: 'sv-draft',
    actor_user_id: 'u-2',
    actor_session_id: 's-1',
    actor_name: '도현',
    is_agent: true,
    hostname: 'mac-02',
    agent_type: 'claude-code',
    spec_key: 'SPC-CWC-009',
    spec_title: '위젯 캐시',
    version_no: 2,
    occurred_at: at(10 + m),
  })),
  {
    id: 'a-1',
    type: NERV_EVENT.SPEC_APPROVED,
    subject_type: 'spec_version',
    subject_id: 'sv-4',
    actor_user_id: 'u-1',
    actor_name: '지민',
    is_agent: false,
    spec_key: 'SPC-CWC-007',
    spec_title: '위젯 상태',
    version_no: 4,
    occurred_at: at(5),
  },
  {
    id: 'r-1',
    type: NERV_EVENT.APPROVAL_REQUESTED,
    subject_type: 'approval',
    subject_id: 'ap-1',
    actor_user_id: 'u-1',
    actor_name: '지민',
    is_agent: false,
    spec_key: 'SPC-CWC-007',
    spec_title: '위젯 상태',
    version_no: 4,
    occurred_at: at(4),
  },
  {
    id: 'f-1',
    type: NERV_EVENT_PHASE2.FINDING_OPENED,
    subject_type: 'finding',
    subject_id: 'fd-1',
    actor_session_id: 's-1',
    actor_name: '도현',
    is_agent: true,
    finding_id: 'fd-1',
    finding_title: '캐시 헤더가 없다',
    occurred_at: at(3),
  },
];

const NOTIFICATIONS: Row[] = [
  {
    id: 'n-1',
    state: 'unread',
    event_type: NERV_EVENT.APPROVAL_REQUESTED,
    subject_type: 'approval',
    subject_id: 'ap-1',
    spec_key: 'SPC-CWC-007',
    spec_title: '위젯 상태',
    version_no: 4,
  },
  {
    id: 'n-2',
    state: 'unread',
    event_type: NERV_EVENT.QUESTION_CREATED,
    subject_type: 'question',
    subject_id: 'q-1',
    question_title: '어느 쪽으로?',
    task_key: 'CLV-T-ASK001',
    task_title: '물어볼 작업',
  },
  ...[1, 2].map((i) => ({
    id: `n-c${String(i)}`,
    state: 'unread',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    subject_type: 'spec',
    subject_id: 'spec-9',
    spec_key: 'SPC-CWC-009',
  })),
].map((n) => ({
  ...n,
  project_slug: 'clemvion',
  project_name: 'Clemvion',
  org_slug: 'default',
  actor_name: '지민',
  is_agent: false,
  occurred_at: at(1),
}));

let fetched: string[];
let posted: string[];
let eventsPage: { items: Row[]; next_cursor: string | null };

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  fetched = [];
  posted = [];
  eventsPage = { items: EVENTS, next_cursor: null };
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      fetched.push(u);
      if (init?.method === 'POST') {
        posted.push(u);
        return ok({ ok: true });
      }
      if (u === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          email: 'jimin@example.com',
          memberships: [
            {
              org_slug: 'default',
              org_name: 'Default',
              project_slug: 'clemvion',
              roles: ['planner'],
            },
          ],
        });
      }
      if (u.includes('unread-count')) return ok({ count: 4, immediate: 2 });
      if (u.startsWith('/me/notifications')) return ok({ items: NOTIFICATIONS, next_cursor: null });
      if (u.includes('/events')) {
        return ok(u.includes('before=') ? { items: [], next_cursor: null } : eventsPage);
      }
      if (/^\/projects\/clemvion$/.test(u)) {
        return ok({ id: 'p1', slug: 'clemvion', name: 'Clemvion', active_sessions: 2 });
      }
      if (/^\/orgs\/[^/]+\/projects/.test(u)) {
        return ok([
          {
            id: 'p1',
            slug: 'clemvion',
            name: 'Clemvion',
            active_sessions: 2,
            pending_approvals: 1,
          },
        ]);
      }
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

describe('활동 피드가 무엇에 일어났는지 말한다', () => {
  it('줄마다 대상 키·버전·제목을 적고, 키는 그 버전의 diff 로 간다', async () => {
    renderAt('/p/clemvion');
    const rows = await screen.findAllByTestId('event-row');
    const approved = rows.find((r) => r.textContent?.includes('SPC-CWC-007 v4'));
    expect(approved).toBeDefined();
    expect(within(approved!).getByTestId('event-title').textContent).toBe('위젯 상태');
    expect(within(approved!).getByTestId('event-subject').getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-CWC-007?diff=v3..v4',
    );
  });

  it('피드의 결재 요청은 받은 요청이 아니라 **결재할 것**으로 간다', async () => {
    renderAt('/p/clemvion');
    const rows = await screen.findAllByTestId('event-row');
    const request = rows.find((r) => r.textContent?.includes('승인 요청'));
    expect(within(request!).getByTestId('event-subject').getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-CWC-007?diff=v3..v4',
    );
  });

  it('키가 없는 대상은 제목이 링크다 — 발견은 리뷰 센터의 그 발견으로', async () => {
    renderAt('/p/clemvion');
    const rows = await screen.findAllByTestId('event-row');
    const opened = rows.find((r) => r.textContent?.includes('캐시 헤더가 없다'));
    const link = within(opened!).getByTestId('event-subject');
    expect(link.textContent).toBe('캐시 헤더가 없다');
    expect(link.getAttribute('href')).toBe('/p/clemvion/reviews?finding=fd-1');
  });

  it('에이전트 줄은 AI 표식에 어느 기계의 무엇인지를 싣는다', async () => {
    renderAt('/p/clemvion');
    const agent = (await screen.findAllByTestId('event-actor-agent'))[0]!;
    expect(agent.getAttribute('title')).toContain('mac-02');
    expect(agent.getAttribute('title')).toContain('claude-code');
  });

  it('잇달아 같은 일은 한 줄로 접고, ×N 을 누르면 펼친다', async () => {
    renderAt('/p/clemvion');
    const repeat = await screen.findByTestId('event-repeat');
    expect(repeat.textContent).toBe('×3');
    // 접힌 셋 + 승인 + 결재 요청 + 발견
    expect(screen.getAllByTestId('event-row')).toHaveLength(4);
    fireEvent.click(repeat);
    expect(screen.getAllByTestId('event-row')).toHaveLength(6);
    expect(repeat.getAttribute('aria-expanded')).toBe('true');
  });

  it('개요는 다음 쪽이 있으면 [더 보기] 로 잇는다', async () => {
    eventsPage = { items: EVENTS, next_cursor: 'c-1' };
    renderAt('/p/clemvion');
    fireEvent.click(await screen.findByTestId('event-feed-more'));
    await waitFor(() =>
      expect(fetched.some((u) => u.includes('/events') && u.includes('before=c-1'))).toBe(true),
    );
  });

  it('홈도 같은 피드다 — 대상이 서고 같은 일은 접힌다', async () => {
    renderAt('/');
    expect((await screen.findByTestId('event-repeat')).textContent).toBe('×3');
    expect(screen.getAllByTestId('event-subject').length).toBeGreaterThan(0);
  });
});

describe('홈의 숫자를 누르면 그 숫자를 만든 레코드로 간다', () => {
  // 2026-09-25 부터 숫자는 **내 프로젝트** 줄마다 선다(REQ-WEB-220) — 요구사항 수는 개요가 갖는다
  it('활성 세션 → 세션 모니터 · 미결 결재 → 받은 요청 · 열린 critical → 리뷰 센터', async () => {
    renderAt('/');
    expect((await screen.findByTestId('home-project-sessions')).getAttribute('href')).toBe(
      '/p/clemvion/sessions',
    );
    expect(screen.getByTestId('home-project-approvals').getAttribute('href')).toBe('/inbox');
    expect(screen.getByTestId('home-project-critical').getAttribute('href')).toBe(
      '/p/clemvion/reviews?severity=critical',
    );
  });
});

describe('알림 행이 무엇에 대한 것인지 말한다', () => {
  it('결재 요청은 키·버전·제목을, 질문은 그 제목을 싣는다', async () => {
    renderAt('/notifications');
    const rows = await screen.findAllByTestId('notification-row');
    expect(rows[0]!.textContent).toContain('SPC-CWC-007 v4');
    expect(within(rows[0]!).getByTestId('notification-title').textContent).toBe('위젯 상태');
    expect(within(rows[1]!).getByTestId('notification-title').textContent).toBe('어느 쪽으로?');
  });

  it('결재 알림은 스펙 키를 실어도 **그 카드**로 간다(REQ-WEB-204)', async () => {
    const history = renderAt('/notifications');
    fireEvent.click((await screen.findAllByTestId('notification-row'))[0]!);
    await waitFor(() => expect(history.location.pathname).toBe('/inbox'));
    expect(history.location.search).toContain('focus=ap-1');
  });

  it('잇달아 같은 알림은 한 줄로 접고, 누르면 묶음을 함께 읽는다', async () => {
    renderAt('/notifications');
    const repeat = await screen.findByTestId('notification-repeat');
    expect(repeat.textContent).toBe('×2');
    expect(screen.getAllByTestId('notification-row')).toHaveLength(3);
    fireEvent.click(repeat.closest('li')!);
    await waitFor(() =>
      expect(posted.filter((u) => /n-c[12]\/read$/.test(u)).sort()).toEqual([
        '/me/notifications/n-c1/read',
        '/me/notifications/n-c2/read',
      ]),
    );
  });
});

describe('대상 읽기 규칙', () => {
  it('질문·발견은 제목이 먼저다 — 작업 키는 그 곁의 맥락이다', () => {
    expect(
      eventSubject({ question_title: '어느 쪽으로?', task_key: 'CLV-T-1', task_title: '작업' }),
    ).toEqual({ key: 'CLV-T-1', version: null, title: '어느 쪽으로?' });
  });

  it('키가 없으면 리뷰 브랜치·세션 기계가 그 자리에 선다', () => {
    expect(eventSubject({ review_branch: 'feat/x' }).key).toBe('feat/x');
    expect(eventSubject({ session_hostname: 'mac-02' }).key).toBe('mac-02');
  });

  it('세션 이벤트는 그 세션으로, 발견은 리뷰 센터의 그 발견으로 간다', () => {
    const base = { project_slug: 'clemvion' };
    expect(
      eventTarget({
        ...base,
        type: NERV_EVENT.SESSION_STALE,
        subject_type: 'agent_session',
        subject_id: 's-9',
      }),
    ).toEqual({ to: '/p/clemvion/sessions/s-9' });
    expect(
      eventTarget({ ...base, type: NERV_EVENT_PHASE2.FINDING_OPENED, finding_id: 'f-1' }),
    ).toEqual({
      to: '/p/clemvion/reviews',
      search: { finding: 'f-1' },
    });
  });

  it('떨어져 있는 같은 일은 접지 않는다 — 그 사이의 다른 일이 흐름이다', () => {
    const r = (id: string, type: string): Row => ({ id, type, subject_id: 'x' });
    const groups = collapseRepeats([r('1', 'a'), r('2', 'b'), r('3', 'a')], (e) =>
      String(e['type']),
    );
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1, 1]);
  });
});
