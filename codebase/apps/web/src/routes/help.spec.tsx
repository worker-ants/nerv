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

// ── 본문의 스크롤 상자 (2026-09-08 · 사람 지시 · REQ-WEB-157) ────────────────
//
// S3 와 같은 규약이다(§2.4 · REQ-WEB-156): 스크롤 상자가 페이지면 차례 위에서 굴린
// 바퀴가 본문을 움직이고, 그때 두 칸은 나란히 놓인 두 칸이 아니다. jsdom 은 레이아웃을
// 재지 않으므로 여기서 태우는 것은 **어디가 스크롤 상자이고 무엇이 그 상자에 붙는가**
// 라는 계약이다 — 실제로 페이지가 가만히 있는지는 L3 가 잰다.
describe('매뉴얼의 스크롤 상자 (REQ-WEB-157)', () => {
  it('차례가 있는 폭부터 화면 높이를 쥐고, 차례와 본문이 각자 흐른다', async () => {
    renderAt('/help/tasks');
    await waitFor(() => expect(screen.getByTestId('manual-content')).toBeDefined());
    const content = screen.getByTestId('manual-content');
    const row = content.parentElement;
    expect(row?.className).toContain('md:h-[calc(100dvh-var(--spacing-header))]');
    expect(row?.className).toContain('md:overflow-hidden');
    expect(content.className).toContain('md:overflow-y-auto');
    // 차례도 자기 안에서 흐른다 — 열 장이 화면보다 길어지면 아래쪽에 닿지 못한다
    const toc = row?.querySelector('aside');
    expect(toc?.className).toContain('overflow-y-auto');
    // 페이지가 흐르지 않으므로 뷰포트에 손수 묶던 계산식은 남지 않는다
    expect(toc?.className).not.toMatch(/sticky/);
    expect(toc?.className).not.toMatch(/h-\[calc/);
  });

  it('"이 문서 안" 은 본문 상자의 꼭대기에 붙는다 — 셸 헤더가 기준이 아니다', async () => {
    renderAt('/help/tasks');
    await waitFor(() => expect(screen.getByText('이 문서 안')).toBeDefined());
    const aside = screen.getByText('이 문서 안').closest('aside');
    expect(aside?.className).toContain('sticky');
    expect(aside?.className).toContain('top-0');
    // 이 목차가 보이는 폭(xl)은 본문이 자기 안에서 흐르는 폭(md)보다 넓다
    expect(aside?.className).not.toContain('top-header');
  });

  it('앵커로 뛰는 자리의 여백은 위에 붙은 것을 따라간다', async () => {
    renderAt('/help/tasks');
    await waitFor(() => expect(screen.getByTestId('manual-body')).toBeDefined());
    const cls = screen.getByTestId('manual-body').className;
    // 페이지가 흐르는 좁은 화면에서는 셸 헤더가 그 자리를 덮는다
    expect(cls).toContain('[&_h2]:scroll-mt-[calc(var(--spacing-header)+1.5rem)]');
    // 본문이 자기 상자 안에서 흐르면 상자 위가 곧 헤더 아래다 — 페이지 여백만큼이면 된다
    expect(cls).toContain('md:[&_h2]:scroll-mt-6');
  });
});
