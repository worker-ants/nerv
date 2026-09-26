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
import { resetRuntimeConfigForTesting } from '../lib/config.js';
import { routeTree } from '../routeTree.gen';

// 실제 mermaid 는 레이아웃을 재는데 jsdom 에는 그것이 없다 — 계약(호출 → svg)만 흉내 낸다
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => ({
      svg: `<svg data-testid="drawn"><title>${code.includes('작업의') ? 'task' : 'other'}</title></svg>`,
    })),
  },
}));

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
  // 배포 설정은 모듈 상태다 — 남기면 다음 테스트가 앞 테스트의 API 주소를 물려받는다
  resetRuntimeConfigForTesting();
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
    expect(screen.getByText('이 페이지 목차')).toBeDefined();
  });

  // 상태의 흐름은 그림이다(2026-09-26 — 사람 지시 · REQ-WEB-243). 예전에는 ```mermaid 펜스가 코드로 보였다
  it('상태도는 코드가 아니라 그림으로 그려지고, 복사 단추가 붙지 않는다', async () => {
    renderAt('/help/tasks');
    const body = await screen.findByTestId('manual-body');
    await waitFor(() => expect(body.querySelector('[data-testid="drawn"]')).not.toBeNull());
    const diagram = body.querySelector<HTMLElement>('[data-testid="mermaid-diagram"]');
    expect(diagram?.querySelector('title')?.textContent).toBe('task');
    // 그림 옆에 배율 · 전체화면이 있다 — 스펙 본문의 다이어그램과 같은 컨트롤이다
    expect(diagram?.querySelector('[data-testid="mermaid-fullscreen-toggle"]')).not.toBeNull();
    expect(diagram?.closest('.nerv-code')).toBeNull();
    expect(body.textContent).not.toContain('stateDiagram-v2');
  });

  it('장을 옮기면 그 장의 그림으로 바뀐다 — 앞 장의 그림이 남지 않는다', async () => {
    renderAt('/help/tasks');
    const body = await screen.findByTestId('manual-body');
    await waitFor(() => expect(body.querySelectorAll('[data-testid="drawn"]')).toHaveLength(1));
    fireEvent.click(document.querySelector('a[href="/help/sessions"]')!);
    await waitFor(() =>
      expect(screen.getByTestId('manual-body').querySelector('title')?.textContent).toBe('other'),
    );
    expect(
      screen.getByTestId('manual-body').querySelectorAll('[data-testid="drawn"]'),
    ).toHaveLength(1);
  });

  it('없는 장은 빈 화면이 아니라 없다고 말한다', async () => {
    renderAt('/help/no-such-chapter');
    await waitFor(() => expect(screen.getByText('그런 장이 없습니다.')).toBeDefined());
  });
});

