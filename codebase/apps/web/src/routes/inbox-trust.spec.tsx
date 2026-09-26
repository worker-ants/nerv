// 받은 요청을 믿고 누를 수 있게 — REQ-WEB-204 (2026-09-24 · UI/UX 검토 P05)
//
// 키보드 커서와 보고 있는 카드가 갈려 `a` 가 화면 밖의 다른 카드를 승인했다. 플랜·발견 카드는
// 대상을 가리키지 않았고, 스펙 카드는 버전·변경 요약·기다리는 세션을 말하지 않았다. 홈·알림·
// 에이전트의 링크는 모두 맨 `/inbox` 라 방금 누른 요청을 다시 찾아야 했고, 처리된 요청의 알림은
// 여전히 "승인 요청" 이었다. 코멘트 칸에는 보낼 키도 나올 키도 없었다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR, NERV_EVENT } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { setDecisionGraceForTesting } from '../features/inbox/decision-grace.js';
import { routeTree } from '../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const base = {
  project_slug: 'clemvion',
  org_slug: 'default',
  requested_by: '하나',
  requested_at: '2026-09-24T00:00:00Z',
  waiting_seconds: 600,
  decision: null,
  can_approve: true,
  can_bulk_approve: true,
  approvals_required: 1,
};
const spec = (n: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...base,
  id: `ap-${n}`,
  subject_type: 'spec_version',
  spec_key: `SPC-${n}`,
  spec_title: `문서 ${n}`,
  version_no: 1,
  ...over,
});

let pages: { items: Record<string, unknown>[]; next_cursor: string | null; total: number }[] = [];
let detail: Record<string, unknown> | null = null;
let notifications: Record<string, unknown>[] = [];
let posted: { url: string; body: Record<string, unknown> }[] = [];

// 결정의 **내용**을 본다 — 보내기 전 5초(REQ-WEB-237)는 decision-grace.spec.tsx 가 센다
beforeEach(() => {
  setDecisionGraceForTesting(0);
  pages = [{ items: [spec(1), spec(2), spec(3)], next_cursor: null, total: 3 }];
  detail = null;
  notifications = [];
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? 'GET') !== 'GET') {
        posted.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
        return { ok: true, status: 200, json: async () => ({ decision: 'approve' }) };
      }
      if (u.includes('/approvals?')) {
        const at = u.includes('cursor=page-2') ? 1 : 0;
        return { ok: true, status: 200, json: async () => pages[at] };
      }
      if (/\/approvals\/[^/?]+$/.test(u)) {
        return detail === null
          ? {
              ok: false,
              status: 409,
              json: async () => ({
                ok: false,
                code: NERV_ERROR.PRECONDITION,
                message: '',
                details: { kind: 'not_found' },
                retry_after_s: null,
                next_actions: [],
              }),
            }
          : { ok: true, status: 200, json: async () => detail };
      }
      if (/\/me\/notifications(\?|$)/.test(u)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: notifications, next_cursor: null }),
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
  setDecisionGraceForTesting();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const cards = (): HTMLElement[] => screen.getAllByTestId('approval-card');
const decisions = (): string[] =>
  posted
    .filter((p) => p.url.includes('/decision'))
    .map((p) => p.url.replace(/^.*\/approvals\//, ''));

describe('키는 보고 있는 카드에 꽂힌다 (REQ-WEB-204)', () => {
  it('누른 카드가 커서가 된다 — 셋째 카드를 누르고 a 를 치면 셋째가 승인된다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(cards()).toHaveLength(3));
    fireEvent.pointerDown(within(cards()[2] as HTMLElement).getByText('문서 3'));
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(decisions()).toEqual(['ap-3/decision']));
  });

  it('화면 밖의 카드에는 a 가 결정하지 않는다 — 데려와 보여 줄 뿐이다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(cards()).toHaveLength(3));
    // 첫 카드가 화면 위로 밀려났다(스크롤한 뒤 다른 카드를 읽는 중)
    vi.spyOn(cards()[0] as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      top: -400,
      bottom: -300,
      height: 100,
      width: 600,
      left: 0,
      right: 600,
      x: 0,
      y: -400,
      toJSON: () => ({}),
    });
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(cards()[0]?.getAttribute('data-nudged')).toBe('true'));
    expect(decisions()).toEqual([]);
  });
});

