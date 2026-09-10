// 알림 목록 — 열 정렬과 일괄 읽음 (REQ-WEB-137 · 2026-09-04 사람 보고)
//
// 두 가지가 같은 화면에서 어긋나 있었다.
//
//   ① 읽은 행과 안 읽은 행의 **열이 어긋났다.** [읽음] 단추를 안 읽은 행에만 그렸는데,
//      `opacity-0` 이어도 **자리는 차지한다** — 보이지 않는 것과 자리를 차지하지 않는
//      것은 다르다. 그래서 프로젝트·시각 열이 행마다 다른 x 에 앉아 목록이 두 벌처럼
//      보였다.
//   ② 안 읽은 알림이 **695건**이었는데 한 건씩 지우는 것이 유일한 길이었다. 지울 수
//      없는 배지는 곧 읽지 않는 배지가 된다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_EVENT } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { deepLinkFor } from './notifications.js';
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

/** 읽음·안읽음이 섞인 목록 — 어긋남은 섞였을 때만 보인다 */
const ITEMS = [
  {
    id: 'n1',
    state: 'read',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-DSN-UI',
  },
  {
    id: 'n2',
    state: 'read',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-AREA-RANK',
  },
  {
    id: 'n3',
    state: 'unread',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-VISION',
  },
  {
    id: 'n4',
    state: 'unread',
    event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
    spec_key: 'SUD-AREA-PLAY',
  },
].map((n) => ({
  ...n,
  project_slug: 'sudoku',
  actor_name: '지민',
  is_agent: false,
  occurred_at: '2026-09-04T00:00:00Z',
}));

let posted: string[] = [];
/** 어떤 주소를 물었는가 — 등급 필터가 서버 축을 쓰는지 보는 검사가 이 값을 읽는다 */
let asked: string[] = [];

beforeEach(() => {
  posted = [];
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url);
      asked.push(u);
      if (init?.method === 'POST') {
        posted.push(u);
        return { ok: true, status: 200, json: async () => ({ ok: true, marked: 2 }) };
      }
      if (u.includes('unread-count')) {
        return { ok: true, status: 200, json: async () => ({ count: 695, immediate: 12 }) };
      }
      if (u.includes('/me/notifications')) {
        return { ok: true, status: 200, json: async () => ({ items: ITEMS, next_cursor: null }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          memberships: [{ org_slug: 'default', project_slug: 'sudoku', roles: ['planner'] }],
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

/** 히스토리를 돌려준다 — 도착한 **주소**를 세는 검사가 그것을 읽는다(라우터 제네릭을 타지 않는다) */
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

describe('알림 목록 — 읽음과 안읽음이 같은 열에 선다', () => {
  /**
   * **행마다 자식 수가 같아야 열이 맞는다.** 단추를 조건부로 그리면 안 읽은 행만 자식이
   * 하나 많아지고, `opacity-0` 은 그 자리를 없애 주지 않는다. 동작 칸을 모든 행에 두어
   * 그 자리를 항상 확보한다.
   */
  it('읽은 행과 안 읽은 행의 열 수가 같다', async () => {
    renderAt('/notifications');
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(4));

    const rows = screen.getAllByTestId('notification-row');
    const counts = rows.map((r) => r.children.length);
    expect(new Set(counts).size).toBe(1);

    // 섞여 있는 것이 맞는지도 본다 — 전부 읽음이면 이 테스트는 아무것도 지키지 않는다
    const states = rows.map((r) => r.getAttribute('data-state'));
    expect(new Set(states)).toEqual(new Set(['read', 'unread']));
  });
});

describe('일괄 읽음 (REQ-WEB-137)', () => {
  it('[모두 읽음] 이 한 번의 요청으로 치운다', async () => {
    renderAt('/notifications');
    await waitFor(() => expect(screen.getByTestId('mark-all-read')).toBeDefined());

    fireEvent.click(screen.getByTestId('mark-all-read'));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toContain('/me/notifications/read-all');
  });

  /** 치울 것이 없으면 단추도 없다 — 누를 수 없는 단추는 화면의 소음이다 */
  it('안 읽은 것이 없으면 단추가 없다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('unread-count')) {
          return { ok: true, status: 200, json: async () => ({ count: 0 }) };
        }
        if (u.includes('/me/notifications')) {
          return { ok: true, status: 200, json: async () => ({ items: [], next_cursor: null }) };
        }
        return { ok: true, status: 200, json: async () => ({ items: [], memberships: [] }) };
      }),
    );
    renderAt('/notifications');
    await waitFor(() => expect(screen.queryByTestId('mark-all-read')).toBeNull());
  });
});

/**
 * **등급으로 나눠 본다**(2026-09-07 · REQ-WEB-149 · FR-12). 배지가 전체 unread 를 세면
 * 결정이 필요한 것이 배경 활동에 묻힌다 — 실측 767건 중 99건이 결정이었다.
 */
describe('REQ-WEB-149 — 결정이 필요한 것만 세고, 나눠 본다', () => {
  it('결정 대기 수를 따로 보이고 필터가 서버에 그 축을 싣는다', async () => {
    renderAt('/notifications');
    await screen.findByText(/결정 대기 12건/);

    fireEvent.click(screen.getByTestId('filter-immediate'));
    await waitFor(() => expect(asked.some((u) => u.includes('importance=immediate'))).toBe(true));
  });
});