// ── 설치 장은 이 배치의 값으로 말한다 (REQ-WEB-165) ──────────────────────────
//
// 설치 장은 서버 주소와 프로젝트를 열 자리에서 말한다. 그 값이 예시로 박혀 있으면 읽은
// 사람이 열 번 고쳐 넣어야 하고, 하나라도 빠뜨리면 그 자리가 조용히 남의 서버를 가리킨다.
// 여기서 태우는 것은 **채워진다는 것**과 **예시가 남지 않는다는 것** 둘이다.
describe('설치 장의 환경값 (REQ-WEB-165)', () => {
  it('값 카드가 서고 본문의 자리표시자가 이 배치의 값으로 채워진다', async () => {
    renderAt('/help/install');
    // 프로젝트·역할은 조회가 끝나야 온다 — 그 전에는 예시값이 서 있고, 그것이 설계다
    await waitFor(() =>
      expect(screen.getByTestId('manual-env-card').textContent).toContain('admin'),
    );

    // 화면과 API 가 한 호스트인 배치라 지금 뜬 오리진이 곧 그 주소다(`/config.json` 없음)
    const origin = window.location.origin;
    const card = screen.getByTestId('manual-env-card');
    expect(card.textContent).toContain(origin);
    expect(card.textContent).toContain('clemvion');

    const body = screen.getByTestId('manual-body');
    expect(body.textContent).not.toContain('{{');
    expect(body.textContent).not.toContain('api.nerv.example.com');
    expect(body.textContent).toContain(`${origin}/plugin/marketplace.json`);
    // 설치 명령도 채워져 나간다 — 이것이 "그대로 복사하면 된다" 의 실물이다
    expect(body.textContent).toContain(`--server ${origin} --project clemvion`);
  });

  it('코드블록마다 복사 단추가 붙는다 — 매뉴얼의 코드블록은 복사하라고 있는 것이다', async () => {
    renderAt('/help/install');
    await waitFor(() => expect(screen.getByTestId('manual-body')).toBeDefined());
    const body = screen.getByTestId('manual-body');
    expect(body.querySelectorAll('[data-copy]').length).toBe(body.querySelectorAll('pre').length);
    expect(body.querySelector('[data-copy]')?.textContent).toBe('복사');
  });

  /**
   * **화면 주소와 API 주소가 갈린 배치**(REQ-CB-036 · 4.2 §6.3a). 설치 장이 말하는 다섯
   * 자리는 전부 **프로그램이 붙는 주소**다 — `NERV_SERVER`(훅이 `/ingest` 로 쏜다) ·
   * `.mcp.json` 의 `/mcp` · 마켓플레이스 카탈로그 · Codex 의 `/mcp` · 첫 표. 그래서
   * 채우는 값은 `/config.json` 의 `api_url` 이고 **지금 뜬 주소가 아니다.**
   *
   * 이 구분은 둘이 같은 배치에서는 드러나지 않는다 — 한 호스트짜리 스택에서는 두 값이
   * 같아서 어느 쪽을 읽든 초록이다. 그래서 갈린 값을 여기서 넣어 본다.
   */
  it('화면과 API 가 다른 호스트면 API 주소로 채운다 — 주소창의 주소가 아니다', async () => {
    resetRuntimeConfigForTesting({ apiBase: 'https://api.split.test' });
    renderAt('/help/install');
    await waitFor(() =>
      expect(screen.getByTestId('manual-env-card').textContent).toContain('admin'),
    );

    expect(screen.getByTestId('manual-env-card').textContent).toContain('https://api.split.test');
    const text = screen.getByTestId('manual-body').textContent ?? '';
    // 다섯 자리가 전부 API 주소다
    expect(text).toContain('"NERV_SERVER": "https://api.split.test"');
    expect(text).toContain('https://api.split.test/plugin/marketplace.json');
    expect(text).toContain('${NERV_SERVER:-https://api.split.test}/mcp');
    expect(text).toContain('url = "https://api.split.test/mcp"');
    expect(text).toContain('--server https://api.split.test');
    // 화면이 뜬 주소는 한 자리도 들어가지 않는다
    expect(text).not.toContain(window.location.origin);
  });

  /**
   * **`marketplace add` 는 되고 `install` 만 거부된다**(실측 2026-09-04). 말해 주지
   * 않으면 사람은 "추가는 됐는데 설치가 안 된다" 를 혼자 좇는다 — 화면이 서버가 허용할
   * 것을 미리 말하는 자리다(§1.8). 판정의 정본은 `@nerv/schema` 이고 서버도 같은 것을
   * 본다(REQ-CB-006).
   */
  it('설치가 안 되는 주소면 카드가 먼저 말한다 — https 가 아니다', async () => {
    resetRuntimeConfigForTesting({ apiBase: 'http://api.split.test' });
    renderAt('/help/install');
    await waitFor(() => expect(screen.getByTestId('manual-env-blocked')).toBeDefined());
    expect(screen.getByTestId('manual-env-blocked').textContent).toContain('https');
    // 무엇이 문제인지 값으로 말한다 — "설정을 확인하세요" 만으로는 어디를 볼지 모른다
    expect(screen.getByTestId('manual-env-blocked').textContent).toContain('http://');
  });

  it('루프백도 거부된다 — 개발 루프가 정확히 그 자리다', async () => {
    resetRuntimeConfigForTesting({ apiBase: 'https://localhost:8443' });
    renderAt('/help/install');
    await waitFor(() => expect(screen.getByTestId('manual-env-blocked')).toBeDefined());
    expect(screen.getByTestId('manual-env-blocked').textContent).toContain('localhost');
  });

  it('설치되는 주소에는 그 줄이 없다 — 정상 운영에서는 한 번도 안 보인다', async () => {
    resetRuntimeConfigForTesting({ apiBase: 'https://api.split.test' });
    renderAt('/help/install');
    await waitFor(() => expect(screen.getByTestId('manual-env-card')).toBeDefined());
    expect(screen.queryByTestId('manual-env-blocked')).toBeNull();
  });

  it('다른 장에는 값 카드가 없다 — 채울 값이 없는 장에 카드가 서면 잡음이다', async () => {
    renderAt('/help/tasks');
    await waitFor(() => expect(screen.getByTestId('manual-body')).toBeDefined());
    expect(screen.queryByTestId('manual-env-card')).toBeNull();
  });
});