describe('그 카드로 착지한다 (?focus= · REQ-WEB-204)', () => {
  it('다음 쪽에 있어도 이어 받아 그 카드에 커서를 둔다', async () => {
    pages = [
      { items: [spec(1), spec(2)], next_cursor: 'page-2', total: 4 },
      { items: [spec(3), spec(4)], next_cursor: null, total: 4 },
    ];
    renderAt('/inbox?focus=ap-4');
    await waitFor(() => expect(cards()).toHaveLength(4));
    const landed = cards()[3]?.closest('li');
    await waitFor(() => expect(landed?.getAttribute('data-active')).toBe('true'));
  });

  it('끝내 없으면 이미 처리됐다고 누가 무엇으로 했는지 말한다', async () => {
    detail = {
      id: 'ap-9',
      decision: 'approve',
      decided_by: '지민',
      decided_at: '2026-09-24T00:00:00Z',
    };
    renderAt('/inbox?focus=ap-9');
    const note = await screen.findByTestId('focus-missing');
    await waitFor(() => expect(note.textContent).toContain('지민'));
    expect(note.textContent).toContain('승인');
  });

  it('결재가 아니거나 볼 수 없는 것이면 처리됐거나 없다고 말한다', async () => {
    renderAt('/inbox?focus=q-unknown');
    const note = await screen.findByTestId('focus-missing');
    await waitFor(() => expect(note.textContent).toContain('받은 요청에 없습니다'));
  });
});

describe('무엇을 · 누가 · 왜 (REQ-WEB-204)', () => {
  it('플랜 카드는 그 작업으로, 발견 카드는 그 발견으로 간다', async () => {
    pages = [
      {
        items: [
          {
            ...base,
            id: 'ap-p',
            subject_type: 'plan',
            task_key: 'CLV-T-PLAN01',
            task_title: '큰 작업',
            requested_hostname: 'mac-07',
            requested_agent_type: 'claude-code',
            session_waiting: true,
          },
          {
            ...base,
            id: 'ap-f',
            subject_type: 'finding',
            finding_id: '01a00000-0000-7000-8000-00000000f001',
            finding_title: '경계 밖 수정',
            finding_severity: 'critical',
          },
        ],
        next_cursor: null,
        total: 2,
      },
    ];
    renderAt('/inbox');
    await waitFor(() => expect(cards()).toHaveLength(2));
    const [plan, finding] = cards() as [HTMLElement, HTMLElement];
    expect(within(plan).getByTestId('subject-link').getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-PLAN01',
    );
    expect(within(plan).getByTestId('target-line').textContent).toContain('큰 작업');
    expect(within(plan).getByTestId('request-line').textContent).toContain('mac-07');
    expect(within(plan).getByTestId('session-waiting')).toBeDefined();
    expect(within(finding).getByTestId('subject-link').getAttribute('href')).toBe(
      '/p/clemvion/reviews?finding=01a00000-0000-7000-8000-00000000f001',
    );
    expect(within(finding).getByTestId('target-line').textContent).toContain('경계 밖 수정');
  });

  it('스펙 카드는 버전·티어·변경 요약과 직전 버전과의 변경분으로 가는 길을 준다', async () => {
    pages = [
      {
        items: [spec(1, { version_no: 3, gate_tier: 'T2', change_summary_md: '경계 절을 좁혔다' })],
        next_cursor: null,
        total: 1,
      },
    ];
    renderAt('/inbox');
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card = cards()[0] as HTMLElement;
    expect(within(card).getByTestId('gate-tier').textContent).toBe('T2');
    expect(within(card).getByTestId('change-summary').textContent).toBe('경계 절을 좁혔다');
    expect(within(card).getByTestId('diff-link').getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-1?diff=v2..v3',
    );
    // 근거 칸이 없는 옛 요청은 배지만 — 없는 점수를 0 으로 그리지 않는다
    expect(within(card).queryByTestId('gate-rationale')).toBeNull();
  });

  it('티어 곁에 근거가 선다 — 4축 합계 · 축별 점수 · 올린 신호 (REQ-WEB-240 · §6.4)', async () => {
    // 첫 승인 버전 가산으로 T2 가 된 문서는 배지만으로는 이유 없이 T2 였다. 사람이 왜
    // 불렸는지 알아야 무엇을 볼지 안다 — 문장은 이벤트의 판정 값으로 화면이 쓴다
    pages = [
      {
        items: [
          spec(1, {
            version_no: 1,
            gate_tier: 'T2',
            gate_score: 3,
            gate_axes: { side_effect: 2, sensitivity: 1, reversibility: 0, blast_radius: 0 },
            // 모르는 신호는 건너뛴다 — 서버가 먼저 새 신호를 싣는 날 키 이름을 찍지 않는다
            gate_signals: ['first_version', 'someday_signal'],
          }),
        ],
        next_cursor: null,
        total: 1,
      },
    ];
    renderAt('/inbox');
    await waitFor(() => expect(cards()).toHaveLength(1));
    const line = within(cards()[0] as HTMLElement).getByTestId('gate-rationale');
    expect(line.textContent).toBe(
      '4축 3점 (부작용 2 · 민감도 1 · 가역성 0 · 영향 범위 0) · 이 문서의 첫 승인 버전 → 티어 +1',
    );
    expect(line.querySelectorAll('[data-signal]')).toHaveLength(1);
  });
});

