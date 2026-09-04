// 권한 판정 — **화면과 서버가 같은 규칙을 써야 한다.**
//
// 사람 보고(2026-08-24): "admin 계정인데 스펙 메타 편집이 잠겨 있다." 원인은 화면이
// 멤버십 **한 행**만 보고 역할을 판정한 것이었다. 조직 단위로만 소속된 admin 은
// `project_slug === null` 행 하나를 갖는데, 프로젝트 슬러그로 찾으면 그 행이 걸리지
// 않아 "아무 역할 없음"이 된다. 서버(`assertMembership`)는 이미 합집합으로 판정하고
// 있었으므로, **화면이 서버가 허용할 일을 못 한다고 말하고 있었다.**
//
// 이 파일은 그 규칙(합집합 · 조직 경계)과, 그것이 실제 화면에서 지켜지는지를 함께 본다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from './i18n.js';
import { RealtimeProvider } from './realtime.js';
import { rolesInOrg, rolesInProject } from './session.js';
import { routeTree } from '../routeTree.gen';
import type { Me } from './session.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

function me(memberships: Record<string, unknown>[]): Me {
  return { id: 'u-1', email: 'a@b.c', display_name: '지민', avatar_url: null, memberships } as Me;
}

const ORG_ADMIN = me([
  { org_slug: 'default', org_name: 'default', project_slug: null, roles: ['admin'] },
]);

describe('rolesInProject — 서버의 assertMembership 과 같은 규칙', () => {
  it('조직 단위 멤버십은 그 조직의 모든 프로젝트에 적용된다 (사람 보고의 원인)', () => {
    expect(rolesInProject(ORG_ADMIN, 'default', 'clemvion')).toEqual(['admin']);
    expect(rolesInProject(ORG_ADMIN, 'default', 'other')).toEqual(['admin']);
  });

  it('겸직은 합집합이다 — 하나를 고르면 절반이 사라진다', () => {
    const both = me([
      { org_slug: 'default', org_name: 'default', project_slug: null, roles: ['admin'] },
      { org_slug: 'default', org_name: 'default', project_slug: 'clemvion', roles: ['planner'] },
    ]);
    expect(rolesInProject(both, 'default', 'clemvion').sort()).toEqual(['admin', 'planner']);
    expect(rolesInOrg(both, 'default').sort()).toEqual(['admin', 'planner']);
  });

  it('다른 프로젝트의 역할은 새지 않는다', () => {
    const scoped = me([
      { org_slug: 'default', org_name: 'default', project_slug: 'other', roles: ['admin'] },
    ]);
    expect(rolesInProject(scoped, 'default', 'clemvion')).toEqual([]);
  });

  it('다른 조직의 조직 단위 역할도 새지 않는다 — 조직이 경계다', () => {
    const cross = me([
      { org_slug: 'acme', org_name: 'Acme', project_slug: null, roles: ['admin'] },
      { org_slug: 'default', org_name: 'default', project_slug: 'clemvion', roles: ['viewer'] },
    ]);
    expect(rolesInProject(cross, 'default', 'clemvion')).toEqual(['viewer']);
  });

  it('모르는 것은 권한 없음이다 — 로딩 중에 문이 열려선 안 된다', () => {
    expect(rolesInProject(undefined, 'default', 'clemvion')).toEqual([]);
    expect(rolesInProject(ORG_ADMIN, null, 'clemvion')).toEqual([]);
  });
});

// ── 화면에서도 지켜지는가 ────────────────────────────────────────────────────

/** 발급 요청의 본문을 담아 둔다 — 화면이 **무엇을 보냈는지**가 이 결함의 자리다. */
const sentBodies: Record<string, unknown>[] = [];

function stubFetch(who: Me = ORG_ADMIN): void {
  sentBodies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const path = String(url);
      if (init?.method === 'POST' && path.includes('/me/tokens')) {
        sentBodies.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>);
        return { ok: true, status: 200, json: async () => ({ token: 'nerv_x', prefix: 'nerv_x' }) };
      }
      const json = path.includes('/me/tokens')
        ? { items: [] }
        : path.includes('/projects/')
          ? { id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', gate_policy: {} }
          : path.includes('/projects')
            ? [{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }]
            : path.includes('/me')
              ? who
              : path.includes('/specs/')
                ? { id: 's-1', key: 'SPC-CWC-007', title: '스펙', project_id: 'p-1' }
                : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
}

function renderAt(path: string): void {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
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

beforeEach(() => {
  localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('조직 단위 admin 이 admin 으로 대접받는다', () => {
  it('스펙 메타 편집이 열려 있다 (사람 보고 2026-08-24)', async () => {
    renderAt('/p/clemvion/specs/SPC-CWC-007');
    await waitFor(() => expect(screen.getByRole('button', { name: /메타/ })).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /메타/ }));
    await waitFor(() => expect(screen.getByText(/제목/)).toBeDefined());
    // 읽기 전용 경고가 뜨면 그것이 곧 이 결함이다
    expect(screen.queryByText(/읽기 전용/)).toBeNull();
  });

  it('게이트 정책 탭이 편집 가능하다 — `role` 은 없는 필드였고 누구에게나 잠겨 있었다', async () => {
    renderAt('/settings/gates');
    await waitFor(() => expect(screen.getByText('게이트 정책', { selector: 'h1' })).toBeDefined());
    // 프로젝트 목록이 도착해야 스코프가 정해진다 — 그 전에는 저장이 잠겨 있는 것이 맞다
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '저장' }).hasAttribute('disabled')).toBe(false),
    );
    expect(screen.queryByText(/역할만 가능합니다/)).toBeNull();
  });

  it('토큰 발급 버튼이 눌린다 — 프로젝트는 헤더가 고른 것을 쓴다', async () => {
    renderAt('/settings/tokens');
    await waitFor(() =>
      expect(screen.getByText('에이전트 토큰', { selector: 'h1' })).toBeDefined(),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '발급' }).hasAttribute('disabled')).toBe(false),
    );
  });
});

/**
 * 화면이 보여준 것과 발급되는 것이 같은가 (2026-09-04 · 실측).
 *
 * 초기 선택값이 상수 `['spec:read','task:claim']` 이라, 역할에 `task:claim` 이 없는 사람에게는
 * 그 칸이 **잠긴 채 체크 해제로** 보이는데 발급 본문에는 실려 갔다. 사용 시점에 역할과
 * 교집합을 내므로 권한이 새지는 않았지만, 발급된 토큰의 스코프 표는 그 사람이 고른 적 없는
 * 값을 보여줬다 — 화면이 자기가 한 일을 잘못 말한 것이다.
 */
describe('발급 본문은 역할이 허용한 것만 담는다', () => {
  const VIEWER = me([
    { org_slug: 'default', org_name: 'default', project_slug: 'clemvion', roles: ['viewer'] },
  ]);

  it('viewer 는 잠긴 task:claim 을 발급받지 않는다', async () => {
    vi.unstubAllGlobals();
    stubFetch(VIEWER);
    renderAt('/settings/tokens');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '발급' }).hasAttribute('disabled')).toBe(false),
    );

    fireEvent.click(screen.getByRole('button', { name: '발급' }));
    await waitFor(() => expect(sentBodies.length).toBe(1));
    expect(sentBodies[0]?.['scopes']).toEqual(['spec:read']);
  });
});
