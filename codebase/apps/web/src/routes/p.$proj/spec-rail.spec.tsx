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
});

/** 주소가 레일의 진실이라(REQ-WEB-163) 검사도 주소에서 시작한다 */
function renderAt(path = '/p/clemvion/specs/SPC-CWC-007'): void {
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
  beforeEach(() => renderAt());

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

// ── 레일의 가로 (2026-09-08 · 사람 보고) ─────────────────────────────────────
//
// 탭 다섯이 17rem 레일보다 넓어 잘렸고, 세로만 흐르게 하려던 `overflow-y-auto` 가
// (한 축이 visible 이 아니면 다른 축도 auto 가 되므로) 레일 전체를 가로 스크롤 상자로
// 만들어 **탭과 본문이 함께** 옆으로 밀렸다. jsdom 은 레이아웃을 재지 않으므로 여기서
// 태우는 것은 그 계약의 클래스다 — 스크롤 상자가 어디인지와, 그 상자가 세로로
// 찌그러지지 않는지.
describe('레일의 가로 스크롤 (2026-09-08 · 사람 보고)', () => {
  beforeEach(() => renderAt());

  it('탭 줄과 본문이 각자 흐른다 — 레일 전체가 옆으로 밀리지 않는다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tabs')).not.toBeNull());
    const tabs = screen.getByTestId('rail-tabs');
    const body = screen.getByTestId('rail-body');
    // 레일의 가로는 **명시로** 잠근다 — 안 적으면 세로를 열 때 가로가 딸려 열린다
    expect(tabs.closest('aside')?.className).toContain('lg:overflow-x-hidden');
    for (const box of [tabs, body]) expect(box.className).toContain('overflow-x-auto');
    // 스크롤 상자는 `min-height: auto` 가 0 이라, 세로로 넘치는 레일 안에서 눌린다.
    // 레일의 직계 칸 둘(머리·본문)이 그 대상이다 — 탭 줄은 머리 안에 있다.
    for (const box of [screen.getByTestId('rail-head'), body])
      expect(box.className).toContain('shrink-0');
  });

  it('탭은 줄지도 접히지도 않는다 — 좁으면 미는 것이지 뭉개는 것이 아니다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tab-relations')).not.toBeNull());
    for (const key of ['relations', 'requirements', 'versions', 'attachments', 'comments']) {
      const cls = screen.getByTestId(`rail-tab-${key}`).className;
      expect(cls).toContain('shrink-0');
      expect(cls).toContain('whitespace-nowrap');
    }
  });
});

// ── 폭의 상한 (2026-09-08 · 사람 지시) ───────────────────────────────────────
//
// 컨테이너 80rem + 본문 44rem 두 겹이라 창을 1512px 위로 넓혀도 늘어나는 것은 여백뿐이었고
// 레일은 오른쪽 끝에서 한참 떨어져 섰다. 상한을 걷은 것이 이 변경이라, 여기서 지키는 것은
// **상한이 다시 생기지 않는 것**이다 — 실제 폭이 자라는지는 L3 가 잰다(jsdom 은 못 잰다).
describe('폭의 상한 (2026-09-08 · 사람 지시)', () => {
  beforeEach(() => renderAt());

  it('레일이 든 격자에도 본문 칸에도 폭 상한이 없다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tabs')).not.toBeNull());
    const grid = screen.getByTestId('rail-tabs').closest('aside')?.parentElement;
    expect(grid?.className).toContain('grid');
    expect(grid?.className).not.toMatch(/\bmax-w-/);

    // 셸도 `<main>` 을 쓰므로 이름이 아니라 **격자 안의 그 칸**을 집는다
    const body = screen.getByTestId('spec-body');
    expect(body.className).not.toMatch(/\bmax-w-/);
    // 가운데 정렬도 남아 있으면 안 된다 — 트랙을 다 쓰지 않고 다시 가운데로 몰린다
    expect(body.className).not.toMatch(/\bmx-auto\b/);
  });

  it('바닥은 2열이 되는 폭부터만 둔다 — 1열에서 바닥을 두면 페이지가 가로로 밀린다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tabs')).not.toBeNull());
    const body = screen.getByTestId('spec-body');
    expect(body.className).toContain('min-w-0');
    expect(body.className).toContain('lg:min-w-[26rem]');
  });
});

// 셸이 이미 `<main>` 을 그린다 — 페이지가 또 쓰면 랜드마크가 겹쳐 두 개가 되고,
// 스크린 리더는 "본문" 이 둘이라고 읽는다(다른 라우트는 전부 셸의 것 하나만 쓴다).
describe('랜드마크는 하나다', () => {
  beforeEach(() => renderAt());

  it('스펙 상세가 <main> 을 또 만들지 않는다', async () => {
    await waitFor(() => expect(screen.queryByTestId('spec-body')).not.toBeNull());
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByTestId('spec-body').tagName).toBe('DIV');
  });
});