describe('코멘트 칸에서도 키보드로 끝낸다 (REQ-WEB-204)', () => {
  it('⌘↵ 는 코멘트, ⌘⇧↵ 는 칸의 말을 사유로 거절, Esc 는 카드로 돌아간다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(cards()).toHaveLength(3));
    const box = within(cards()[0] as HTMLElement).getByTestId('decision-comment');
    fireEvent.change(box, { target: { value: '범위가 넓다' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true, shiftKey: true });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toMatchObject({ decision: 'reject', comment: '범위가 넓다' });

    const second = within(cards()[1] as HTMLElement).getByTestId('decision-comment');
    fireEvent.change(second, { target: { value: '좋다' } });
    fireEvent.keyDown(second, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.body).toMatchObject({ decision: 'comment', comment: '좋다' });

    second.focus();
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(document.activeElement).toBe(cards()[1]);
  });
});

describe('알림은 그 카드로 가고, 처리된 요청은 그렇다고 말한다 (REQ-WEB-204)', () => {
  it('승인 요청 알림을 누르면 ?focus= 로 가고, 닫힌 요청에는 누가 처리했는지 붙는다', async () => {
    notifications = [
      {
        id: 'n1',
        state: 'read',
        event_type: NERV_EVENT.APPROVAL_REQUESTED,
        subject_type: 'approval',
        subject_id: 'ap-1',
        project_slug: 'clemvion',
        org_slug: 'default',
        actor_name: '하나',
        is_agent: false,
        occurred_at: '2026-09-24T00:00:00Z',
        resolution: 'approve',
        resolved_by: '지민',
      },
    ];
    const history = renderAt('/notifications');
    const row = await screen.findByTestId('notification-row');
    expect(within(row).getByTestId('notification-resolved').textContent).toBe(
      '(처리됨 · 지민 승인)',
    );
    fireEvent.click(row);
    await waitFor(() => expect(history.location.href).toBe('/inbox?focus=ap-1'));
  });
});