// ── 본문의 스크롤 상자 (2026-09-08 · 사람 지시 · REQ-WEB-157) ────────────────
//
// S3 와 같은 규약이다(§2.4 · REQ-WEB-156): 스크롤 상자가 페이지면 차례 위에서 굴린
// 바퀴가 본문을 움직이고, 그때 두 칸은 나란히 놓인 두 칸이 아니다. jsdom 은 레이아웃을
// 재지 않으므로 여기서 태우는 것은 **어디가 스크롤 상자이고 무엇이 그 상자에 붙는가**
// 라는 계약이다 — 실제로 페이지가 가만히 있는지는 L3 가 잰다.
describe('매뉴얼의 스크롤 상자 (REQ-WEB-157)', () => {
  it('사이드바가 서는 폭부터 화면 높이를 쥐고, 차례와 본문이 각자 흐른다', async () => {
    renderAt('/help/tasks');
    await waitFor(() => expect(screen.getByTestId('manual-content')).toBeDefined());
    const content = screen.getByTestId('manual-content');
    const row = content.parentElement;
    expect(row?.className).toContain('md:h-below-header');
    expect(row?.className).toContain('md:overflow-hidden');
    expect(content.className).toContain('md:overflow-y-auto');
    // 차례는 둘째 열이다(2026-09-25 사람 지시 · REQ-WEB-232) — 한 줄에 열과 본문 상자가 나란히 선다
    expect(Array.from(row?.children ?? []).map((c) => c.getAttribute('data-testid'))).toEqual([
      'manual-column',
      'manual-content',
    ]);
    const toc = screen.getByTestId('manual-toc');
    expect(screen.getByTestId('nav-rail').contains(toc)).toBe(false);
    // 차례도 자기 안에서 흐른다 — 장이 열보다 많아지면 목록만 흐르고 머리는 제자리다
    expect(toc.lastElementChild?.className).toContain('overflow-y-auto');
  });

  it('"이 페이지 목차" 은 본문 상자의 꼭대기에 붙는다 — 셸 헤더가 기준이 아니다', async () => {
    renderAt('/help/tasks');
    await waitFor(() => expect(screen.getByText('이 페이지 목차')).toBeDefined());
    const aside = screen.getByText('이 페이지 목차').closest('aside');
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
    expect(cls).toContain('[&_h2]:scroll-mt-anchor');
    // 본문이 자기 상자 안에서 흐르면 상자 위가 곧 헤더 아래다 — 페이지 여백만큼이면 된다
    expect(cls).toContain('md:[&_h2]:scroll-mt-6');
  });
});

// ── 차례의 둘째 열 (2026-09-25 사람 지시 · REQ-WEB-232) ────────────────────────
//
// 차례는 셸 사이드바의 [도움말] 아래에 펼쳐져 있었다. 스펙 상세의 트리처럼 사이드바와 본문 사이의 열에 선다 —
// 열의 뼈대(띠 · 접기 · 좁은 폭의 겹침 패널)는 스펙 트리 열과 같은 한 벌(`side-column.tsx`)이다.
describe('도움말 차례의 둘째 열 (REQ-WEB-232)', () => {
  /** 열이 제자리에 서는 폭(`lg` — 64rem)인가 */
  function stubWidth(wide: boolean): void {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query === '(min-width: 48rem)' || (wide && query === '(min-width: 64rem)'),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  it('넓으면 제자리에 서고, 접으면 띠만 남으며 그 선택을 기억한다', async () => {
    stubWidth(true);
    renderAt('/help/tasks');
    const column = await screen.findByTestId('manual-column');
    expect(column.getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('manual-column-panel').className).not.toContain('absolute');
    fireEvent.click(screen.getByTestId('manual-column-toggle'));
    await waitFor(() => expect(column.getAttribute('data-open')).toBe('false'));
    expect(localStorage.getItem('nerv.manual-column')).toBe('closed');
    // 스펙 트리 열과 기억하는 자리가 다르다 — 한쪽을 접었다고 다른 쪽이 접히지 않는다
    expect(localStorage.getItem('nerv.spec-column')).toBeNull();
  });

  it('접어 둔 채 다시 오면 접혀 있다', async () => {
    localStorage.setItem('nerv.manual-column', 'closed');
    stubWidth(true);
    renderAt('/help/tasks');
    const column = await screen.findByTestId('manual-column');
    expect(column.getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('manual-column-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('좁으면 띠의 단추가 겹침 패널을 열고, 장을 고르거나 Esc 를 누르면 닫힌다', async () => {
    stubWidth(false);
    renderAt('/help/tasks');
    const column = await screen.findByTestId('manual-column');
    expect(column.getAttribute('data-open')).toBe('false');
    const toggle = screen.getByTestId('manual-column-toggle');
    fireEvent.click(toggle);
    await waitFor(() => expect(column.getAttribute('data-open')).toBe('true'));
    expect(screen.getByTestId('manual-column-panel').className).toContain('absolute');
    // 좁은 폭의 열고 닫음은 그 순간의 것이다 — 남기지 않는다
    expect(localStorage.getItem('nerv.manual-column')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '세션' }));
    await waitFor(() => expect(column.getAttribute('data-open')).toBe('false'));
    fireEvent.click(toggle);
    await waitFor(() => expect(column.getAttribute('data-open')).toBe('true'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(column.getAttribute('data-open')).toBe('false'));
    expect(document.activeElement).toBe(toggle);
  });
});
