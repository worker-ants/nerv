// 트리 접힘/펼침 — 눈으로만 확인하던 것을 규칙으로 못 박는다.
//
// 최상위가 **접히지 않던** 결함이 있었다: `isOpen` 에 `depth === 0` 이 OR 로 걸려 있어
// 사용자가 접어도 다시 열렸다. 상태를 바꿨는데 화면이 안 바뀌는 종류의 결함이라
// "왜 안 되지"만 남기고 원인이 안 보인다.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { ancestorsOf } from './spec-tree.js';
import { routeTree } from '../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

/** `/projects/<slug>` 하나 — `/projects/<slug>/specs/tree` 같은 하위 경로와 가른다 */
const ONE_PROJECT = /\/projects\/[^/?]+$/;

const NODES = [
  {
    id: 'r',
    key: 'root',
    title: '뿌리',
    type: 'area',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'c',
    key: 'child',
    title: '자식',
    type: 'feature',
    parent_id: 'r',
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'g',
    key: 'grand',
    title: '손자',
    type: 'feature',
    parent_id: 'c',
    doc_status: 'approved',
    version_no: 1,
  },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('/specs/tree')
          ? NODES
          : // **프로젝트 조회는 `id` 를 실은 객체다.** 트리 쿼리의 캐시 키가 그 id 축이라
            // (queries.ts "프로젝트 축"), 여기서 id 를 빼면 화면은 아무것도 부르지 않는다.
            ONE_PROJECT.test(String(url))
            ? { id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }
            : { items: [], memberships: [], count: 0, summary: {} },
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderTree(path: string) {
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
  await screen.findAllByText('뿌리');
  // **펼침 초깃값은 데이터가 온 *다음* effect 에서 정해진다**(spec-tree.tsx). 그래서
  // '뿌리' 가 뜬 렌더는 아직 접힌 상태이고, 거기서 바로 읽으면 "자식이 없다" 로 보인다.
  // 펼침이 정해진 렌더까지 기다린다. 트리 둘은 같은 데이터·같은 커밋에서 함께 정해지므로
  // 한쪽이 자식을 그렸으면 다른 쪽도 정해진 뒤다 — **둘 다** 를 기다리지는 않는다:
  // 사이드바를 접어 둔 채 다시 여는 검사가 있고, 거기서는 자식이 하나뿐인 것이 정답이다.
  await screen.findAllByText('자식');
  // 이 라우트는 트리를 **둘** 그린다(§1.3) — 사이드바(rail)가 앞, 전수 목록(full)이 뒤다.
  // 둘의 초깃값이 다른 것이 설계이므로 검사도 둘을 갈라서 한다.
  const trees = screen.getAllByTestId('spec-tree');
  return { rail: within(trees[0]!), full: within(trees[1]!) };
}

describe('조상 계산', () => {
  it('뿌리까지의 길을 모은다 — 딥링크로 들어와도 자리를 펼칠 수 있게', () => {
    expect(ancestorsOf(NODES, 'grand')).toEqual(['c', 'r']);
  });

  it('뿌리 자신은 조상이 없다', () => {
    expect(ancestorsOf(NODES, 'root')).toEqual([]);
  });

  it('모르는 키는 빈 목록 — 던지지 않는다(트리 하나가 셸을 죽이지 않는다)', () => {
    expect(ancestorsOf(NODES, 'nope')).toEqual([]);
  });
});

describe('사이드바 트리 — 나열하는 자리는 전부 나열한다 (REQ-WEB-108)', () => {
  it('처음부터 손자까지 전부 있다 — 보이지 않는 문서가 있으면 사람이 놓친다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    expect(rail.queryByText('자식')).not.toBeNull();
    expect(rail.queryByText('손자')).not.toBeNull();
  });

  it('접으면 실제로 접힌다 — 최상위도 예외가 아니다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    fireEvent.click(rail.getAllByRole('button', { name: '접기' })[0]!);
    expect(rail.queryByText('자식')).toBeNull();
  });

  it('접힌 가지는 자식 수를 보인다 — 눌러 보기 전에 뒤에 뭐가 있는지 안다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    fireEvent.click(rail.getAllByRole('button', { name: '접기' })[0]!);
    expect(rail.queryByText('1')).not.toBeNull();
  });

  it('접은 상태가 다음 방문에도 남는다 — 열쇠는 자리별이다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    // 뿌리를 접으면 그 아래가 통째로 접힌다 — 남는 펼침 집합은 손자의 부모뿐이다
    fireEvent.click(rail.getAllByRole('button', { name: '접기' })[0]!);
    expect(localStorage.getItem('nerv.tree.demo.rail')).toBe('["c"]');
    // 전수 목록의 열쇠는 건드리지 않는다
    expect(localStorage.getItem('nerv.tree.demo.full')).toBeNull();
  });

  it('수는 둘로 적는다 — 접었을 때 무엇이 감춰졌는지가 그 수로 보인다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    expect(rail.getByTestId('tree-count').textContent).toBe('3 / 3');

    fireEvent.click(rail.getAllByRole('button', { name: '접기' })[0]!);
    expect(rail.getByTestId('tree-count').textContent).toBe('1 / 3');
  });
});

