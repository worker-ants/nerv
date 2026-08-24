// S3 오른쪽 레일의 관계 탭 — 방향으로 가른 하위 탭 (screens.md §2.4)
//
// 관계는 **한 목록에 두 질문**이 섞여 있다: 역참조는 "이 문서를 고치면 무엇이 흔들리나",
// 레퍼런스는 "이 문서가 무엇에 기대나". 50건이 섞이면 둘 중 하나를 보려고 전체를 훑게
// 된다. 여기서 보는 것은 **수가 먼저 보이는가**와 **고른 것만 남는가** 둘이다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const RELATIONS = [
  { spec_id: 'a', key: 'SPC-A', title: '들어오는 하나', kind: 'references', direction: 'in' },
  { spec_id: 'b', key: 'SPC-B', title: '들어오는 둘', kind: 'refines', direction: 'in' },
  { spec_id: 'c', key: 'SPC-C', title: '나가는 하나', kind: 'references', direction: 'out' },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const json = path.includes('/relations')
        ? { items: RELATIONS }
        : path.includes('/specs/')
          ? { id: 's-1', key: 'SPC-CWC-007', title: '스펙', project_id: 'p-1' }
          : path.includes('/projects')
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
                      roles: ['planner'],
                    },
                  ],
                }
              : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/specs/SPC-CWC-007'] }),
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** 레일 안의 관계 줄만 센다 — 왼쪽 스펙 트리도 같은 모양의 링크를 갖는다 */
function railLinks(): number {
  const rail = screen.getByTestId('rel-tab-all').closest('aside');
  return rail === null ? -1 : rail.querySelectorAll('a[href*="/specs/"]').length;
}

describe('관계 하위 탭 (2026-08-24 · 사람 지시)', () => {
  it('세 탭이 수를 **누르기 전에** 말한다 — 빈 탭을 열어 보게 하지 않는다', async () => {
    await waitFor(() => expect(screen.getByTestId('rel-tab-all').textContent).toContain('3'));
    expect(screen.getByTestId('rel-tab-in').textContent).toContain('2');
    expect(screen.getByTestId('rel-tab-out').textContent).toContain('1');
    // 전체 = 역참조 + 레퍼런스. 어느 쪽에도 안 들어가는 관계가 있으면 사람이 못 찾는다
    expect(railLinks()).toBe(3);
  });

  it('고른 방향만 남는다', async () => {
    await waitFor(() => expect(screen.getByTestId('rel-tab-in')).toBeDefined());

    fireEvent.click(screen.getByTestId('rel-tab-in'));
    await waitFor(() => expect(railLinks()).toBe(2));
    expect(screen.getByTestId('rel-tab-in').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('rel-tab-out'));
    await waitFor(() => expect(railLinks()).toBe(1));
    expect(screen.getByText('나가는 하나')).toBeDefined();
  });

  it('역참조 설명은 그 무리의 **머리**에 있다 — 꼬리에 달면 다 읽은 뒤에야 안다', async () => {
    await waitFor(() => expect(screen.queryByText('고치면 흔들리는 문서')).not.toBeNull());
    const rail = screen.getByTestId('rel-tab-all').closest('aside');
    const nodes = [...(rail?.querySelectorAll('p, a[href*="/specs/"]') ?? [])];
    const hint = nodes.findIndex((n) => n.textContent === '고치면 흔들리는 문서');
    const firstLink = nodes.findIndex((n) => n.tagName === 'A');
    expect(hint).toBeGreaterThanOrEqual(0);
    expect(hint).toBeLessThan(firstLink);
  });

  it('전체 탭은 두 무리 사이에 선을 긋는다 — 방향이 바뀌는 자리를 눈이 알아채야 한다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rel-divider')).not.toBeNull());
    // 한쪽만 보는 탭에는 나눌 것이 없다
    fireEvent.click(screen.getByTestId('rel-tab-in'));
    await waitFor(() => expect(screen.queryByTestId('rel-divider')).toBeNull());
    fireEvent.click(screen.getByTestId('rel-tab-out'));
    await waitFor(() => expect(screen.queryByTestId('rel-divider')).toBeNull());
  });

  it('전체 탭은 역참조를 먼저 놓는다 — 설명이 머리에 있으려면 무리도 먼저여야 한다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rel-divider')).not.toBeNull());
    const rail = screen.getByTestId('rel-tab-all').closest('aside');
    const links = [...(rail?.querySelectorAll('a[href*="/specs/"]') ?? [])];
    expect(links.map((a) => a.textContent?.includes('역참조'))).toEqual([true, true, false]);
  });

  it('레퍼런스만 볼 때는 역참조 설명을 달지 않는다 — 지금 보는 것을 잘못 읽게 된다', async () => {
    await waitFor(() => expect(screen.queryByText('고치면 흔들리는 문서')).not.toBeNull());

    fireEvent.click(screen.getByTestId('rel-tab-out'));
    await waitFor(() => expect(screen.queryByText('고치면 흔들리는 문서')).toBeNull());
  });
});
