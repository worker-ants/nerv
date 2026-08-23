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
  // 이 라우트는 트리를 둘 그린다(사이드바 + 본문 전체 화면 — §1.3). 한 그루만 검사한다.
  return within(screen.getAllByTestId('spec-tree')[0]!);
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

describe('접힘/펼침', () => {
  it('처음에는 뿌리만 펼쳐 있다 (REQ-WEB-041)', async () => {
    const tree = await renderTree('/p/demo/specs');
    expect(tree.queryByText('자식')).not.toBeNull();
    // 손자는 한 겹 더 접혀 있다
    expect(tree.queryByText('손자')).toBeNull();
  });

  it('접으면 실제로 접힌다 — 최상위도 예외가 아니다', async () => {
    const tree = await renderTree('/p/demo/specs');
    fireEvent.click(tree.getAllByRole('button', { name: '접기' })[0]!);
    expect(tree.queryByText('자식')).toBeNull();
  });

  it('접힌 가지는 자식 수를 보인다 — 눌러 보기 전에 뒤에 뭐가 있는지 안다', async () => {
    const tree = await renderTree('/p/demo/specs');
    fireEvent.click(tree.getAllByRole('button', { name: '접기' })[0]!);
    expect(tree.queryByText('1')).not.toBeNull();
  });

  it('접은 상태가 다음 방문에도 남는다', async () => {
    const tree = await renderTree('/p/demo/specs');
    fireEvent.click(tree.getAllByRole('button', { name: '접기' })[0]!);
    expect(localStorage.getItem('nerv.tree.demo')).toBe('[]');
  });
});