// ── 머리는 스크롤에서 빠진다 (2026-09-08 · 사람 지시) ────────────────────────
//
// 관계 93건짜리 문서에서 목록을 내리면 탭 줄과 방향 하위 탭이 함께 화면 위로 사라졌다.
// 그때 잃는 것은 "지금 어느 탭인가" 와 "방향을 바꾸려면 어디로" 둘이고, 되찾으려면
// 레일을 끝까지 되감아야 한다. 여기서 지키는 것은 **머리가 한 상자에 모여 있는가** 다 —
// 실제로 붙어 있는지는 스크롤이 있어야 보이므로 L3 가 잰다.
describe('레일 머리 고정 (REQ-WEB-153)', () => {
  beforeEach(() => renderAt());

  it('탭 줄과 방향 하위 탭이 같은 머리 상자에 있다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rel-tab-all')).not.toBeNull());
    const head = screen.getByTestId('rail-head');
    expect(head.contains(screen.getByTestId('rail-tabs'))).toBe(true);
    expect(head.contains(screen.getByTestId('rel-tab-all'))).toBe(true);
    // 본문 안에 남아 있으면 본문이 스크롤 상자라 레일 기준으로 붙지 못한다
    expect(screen.getByTestId('rail-body').contains(screen.getByTestId('rel-tab-all'))).toBe(false);
  });

  it('머리는 레일의 직계 칸이고, 레일 기준으로 붙으며 배경을 깐다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-head')).not.toBeNull());
    const head = screen.getByTestId('rail-head');
    // 스크롤 상자(레일)의 직계라야 그 상자 기준으로 붙는다
    expect(head.parentElement).toBe(head.closest('aside'));
    expect(head.className).toContain('lg:sticky');
    expect(head.className).toContain('lg:top-0');
    // 배경이 없으면 목록이 글자 위로 비쳐 지나간다
    expect(head.className).toContain('bg-bg');
  });

  it('관계가 아닌 탭에서는 방향 하위 탭이 머리에 남지 않는다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tab-versions')).not.toBeNull());
    fireEvent.click(screen.getByTestId('rail-tab-versions'));
    await waitFor(() => expect(screen.queryByTestId('rel-tab-all')).toBeNull());
  });
});

// ── 잘린 쪽을 흐린다 (2026-09-08 · 사람 지시) ────────────────────────────────
//
// 줄이 스크롤 상자가 된 뒤에도(REQ-WEB-151) 잘렸다는 **표시**가 없었다 — macOS 는 쉬는
// 동안 막대를 숨기므로 사람은 잘린 탭을 목록의 끝으로 읽는다. 판정은 `scrollEdges` 한
// 곳이고(거기서 경계값을 태운다) 여기서 보는 것은 **그 판정이 화면에 배선됐는가** 다.
describe('탭 줄의 페이드 (REQ-WEB-154)', () => {
  beforeEach(() => renderAt());

  it('잘리지 않았으면 어느 쪽도 흐리지 않는다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tabs')).not.toBeNull());
    expect(screen.getByTestId('rail-tabs').getAttribute('data-edges')).toBe('none');
    expect(screen.queryByTestId('rail-tabs-fade-start')).toBeNull();
    expect(screen.queryByTestId('rail-tabs-fade-end')).toBeNull();
  });

  it('오른쪽이 잘리면 그쪽만, 끝까지 밀면 왼쪽만 흐린다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tabs')).not.toBeNull());
    const tabs = screen.getByTestId('rail-tabs');
    // jsdom 은 레이아웃을 재지 않는다 — 폭을 심어 **배선**을 태운다(폭 자체는 L3 가 잰다)
    Object.defineProperty(tabs, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(tabs, 'scrollWidth', { value: 400, configurable: true });
    fireEvent.scroll(tabs);

    await waitFor(() => expect(tabs.getAttribute('data-edges')).toBe('end'));
    expect(screen.queryByTestId('rail-tabs-fade-end')).not.toBeNull();
    expect(screen.queryByTestId('rail-tabs-fade-start')).toBeNull();

    Object.defineProperty(tabs, 'scrollLeft', { value: 200, configurable: true });
    fireEvent.scroll(tabs);

    await waitFor(() => expect(tabs.getAttribute('data-edges')).toBe('start'));
    expect(screen.queryByTestId('rail-tabs-fade-start')).not.toBeNull();
    // 끝에 닿았는데 남아 있으면 "더 있다" 는 거짓말이 된다
    expect(screen.queryByTestId('rail-tabs-fade-end')).toBeNull();
  });
});