describe('전수 목록 — 목록에 없으면 열람도 없다 (REQ-WEB-101)', () => {
  it('처음 열면 손자까지 전부 있다', async () => {
    const { full } = await renderTree('/p/demo/specs');
    expect(full.queryByText('손자')).not.toBeNull();
  });

  it('표시·전체를 함께 적는다 (REQ-WEB-102)', async () => {
    const { full } = await renderTree('/p/demo/specs');
    expect(full.getByTestId('tree-count').textContent).toBe('표시 3 / 전체 3');
  });

  it('한쪽에서 접은 것이 다른 쪽의 첫 화면을 바꾸지 않는다', async () => {
    const first = await renderTree('/p/demo/specs');
    fireEvent.click(first.rail.getAllByRole('button', { name: '접기' })[0]!);
    cleanup();

    const again = await renderTree('/p/demo/specs');
    expect(again.full.queryByText('손자')).not.toBeNull();
    expect(again.rail.queryByText('자식')).toBeNull();
  });

  it('접는 것은 사람의 조작이다 — 접으면 수도 같이 줄어든다', async () => {
    const { full } = await renderTree('/p/demo/specs');
    fireEvent.click(full.getByTestId('tree-collapse-all'));
    expect(full.queryByText('자식')).toBeNull();
    expect(full.getByTestId('tree-count').textContent).toBe('표시 1 / 전체 3');
  });
});

// ── 레일의 조작 — 2026-09-21 사람 보고 ────────────────────────────────────────
//
// "좌측의 스펙 목록에 펴기/접기 버튼이 너무 작고 텍스트와 구분이 쉽지 않다. 전체
// 펴기/접기 버튼도 있었으면 한다."
//
// 캐럿은 `text-2xs`(10.5px) 글리프였고 색이 `text-text-faint` 라 **바로 옆 제목보다
// 흐렸다** — 줄에서 가장 중요한 조작이 가장 안 보였다(REQ-WEB-170). 전체 토글은
// 전수 목록에만 있었는데(§2.4b "좁은 사이드바에는 두지 않는다" · 2026-08-23), 그 판단은
// 레일 기본이 깊이 1이던 시절의 것이다 — 전부 펼침이 기본이 된 뒤로는 접을 수단이
// 오히려 레일에 필요하다(REQ-WEB-171).

