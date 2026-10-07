// 받기 전은 "없다" 가 아니다 (REQ-WEB-293 · screens.md §1.5)
//
// REQ-WEB-198 은 "한 번도 받지 못했으면 골격 또는 에러 카드" 를 정했고, 옆의
// `empty-vs-failed.spec.tsx` 는 그중 **실패**를 본다. 이 파일은 **기다리는 동안**을 본다 —
// 응답이 오지 않는 채로 화면을 그리고, 빈 상태의 문장이 하나도 보이지 않는지 센다.
//
// 2026-10-07 까지 이 검사가 없었다. 프로젝트 단위 쿼리는 프로젝트 id 가 와야 부르는데
// (`enabled: projectId !== undefined`), TanStack Query v5 의 `isLoading` 은 `isPending && isFetching`
// 이라 그동안 false 였다. 그 값으로 골격을 고르던 스펙 트리 · 세션 · 최근 활동은 **빈 상태 → 골격 →
// 데이터** 순서로 바뀌었다 — 사람은 처음 본 "없습니다" 를 믿는다. 판정은 이제 `isPending` 이고
// lint 가 `isLoading` 을 막는다(eslint.config.js).

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ko } from '@nerv/schema';
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

/**
 * 받기 전에 보이면 안 되는 문장 — "없다" 를 말하는 빈 상태들. 자리 표시자(`{state}`)가 든 문장은
 * 그대로 찾을 수 없어 뺀다. 카탈로그가 정본이라 문장을 여기 다시 적지 않는다.
 */
const EMPTY_KEYS = [
  'specs.empty',
  'project.no_events',
  'project.no_sessions',
  'home.no_activity',
  'home.nothing_waiting',
  'sessions.none_running',
  'tasks.empty_column',
  'tasks.ready_empty',
  'notif.empty',
  'inbox.empty_decided',
  // 오른쪽 열 · 리뷰 · 설정 — 2단계(REQ-WEB-294)
  'spec.no_open_comments',
  'spec.attach.empty',
  'spec.derived_tasks.empty',
  'common.not_yet',
  'reviews.gate.empty',
  'settings.workspace.no_projects',
  'invite.none',
  'session.no_trajectory',
  // 내 정보가 오기 전의 "없음" — 3단계(REQ-WEB-295). 이 사람은 조직이 있다
  'onboarding.step1',
] as const satisfies readonly (keyof typeof ko)[];

/**
 * 빈 상태가 문장 대신 표시로 남는 자리 — 그리고 **모르는 권한을 없는 권한으로** 그린 자리(REQ-WEB-295):
 * "admin 만 할 수 있습니다" 안내 · 문서를 시작할 수 없다는 말 · 남의 세션이라는 말 · 프로젝트가 없다는 경고
 */
const EMPTY_TEST_IDS = [
  'spec-start',
  'spec-tree-start',
  'ready-empty',
  'requirements-empty',
  'read-only-notice',
  'spec-start-ask',
  'steer-forbidden',
  'token-no-project',
];

/**
 * 받기 전의 "0" — 요약 줄의 큰 수 · 개요 커버리지의 칸 · 스펙 상세 레일 탭의 수. 응답이 오지 않았는데 0 이면
 * 그것은 모르는 것이 아니라 없다는 말이다(REQ-WEB-294).
 */
function zeroClaims(): string[] {
  const zero = (el: Element): boolean => /^0\+?$/.test((el.textContent ?? '').trim());
  return [
    ...[...document.querySelectorAll('.text-metric')].filter(zero).map(() => 'metric:0'),
    ...[...document.querySelectorAll('dd')].filter(zero).map(() => 'dd:0'),
    ...[...document.querySelectorAll('[data-testid^="rail-tab-"] > span')]
      .filter(zero)
      .map(() => 'rail-tab:0'),
  ];
}

/** 응답이 오지 않는 요청 — 이 파일의 모든 검사가 "기다리는 동안" 이다 */
const never = (): Promise<never> => new Promise<never>(() => undefined);

const ME = {
  id: 'u1',
  email: 'me@example.com',
  display_name: '나',
  avatar_url: null,
  memberships: [
    {
      id: 'm1',
      roles: ['admin'],
      org_id: 'o1',
      org_slug: 'default',
      org_name: 'NERV',
      project_id: 'p1',
      project_slug: 'clemvion',
      project_name: 'clemvion',
    },
    // 조직 admin 이다 — 받은 뒤에는 "admin 만" 안내가 보이지 않아야 맞다(받기 전에 보이면 그것이 결함이다)
    {
      id: 'm0',
      roles: ['admin'],
      org_id: 'o1',
      org_slug: 'default',
      org_name: 'NERV',
      project_id: null,
      project_slug: null,
      project_name: null,
    },
  ],
};

