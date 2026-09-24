// 좁은 화면의 셸 — 사이드바가 서랍이 된다 (screens.md §1.3 · REQ-WEB-164)
//
// **jsdom 은 폭을 모른다.** 그래서 여기서 지키는 것은 "몇 px 에서 어떻게 보이는가"가 아니라
// 그보다 먼저 깨지는 것들이다: 서랍을 여는 길이 있는가 · 그 안에 프로젝트 탭 다섯이 있는가 ·
// 닫히는 길이 셋 다 있는가 · **그것이 사이드바와 같은 한 벌인가.** 폭의 판정은 L3 가 실제
// 390px 뷰포트에서 본다(test/e2e/shots.spec.ts 의 `NERV_SHOT_VIEWPORT=mobile`).
//
// 두 벌이 아니라는 것이 이 스위트의 핵심이다 — `hidden`/`block` 으로 사이드바와 서랍을
// 따로 그리면 화면에는 하나만 보이지만 DOM 에는 둘이 남고, 그때 스펙 트리의 펼침 상태는
// 두 벌이 각자 갖는다(REQ-WEB-161 이 S6 에서 지난 자리다).

import { LocaleProvider } from '../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <RouterProvider router={router} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const json = path.includes('/projects')
        ? [{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }]
        : path.includes('/me')
          ? {
              id: 'u-1',
              display_name: '지민',
              memberships: [
                { org_slug: 'nerv', org_name: 'NERV', project_slug: 'clemvion', roles: ['admin'] },
              ],
            }
          : { items: [], summary: {}, next_cursor: null, memberships: [], count: 0 };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** [☰] 를 눌러 서랍을 연다 — 좁은 화면에서 사람이 하는 그 동작이다 */
async function openDrawer(): Promise<HTMLElement> {
  const toggle = await screen.findByTestId('nav-drawer-toggle');
  fireEvent.click(toggle);
  const rail = screen.getByTestId('nav-rail');
  await waitFor(() => expect(rail.dataset['open']).toBe('true'));
  return rail;
}

describe('좁은 화면의 셸 서랍 (REQ-WEB-164)', () => {
  it('프로젝트 탭 다섯이 서랍 안에 있다 — 좁은 화면에서 갈 길이 사라지지 않는다', async () => {
    renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByText('작업 보드')).toBeDefined());

    const rail = await openDrawer();
    for (const [name, href] of [
      ['개요', '/p/clemvion'],
      ['스펙', '/p/clemvion/specs'],
      ['작업', '/p/clemvion/tasks'],
      ['세션', '/p/clemvion/sessions'],
      ['리뷰', '/p/clemvion/reviews'],
    ] as const) {
      const link = [...rail.querySelectorAll('nav a')].find((a) => a.textContent?.includes(name));
      expect(link?.getAttribute('href'), name).toBe(href);
    }
  });

  it('서랍과 사이드바는 **같은 한 벌**이다 — DOM 에 두 벌이 남지 않는다', async () => {
    renderAt('/p/clemvion/specs');
    await waitFor(() => expect(screen.getAllByTestId('nav-rail').length).toBe(1));

    await openDrawer();
    // 열어도 늘지 않는다. 늘어난다면 그때부터 트리의 펼침 상태가 둘로 갈린다.
    expect(screen.getAllByTestId('nav-rail').length).toBe(1);
    // 트리도 한 벌이다 — 로딩 골격이든 실물이든 같은 자리에 하나만 선다
    expect(screen.queryAllByTestId('spec-tree').length).toBeLessThanOrEqual(1);
    expect(screen.queryAllByTestId('tree-skeleton').length).toBeLessThanOrEqual(1);
  });

  it('닫히는 길이 셋이다 — 링크 · Esc · 뒷막', async () => {
    renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByText('작업 보드')).toBeDefined());

    // ① 서랍 안에서 어디론가 떠나면 닫힌다
    const rail = await openDrawer();
    const specs = [...rail.querySelectorAll('nav a')].find((a) =>
      a.textContent?.includes('스펙'),
    ) as HTMLElement;
    fireEvent.click(specs);
    await waitFor(() => expect(rail.dataset['open']).toBe('false'));

    // ② Esc
    await openDrawer();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(rail.dataset['open']).toBe('false'));

    // ③ 뒷막 — 서랍 밖을 누른다
    await openDrawer();
    fireEvent.click(screen.getByTestId('nav-drawer-backdrop'));
    await waitFor(() => expect(rail.dataset['open']).toBe('false'));
  });

  it('배지는 서랍이 아니라 헤더에 남는다 — 열어 봐야 아는 숫자는 배지가 아니다', async () => {
    renderAt('/p/clemvion');
    const rail = await openDrawer();
    // 배지는 모든 조직을 센다 — 이름이 그 사실을 말한다(REQ-WEB-193)
    for (const name of ['받은 요청 — 모든 조직', '알림 — 모든 조직'] as const) {
      const link = screen.getByRole('link', { name });
      expect(rail.contains(link)).toBe(false);
    }
  });

  it('프로젝트 밖에서도 서랍이 선다 — 조직과 도움말이 거기 있다', async () => {
    renderAt('/inbox');
    await waitFor(() => expect(screen.getAllByText(/받은 요청/).length).toBeGreaterThan(0));

    const rail = await openDrawer();
    expect(rail.textContent).toContain('조직');
    expect(rail.textContent).toContain('도움말');
    // 프로젝트가 없으면 탭도 트리도 없다 — 빈 칸을 그리지 않는다
    expect(rail.querySelector('nav')).toBeNull();
    expect(screen.queryByText('스펙 트리')).toBeNull();
  });
});
