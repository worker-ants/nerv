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