/**
 * 무엇이 오는가 — `nothing` 은 모든 요청이 멈춘 처음 순간이고, `scope` 는 내 정보 · 프로젝트 · 연 문서까지
 * 받은 뒤 화면의 나머지 데이터만 기다리는 순간이다. 꺼진 쿼리의 틈은 앞의 것에서 드러나고, 문서가 온 뒤에야
 * 그려지는 오른쪽 열은 뒤의 것에서 드러난다.
 */
type Arrived = 'nothing' | 'scope' | 'preview';

const SPEC = {
  spec_id: 's-1',
  key: 'SPC-X',
  title: '위젯 상태',
  type: 'feature',
  project_id: 'p1',
  version_id: 'v-1',
  version_no: 1,
  doc_status: 'draft',
  body_md: '# 위젯 상태\n\n본문',
  requirements: [],
  recheck: { count: 0, specs: [] },
};
let arrived: Arrived = 'nothing';

/** 초대 미리보기 — `preview` 순간에는 이것만 온다(내 정보는 아직이다) */
const PREVIEW = {
  id: 'inv-1',
  org_slug: 'beta',
  org_name: 'Beta',
  project_slug: null,
  role: 'developer',
  invited_by: '하나',
  state: 'pending',
  email_hint: 'm***@example.com',
};

