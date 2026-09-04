// 트리 가지치기 — `root`·`depth`·`around`·`hops` (REQ-API-090)
//
// 실사용 보고(sudoku · 2026-09-05): 최상위 하나 + 깊이1 자식 여덟인 프로젝트에서
// `depth:1` 을 줘도 18개가 전부 왔고, **없는 문서를 `root` 로 줘도 성공했다.**
// 여기서 보는 것은 그 두 가지다 — 걸러지는가, 그리고 못 찾으면 못 찾았다고 하는가.

import { describe, expect, it } from 'vitest';
import { neighborhood, pruneTree } from './spec-tree.js';

interface Node {
  id: string;
  key: string;
  parent_id: string | null;
}

/** 보고에 나온 모양 그대로 — 뿌리 하나(VISION) 아래 자식 여덟, 그중 하나에 손자 둘 */
const NODES: Node[] = [
  { id: 'u-vision', key: 'SUD-VISION', parent_id: null },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `u-child-${String(i)}`,
    key: `SUD-CHILD-${String(i)}`,
    parent_id: 'u-vision',
  })),
  { id: 'u-gc-0', key: 'SUD-GC-0', parent_id: 'u-child-0' },
  { id: 'u-gc-1', key: 'SUD-GC-1', parent_id: 'u-child-0' },
];

const keys = (nodes: Node[] | null): string[] => (nodes ?? []).map((node) => node.key);

describe('pruneTree — depth', () => {
  it('주지 않으면 전 계층이다 — 화면이 쓰는 기본이다', () => {
    expect(pruneTree(NODES, {})).toHaveLength(11);
  });

  it('depth:1 은 뿌리와 그 자식 — 보고가 기대한 9개다', () => {
    const nodes = pruneTree(NODES, { depth: 1 });
    expect(nodes).toHaveLength(9);
    expect(keys(nodes)).not.toContain('SUD-GC-0');
  });

  it('depth:0 은 뿌리만이다', () => {
    expect(keys(pruneTree(NODES, { depth: 0 }))).toEqual(['SUD-VISION']);
  });

  it('트리보다 깊게 줘도 전부일 뿐 늘지 않는다', () => {
    expect(pruneTree(NODES, { depth: 99 })).toHaveLength(11);
  });

  it('부모가 목록에 없는 노드도 뿌리다 — 보관된 부모가 자식을 감추지 않는다', () => {
    // 보관되어 빠진 `u-child-0` 의 자식 둘이 목록에 남아 있는 상태다
    const orphaned = NODES.filter((node) => node.id !== 'u-child-0');
    expect(keys(pruneTree(orphaned, { depth: 0 }))).toEqual(['SUD-VISION', 'SUD-GC-0', 'SUD-GC-1']);
  });
});

describe('pruneTree — root', () => {
  it('안정 키로 그 문서와 아래를 준다', () => {
    expect(keys(pruneTree(NODES, { root: 'SUD-CHILD-0' }))).toEqual([
      'SUD-CHILD-0',
      'SUD-GC-0',
      'SUD-GC-1',
    ]);
  });

  it('UUID 로도 같은 답이다 — 참조는 둘 다 받는다(§1.4b)', () => {
    expect(keys(pruneTree(NODES, { root: 'u-child-0' }))).toEqual(
      keys(pruneTree(NODES, { root: 'SUD-CHILD-0' })),
    );
  });

  it('root 를 주면 그 문서가 뿌리다 — depth 는 거기서부터 센다', () => {
    expect(keys(pruneTree(NODES, { root: 'SUD-CHILD-0', depth: 0 }))).toEqual(['SUD-CHILD-0']);
  });

  it('잎을 가리키면 그 하나다', () => {
    expect(keys(pruneTree(NODES, { root: 'SUD-GC-1' }))).toEqual(['SUD-GC-1']);
  });

  it('없는 문서면 null 이다 — 전체 트리를 주면 오타가 사실이 된다', () => {
    expect(pruneTree(NODES, { root: 'SUD-NOPE-XXX' })).toBeNull();
  });

  it('순서는 들어온 그대로다 — 정렬은 질의의 몫이다(sort_key·key)', () => {
    const nodes = pruneTree(NODES, { depth: 1 }) ?? [];
    expect(nodes.map((node) => node.id)).toEqual(
      NODES.filter((node) => node.id !== 'u-gc-0' && node.id !== 'u-gc-1').map((node) => node.id),
    );
  });
});

describe('neighborhood — around·hops', () => {
  const graph = {
    nodes: NODES,
    edges: [
      { from_id: 'u-child-0', to_id: 'u-child-1' },
      { from_id: 'u-child-1', to_id: 'u-child-2' },
      { from_id: 'u-child-5', to_id: 'u-child-6' },
    ],
  };

  it('hops:0 은 중심 하나다', () => {
    expect(keys(neighborhood(graph, 'SUD-CHILD-0', 0)?.nodes ?? [])).toEqual(['SUD-CHILD-0']);
  });

  it('hops:1 은 한 칸 — 방향을 가리지 않는다', () => {
    expect(keys(neighborhood(graph, 'SUD-CHILD-1', 1)?.nodes ?? [])).toEqual([
      'SUD-CHILD-0',
      'SUD-CHILD-1',
      'SUD-CHILD-2',
    ]);
  });

  it('UUID 중심도 같은 답이다', () => {
    expect(neighborhood(graph, 'u-child-1', 1)?.nodes).toEqual(
      neighborhood(graph, 'SUD-CHILD-1', 1)?.nodes,
    );
  });

  it('없는 중심은 null 이다 — 빈 그래프는 "이웃이 없다"로 읽힌다', () => {
    expect(neighborhood(graph, 'SUD-NOPE-XXX', 1)).toBeNull();
  });

  it('끝점이 밖에 있는 간선은 함께 빠진다 — 허공을 가리키는 선을 만들지 않는다', () => {
    expect(neighborhood(graph, 'SUD-CHILD-0', 1)?.edges).toEqual([
      { from_id: 'u-child-0', to_id: 'u-child-1' },
    ]);
  });
});