// ── 본문의 스크롤 상자 (2026-09-08 · 사람 지시 · REQ-WEB-156) ────────────────
//
// 스크롤 상자가 문서 전체였다 — 본문이 길면 바퀴를 어디서 굴리든 페이지가 움직였고,
// 레일은 `sticky` 가 붙는 자리에 닿기 전까지 본문과 함께 위로 밀렸다. 화면 높이를
// 확정하고 두 칸이 각자 흐르게 한 것이 이 변경이다. jsdom 은 레이아웃을 재지 않으므로
// 여기서 태우는 것은 **어디가 스크롤 상자이고 무엇이 그 상자에 붙는가** 라는 계약이고,
// 실제로 페이지가 가만히 있는지는 L3 가 잰다.
describe('본문의 스크롤 상자 (REQ-WEB-156)', () => {
  beforeEach(() => renderAt());

  it('격자가 화면 높이를 쥐고, 행이 내용만큼 자라지 않는다', async () => {
    await waitFor(() => expect(screen.queryByTestId('spec-body')).not.toBeNull());
    const grid = screen.getByTestId('spec-body').parentElement;
    expect(grid?.className).toContain('lg:h-[calc(100dvh-var(--spacing-header))]');
    // 암시 행은 `auto` 라 내용만큼 자란다 — 높이만 잡으면 안쪽 스크롤이 서지 않는다
    expect(grid?.className).toContain('lg:grid-rows-[minmax(0,1fr)]');
    expect(grid?.className).toContain('lg:overflow-hidden');
  });

  it('본문 칸은 세로만 연다 — 가로까지 열면 제목과 본문이 함께 옆으로 밀린다', async () => {
    await waitFor(() => expect(screen.queryByTestId('spec-body')).not.toBeNull());
    const body = screen.getByTestId('spec-body');
    expect(body.className).toContain('lg:overflow-y-auto');
    // 레일에서 겪은 그 모양이다(REQ-WEB-151) — 가로는 **명시로** 잠근다
    expect(body.className).toContain('lg:overflow-x-hidden');
    expect(body.className).toContain('lg:h-full');
  });

  it('레일은 격자 행에서 높이를 받는다 — 붙일 것이 없는 자리에 `sticky` 를 두지 않는다', async () => {
    await waitFor(() => expect(screen.queryByTestId('rail-tabs')).not.toBeNull());
    const rail = screen.getByTestId('rail-tabs').closest('aside');
    expect(rail?.className).toContain('lg:h-full');
    expect(rail?.className).toContain('lg:overflow-y-auto');
    // 페이지가 스크롤하지 않으므로 뷰포트에 손수 묶던 계산식 둘은 남지 않는다
    expect(rail?.className).not.toMatch(/lg:sticky/);
    expect(rail?.className).not.toMatch(/lg:max-h-/);
  });

  it('제목은 스크롤 상자가 어디냐를 따라 붙고, 위 여백은 메타 줄이 든다', async () => {
    await waitFor(() => expect(screen.queryByTestId('spec-title')).not.toBeNull());
    const title = screen.getByTestId('spec-title');
    // 1열은 페이지가, 2열은 본문 칸이 스크롤 상자다
    expect(title.className).toContain('top-header');
    expect(title.className).toContain('lg:top-0');
    // `sticky` 는 margin 상자를 가둔다 — 제목에 `mt` 가 남으면 붙었을 때 그만큼
    // 틈이 생기고, 그 틈으로 흐르는 본문이 비쳐 지나간다
    expect(title.className).not.toMatch(/\bmt-/);
    expect(title.previousElementSibling?.className).toContain('mb-[7px]');
  });
});

/**
 * **레일도 주소의 축이다**(REQ-WEB-163 · screens.md §2.4).
 *
 * 코멘트가 달렸다는 알림이 본문만 열어 주면, 정작 읽으러 온 코멘트는 레일 다섯 탭 중
 * 하나에 접혀 있다 — "무슨 일이 있었다" 만 알리고 끝나는 알림이다(ui-wireframes §4.5).
 */
describe('레일 탭을 주소가 고른다', () => {
  it('?rail=comments 로 열면 코멘트 자리가 펴져 있다', async () => {
    renderAt('/p/clemvion/specs/SPC-CWC-007?rail=comments');
    await waitFor(() => expect(screen.queryByTestId('rail-panel-comments')).not.toBeNull());
  });

  it('인자가 없으면 관계다 — 기본은 바뀌지 않았다', async () => {
    renderAt();
    await waitFor(() => expect(screen.queryByTestId('rel-tab-all')).not.toBeNull());
    expect(screen.queryByTestId('rail-panel-comments')).toBeNull();
  });

  /** 어휘 밖 값은 버린다 — 모르는 탭 이름에 화면을 맞출 자리가 없다 */
  it('모르는 값은 기본으로 떨어진다 — 빈 레일을 보이지 않는다', async () => {
    renderAt('/p/clemvion/specs/SPC-CWC-007?rail=그런탭은없다');
    await waitFor(() => expect(screen.queryByTestId('rel-tab-all')).not.toBeNull());
  });
});