describe('레일의 펴기/접기 (REQ-WEB-170·171)', () => {
  it('캐럿은 24px 타깃이고 지금 상태를 aria 로 말한다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    const caret = rail.getAllByTestId('tree-toggle')[0]!;
    // 10.5px 글리프가 아니라 **단추**다 — `size-6` 이 24×24 를 만든다(WCAG 2.5.8)
    expect(caret.className).toContain('size-6');
    // 라벨은 "다음에 일어날 일" 이라 지금 상태를 말하지 못한다 — 그래서 둘 다 둔다
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(caret);
    expect(rail.getAllByTestId('tree-toggle')[0]!.getAttribute('aria-expanded')).toBe('false');
  });

  it('머리줄의 단추 둘은 누르면 늘 같은 일을 한다 — 할 일이 없으면 꺼진다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    const expand = () => rail.getByTestId('tree-expand-all') as HTMLButtonElement;
    const collapse = () => rail.getByTestId('tree-collapse-all') as HTMLButtonElement;
    // 이름이 상태에 따라 바뀌지 않는다 — 토글 하나였을 때는 바뀌었다(2026-09-24 분리)
    expect(expand().getAttribute('aria-label')).toBe('전체 펼치기');
    expect(collapse().getAttribute('aria-label')).toBe('전체 접기');
    // 전부 펴져 있으니 펼치기는 할 일이 없다 — 숨기지 않고 끈다(자리가 들썩이지 않게)
    expect(expand().disabled).toBe(true);

    fireEvent.click(collapse());
    expect(rail.queryByText('자식')).toBeNull();
    expect(collapse().disabled).toBe(true);
    expect(expand().disabled).toBe(false);

    fireEvent.click(expand());
    expect(rail.queryByText('손자')).not.toBeNull();
  });

  it('일부만 펴져 있어도 전체 펼치기는 한 번이다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    // 손자의 부모만 접는다 — 이제 "하나라도 펴져 있다"
    fireEvent.click(rail.getAllByRole('button', { name: '접기' })[1]!);
    expect(rail.queryByText('손자')).toBeNull();
    fireEvent.click(rail.getByTestId('tree-expand-all'));
    expect(rail.queryByText('손자')).not.toBeNull();
  });

  it('접으면 머리의 수도 같이 줄어든다 — 무엇이 감춰졌는지가 그 수다', async () => {
    const { rail } = await renderTree('/p/demo/specs');
    expect(rail.getByTestId('tree-count').textContent).toBe('3 / 3');
    fireEvent.click(rail.getByTestId('tree-collapse-all'));
    expect(rail.getByTestId('tree-count').textContent).toBe('1 / 3');
  });
});

// ── 하위 문서를 연 채로 접기 — 2026-09-24 사람 보고 ──────────────────────────────
//
// "하위 페이지를 열었을 때 전체 또는 상위 경로를 접기하면 접히지 않아."
//
// 보고 있는 문서까지의 경로를 펼치는 effect 가 **펼침 상태가 바뀔 때마다** 돌았다. 사람이
// 조상을 접으면 다음 렌더에서 도로 펴졌고, 전체 접기도 활성 경로만큼 되살아나 토글의
// 아이콘은 계속 "접기" 였다 — 눌러도 아무 일이 없는 것처럼 보였다(REQ-WEB-186).

/** 스펙 상세에는 트리가 **하나**(레일)다 — 전수 목록은 그 화면에 없다 */
async function renderRailAt(key: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/p/demo/specs/${key}`] }),
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
  await screen.findAllByText('손자');
  return within(screen.getAllByTestId('spec-tree')[0]!);
}

describe('하위 문서를 연 채로 접기 (REQ-WEB-186·187)', () => {
  it('들어오면 그 문서까지의 길이 펴진다 — 저장이 모두 접힘이어도 (REQ-WEB-053)', async () => {
    localStorage.setItem('nerv.tree.demo.rail', '[]');
    const rail = await renderRailAt('grand');
    expect(rail.queryByText('손자')).not.toBeNull();
  });

  it('조상을 접으면 접힌 채로 남는다 — 도로 펴지지 않는다', async () => {
    const rail = await renderRailAt('grand');
    fireEvent.click(rail.getAllByRole('button', { name: '접기' })[0]!);
    expect(rail.queryByText('자식')).toBeNull();
    expect(rail.getByTestId('tree-count').textContent).toBe('1 / 3');
  });

  it('전체 접기가 뿌리까지 접는다', async () => {
    const rail = await renderRailAt('grand');
    fireEvent.click(rail.getByTestId('tree-collapse-all'));
    expect(rail.queryByText('자식')).toBeNull();
    expect((rail.getByTestId('tree-collapse-all') as HTMLButtonElement).disabled).toBe(true);
  });

  it('접힌 가지가 보는 문서를 품었으면 그 줄이 말한다', async () => {
    const rail = await renderRailAt('grand');
    expect(rail.queryByTestId('tree-holds-active')).toBeNull();
    fireEvent.click(rail.getByTestId('tree-collapse-all'));
    const marker = rail.getByTestId('tree-holds-active');
    expect(marker.closest('a')?.textContent).toContain('뿌리');
  });

  it('[보고 있는 문서로] 가 길을 다시 펴고, 그것은 사람의 조작이라 남는다', async () => {
    const rail = await renderRailAt('grand');
    fireEvent.click(rail.getByTestId('tree-collapse-all'));
    fireEvent.click(rail.getByTestId('tree-reveal-active'));
    expect(rail.queryByText('손자')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('nerv.tree.demo.rail') ?? '[]')).toEqual(
      expect.arrayContaining(['r', 'c']),
    );
  });
});
