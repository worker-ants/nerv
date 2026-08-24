// 도움말 — GNB 진입점과 매뉴얼 라우트 (screens.md §2.10)
//
// 매뉴얼은 **찾을 수 있어야 매뉴얼이다.** 문서를 아무리 잘 써도 헤더에서 가는 길이 없으면
// 주소를 아는 사람만 읽는다. 그래서 여기서 보는 것은 본문이 아니라 **경로**다:
// 헤더 → 메뉴 → 장, 그리고 지금 화면이 어느 장으로 이어지는가.

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
                {
                  org_slug: 'default',
                  org_name: 'default',
                  project_slug: 'clemvion',
                  roles: ['admin'],
                },
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

describe('GNB 도움말', () => {
  it('헤더에 도움말 메뉴가 있고 제품 매뉴얼로 간다', async () => {
    renderAt('/');
    await waitFor(() => expect(screen.getByTestId('help-menu')).toBeDefined());

    fireEvent.click(screen.getByTestId('help-menu'));
    expect(screen.getByTestId('help-manual').getAttribute('href')).toBe('/help');
    // 단축키 장은 메뉴에서 바로 간다 — 단축키를 찾는 사람은 목차를 훑지 않는다
    expect(screen.getByRole('link', { name: '단축키와 언어' }).getAttribute('href')).toBe(
      '/help/shortcuts',
    );
  });

  it('"이 화면 도움말"은 지금 보는 화면의 장을 가리킨다', async () => {
    renderAt('/p/clemvion/tasks');
    await waitFor(() => expect(screen.getByTestId('help-menu')).toBeDefined());

    fireEvent.click(screen.getByTestId('help-menu'));
    expect(screen.getByTestId('help-this-screen').getAttribute('href')).toBe('/help/tasks');
  });

  it('짚어 줄 장이 없는 화면에서는 그 항목이 없다 — 아무 데나 보내지 않는다', async () => {
    renderAt('/');
    await waitFor(() => expect(screen.getByTestId('help-menu')).toBeDefined());

    fireEvent.click(screen.getByTestId('help-menu'));
    expect(screen.queryByTestId('help-this-screen')).toBeNull();
  });
});

describe('매뉴얼 라우트', () => {
  it('/help 는 첫 장으로 보낸다', async () => {
    renderAt('/help');
    await waitFor(() => expect(screen.getByText('시작하기', { selector: 'h1' })).toBeDefined());
    // 차례는 늘 옆에 있다 — 목차로 돌아가야 다음 장이 보이면 두 번째 장은 열리지 않는다.
    // 본문도 같은 장을 가리키므로 이름이 겹친다 — 둘 다 같은 곳으로 가는 것이 맞다.
    const links = screen.getAllByRole('link', { name: '에이전트 연동' });
    expect(links.map((a) => a.getAttribute('href'))).toContain('/help/agents');
  });

  it('장 본문이 렌더되고 문서 안 목차가 붙는다', async () => {
    renderAt('/help/tasks');
    await waitFor(() => expect(screen.getByTestId('manual-body')).toBeDefined());
    const body = screen.getByTestId('manual-body');
    expect(body.querySelectorAll('h2').length).toBeGreaterThan(2);
    expect(body.querySelector('h2')?.id).toBe('sec-1');
    expect(screen.getByText('이 문서 안')).toBeDefined();
  });

  it('없는 장은 빈 화면이 아니라 없다고 말한다', async () => {
    renderAt('/help/no-such-chapter');
    await waitFor(() => expect(screen.getByText('그런 장이 없습니다.')).toBeDefined());
  });
});