function reply(path: string): unknown {
  if (arrived === 'nothing') return undefined;
  if (arrived === 'preview') return /^\/invitations\/tok-1(\?|$)/.test(path) ? PREVIEW : undefined;
  if (/^\/me(\?|$)/.test(path)) return ME;
  if (/^\/orgs\/[^/]+\/projects/.test(path))
    return [{ id: 'p1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }];
  if (/^\/projects\/clemvion(\?|$)/.test(path))
    return { id: 'p1', slug: 'clemvion', name: 'clemvion', gate_policy: {} };
  if (/^\/projects\/clemvion\/specs\/SPC-X(\?|$)/.test(path)) return SPEC;
  return undefined;
}

/** 나간 요청의 경로 — `scope` 의 검사는 프로젝트 id 가 있어야 나가는 요청을 보고 나서 센다 */
let requested: string[] = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  arrived = 'nothing';
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url).replace(/^.*\/api\/v1/, '');
      requested.push(path);
      const body = reply(path);
      if (body === undefined) return never();
      return { ok: true, status: 200, json: async () => body };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderAt(path: string, settled: RegExp): Promise<void> {
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
  // 본문이 그려질 때까지 — 라우트 조각이 오기 전의 빈 본문을 "아무 말도 하지 않았다" 로 세지 않는다
  // (골격도 "불러오는 중…" 을 글자로 갖는다)
  await waitFor(() => {
    expect(document.querySelector('main')?.textContent ?? '').not.toBe('');
  });
  // 내 정보 · 프로젝트가 온 뒤라면 그것을 기다려 부르는 요청까지 나간 뒤에 센다 — 처음 순간은 `nothing` 이 본다
  if (arrived === 'scope') {
    await waitFor(() => expect(requested.some((p) => settled.test(p))).toBe(true));
  }
}

/** 받기 전에 보인 "없다" — 비어 있어야 한다 */
function emptyClaims(): string[] {
  const text = document.body.textContent ?? '';
  return [
    ...EMPTY_KEYS.filter((key) => text.includes(ko[key])),
    ...EMPTY_TEST_IDS.filter((id) => screen.queryAllByTestId(id).length > 0),
    ...zeroClaims(),
  ];
}

/** 화면과, 내 정보 · 프로젝트가 온 뒤에야 나가는 요청(그것이 나갔으면 `scope` 의 순간이다) */
const ORG_PROJECTS = /^\/orgs\/default\/projects/;
const SCREENS: [string, RegExp][] = [
  ['/', /^\/projects\/clemvion\/events/],
  ['/inbox', ORG_PROJECTS],
  ['/inbox?state=decided', ORG_PROJECTS],
  ['/notifications', ORG_PROJECTS],
  ['/p/clemvion', /^\/projects\/clemvion\/events/],
  ['/p/clemvion/specs', /^\/projects\/clemvion\/specs\/tree/],
  ['/p/clemvion/specs/SPC-X', /^\/projects\/clemvion\/specs\/tree/],
  // 오른쪽 열의 탭마다 — 문서가 온 뒤에 열이 그려지므로 그 열이 부르는 요청을 기다린다
  ['/p/clemvion/specs/SPC-X?rail=comments', /^\/projects\/clemvion\/specs\/SPC-X\/comments/],
  ['/p/clemvion/specs/SPC-X?rail=attachments', /^\/projects\/clemvion\/specs\/SPC-X\/attachments/],
  ['/p/clemvion/specs/SPC-X?rail=versions', /^\/projects\/clemvion\/specs\/SPC-X\/versions/],
  ['/p/clemvion/specs/SPC-X?rail=requirements', /^\/projects\/clemvion\/tasks\?/],
  ['/p/clemvion/tasks', /^\/projects\/clemvion\/tasks\?/],
  ['/p/clemvion/sessions', /^\/projects\/clemvion\/sessions/],
  ['/p/clemvion/reviews', /^\/projects\/clemvion\/findings/],
  ['/settings/projects', ORG_PROJECTS],
  // 역할로 칸을 잠그고 안내를 띄우는 화면들 — 3단계(REQ-WEB-295)
  ['/settings/org', ORG_PROJECTS],
  ['/settings/org-tokens', ORG_PROJECTS],
  ['/settings/members', ORG_PROJECTS],
  ['/settings/gates', ORG_PROJECTS],
  ['/settings/tokens', ORG_PROJECTS],
  ['/onboarding', ORG_PROJECTS],
];

describe('받기 전은 "없다" 가 아니다 (REQ-WEB-293)', () => {
  describe.each<[Arrived, string]>([
    ['nothing', '아무 응답도 오지 않은 동안'],
    ['scope', '내 정보 · 프로젝트만 온 동안'],
  ])('%s — %s', (state) => {
    it.each(SCREENS)('%s — 빈 상태 대신 골격', async (path, settled) => {
      arrived = state;
      await renderAt(path, settled);
      expect(emptyClaims()).toEqual([]);
    });
  });
});

describe('셸 · 늘 보이는 절은 자리를 먼저 잡는다 (REQ-WEB-296)', () => {
  it('아무 응답도 없을 때 — 조직 전환기 · 사용자 메뉴 · 프로젝트 목록의 자리에 골격', async () => {
    await renderAt('/', ORG_PROJECTS);
    expect(screen.getByTestId('org-switcher-skeleton')).toBeTruthy();
    expect(screen.getByTestId('user-menu-skeleton')).toBeTruthy();
    expect(
      screen.getByTestId('rail-projects').querySelector('[data-testid="skeleton"]'),
    ).not.toBeNull();
  });

  it('내 정보 · 목록이 온 뒤 — 셸의 골격은 사라진다', async () => {
    arrived = 'scope';
    await renderAt('/p/clemvion', /^\/projects\/clemvion\/events/);
    expect(screen.queryByTestId('org-switcher-skeleton')).toBeNull();
    expect(screen.queryByTestId('user-menu-skeleton')).toBeNull();
    expect(
      screen.getByTestId('rail-projects').querySelector('[data-testid="skeleton"]'),
    ).toBeNull();
  });

  it('계정의 알림 탭 — 받기 전에 빈 탭이 아니라 절마다 골격', async () => {
    arrived = 'scope';
    await renderAt('/settings/account?tab=notifications', ORG_PROJECTS);
    await waitFor(() =>
      expect(
        document.querySelector('main')?.querySelectorAll('[data-testid="skeleton"]').length ?? 0,
      ).toBeGreaterThanOrEqual(2),
    );
  });
});

describe('내 정보가 오기 전의 역할은 "없음" 이 아니다 (REQ-WEB-295)', () => {
  it('초대 — 로그인했는지 모르는 동안 가입 · 로그인 단추를 보이지 않는다', async () => {
    arrived = 'preview';
    const history = createMemoryHistory({ initialEntries: ['/invite/tok-1'] });
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
    // 미리보기는 왔다 — 조직 이름이 보이면 그 뒤의 단추 자리를 센다
    await screen.findAllByText(/Beta/);
    expect(screen.queryByTestId('invite-signup')).toBeNull();
    expect(screen.queryByTestId('invite-accept')).toBeNull();
  });
});