/**
 * **알림은 "무슨 일이 있었다" 로 끝나지 않는다**(REQ-WEB-163 · ui-wireframes §4.5).
 *
 * 스펙 알림이 정확히 그랬다 — "v4 가 승인됐다" 를 전하고 본문 전체를 열어, 바뀐 자리는
 * 사람이 눈으로 찾아야 했다. 바뀐 자리를 아는 화면(`?diff=`)은 처음부터 있었고 알림만
 * 그 길을 몰랐다.
 *
 * 이 결함은 **조용하다** — 주소가 틀려도 화면은 열리고 사람은 "원래 이런가 보다" 한다.
 * 그래서 검사가 세는 것은 화면이 아니라 **주소**다.
 */
describe('REQ-WEB-163 — 알림이 뷰 상태까지 싣는다', () => {
  const spec = (over: Record<string, unknown>): Record<string, unknown> => ({
    project_slug: 'clemvion',
    spec_key: 'SPC-CWC-007',
    ...over,
  });

  it('승인 알림은 직전 버전과의 diff 로 간다', () => {
    expect(deepLinkFor(spec({ event_type: NERV_EVENT.SPEC_APPROVED, version_no: 4 }))).toEqual({
      to: '/p/clemvion/specs/SPC-CWC-007',
      search: { diff: 'v3..v4' },
    });
  });

  it('반려 알림도 같은 축이다 — 무엇을 고쳐야 하는지가 diff 에 있다', () => {
    expect(deepLinkFor(spec({ event_type: NERV_EVENT.SPEC_REJECTED, version_no: 2 }))).toEqual({
      to: '/p/clemvion/specs/SPC-CWC-007',
      search: { diff: 'v1..v2' },
    });
  });

  it('v1 은 이전이 없다 — 뜻 없는 인자를 주소에 남기지 않는다', () => {
    // 본문이 곧 그 버전이다. `?diff=v0..v1` 은 존재하지 않는 비교이고
    // `?v=1` 은 기본 화면과 같은 것을 가리키는 군더더기다.
    expect(deepLinkFor(spec({ event_type: NERV_EVENT.SPEC_APPROVED, version_no: 1 }))).toEqual({
      to: '/p/clemvion/specs/SPC-CWC-007',
    });
  });

  it('버전이 없는 알림은 본문이다 — 재검토 요청은 subject 가 spec 이다', () => {
    expect(
      deepLinkFor(spec({ event_type: NERV_EVENT.SPEC_RECHECK_REQUESTED, subject_type: 'spec' })),
    ).toEqual({ to: '/p/clemvion/specs/SPC-CWC-007' });
  });

  /**
   * `spec.comment_added` 는 **두 곳에서 난다**. 갈라 주는 것은 `subject_type` 이고,
   * 이 둘을 섞으면 한쪽이 반드시 틀린다 — 그리고 틀린 쪽은 빈 화면으로 끝난다.
   */
  it('본문 코멘트는 코멘트 레일을 연다', () => {
    expect(
      deepLinkFor(spec({ event_type: NERV_EVENT.SPEC_COMMENT_ADDED, subject_type: 'spec' })),
    ).toEqual({ to: '/p/clemvion/specs/SPC-CWC-007', search: { rail: 'comments' } });
  });

  it('리뷰 결정 "코멘트" 는 레일을 열지 않는다 — 그 코멘트는 목록에 없다', () => {
    // 이쪽은 `spec_comment` 행을 만들지 않는다(코멘트가 이벤트 payload 에만 있다).
    // 레일을 열면 **빈 목록**이 뜨고, 읽으러 온 사람은 사라진 코멘트를 찾게 된다.
    // 문서는 draft 로 되돌아왔으므로 데려갈 곳은 그 문서 자신이다.
    expect(
      deepLinkFor(
        spec({
          event_type: NERV_EVENT.SPEC_COMMENT_ADDED,
          subject_type: 'spec_version',
          version_no: 3,
        }),
      ),
    ).toEqual({ to: '/p/clemvion/specs/SPC-CWC-007' });
  });

  it('스펙이 아닌 알림은 그대로다 — 이 변경이 다른 축을 건드리지 않았다', () => {
    expect(
      deepLinkFor({
        project_slug: 'clemvion',
        task_key: 'CLV-T-0CFQC2',
        event_type: NERV_EVENT.TASK_BLOCKED,
      }),
    ).toEqual({ to: '/p/clemvion/tasks/CLV-T-0CFQC2' });
    expect(
      deepLinkFor({ project_slug: 'clemvion', event_type: NERV_EVENT.APPROVAL_REQUESTED }),
    ).toEqual({ to: '/inbox' });
  });

  /**
   * 위 검사들은 **객체**를 세고, 이것은 라우터가 그 객체를 **주소로** 만드는지를 센다.
   * 둘은 다른 사실이다 — `to` 에 질의 문자열을 이어 붙이던 시절이면 위는 통과하고
   * 이것이 붉어진다.
   */
  it('행을 누르면 그 주소로 실제로 간다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('unread-count')) {
          return { ok: true, status: 200, json: async () => ({ count: 1, immediate: 0 }) };
        }
        if (u.includes('/me/notifications')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  id: 'n9',
                  state: 'read',
                  event_type: NERV_EVENT.SPEC_APPROVED,
                  subject_type: 'spec_version',
                  version_no: 4,
                  spec_key: 'SPC-CWC-007',
                  project_slug: 'clemvion',
                  occurred_at: '2026-09-10T00:00:00Z',
                },
              ],
              next_cursor: null,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], memberships: [], count: 0, summary: {} }),
        };
      }),
    );
    const history = renderAt('/notifications');
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(1));

    fireEvent.click(screen.getAllByTestId('notification-row')[0] as HTMLElement);
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/specs/SPC-CWC-007'));
    expect(history.location.search).toContain('diff=v3..v4');
  });
});
