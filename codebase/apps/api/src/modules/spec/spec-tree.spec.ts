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
  doc_status: string | null;
  type: string;
}

/** 보고에 나온 모양 그대로 — 뿌리 하나(VISION) 아래 자식 여덟, 그중 하나에 손자 둘 */
const NODES: Node[] = [
  { id: 'u-vision', key: 'SUD-VISION', parent_id: null, doc_status: 'approved', type: 'vision' },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `u-child-${String(i)}`,
    key: `SUD-CHILD-${String(i)}`,
    parent_id: 'u-vision',
    doc_status: 'approved',
    type: 'area',
  })),
  // 손자 둘은 상태가 갈린다 — 조상(approved 부모·조부모)을 채우는 경로가 여기서 보인다
  { id: 'u-gc-0', key: 'SUD-GC-0', parent_id: 'u-child-0', doc_status: 'draft', type: 'feature' },
  { id: 'u-gc-1', key: 'SUD-GC-1', parent_id: 'u-child-0', doc_status: null, type: 'feature' },
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
  it('고정 ID로 그 문서와 아래를 준다', () => {
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

/**
 * 상태 필터 — 매칭 + 조상(2026-09-05 사람 결정 · REQ-API-092).
 *
 * 실측이 이 결정의 근거다(clemvion 141노드): `status=draft` 26건 중 **17건의 부모가
 * draft 가 아니다.** 매칭만 남기면 그 17건이 부모를 잃고, 받는 쪽은 트리를 그릴 수 없다.
 * 조상을 채우는 값은 노드 3개다(26 → 29).
 */
describe('pruneTree — status', () => {
  it('매칭과 그 조상이 함께 온다 — 조상은 matched:false 다', () => {
    const nodes = pruneTree(NODES, { statuses: ['draft'] }) ?? [];
    expect(nodes.map((node) => node.key)).toEqual(['SUD-VISION', 'SUD-CHILD-0', 'SUD-GC-0']);
    expect(nodes.map((node) => node.matched)).toEqual([false, false, true]);
  });

  it('센 것은 matched 뿐이다 — 조상을 세면 "draft 3건" 이 된다', () => {
    const nodes = pruneTree(NODES, { statuses: ['draft'] }) ?? [];
    expect(nodes.filter((node) => node.matched === true)).toHaveLength(1);
  });

  it('여럿이면 OR 다', () => {
    const nodes = pruneTree(NODES, { statuses: ['draft', 'approved'] }) ?? [];
    // null 하나만 빠진다 — 나머지 열은 둘 중 하나에 든다
    expect(nodes).toHaveLength(10);
    expect(nodes.map((node) => node.key)).not.toContain('SUD-GC-1');
  });

  it('현재 버전이 없는 스펙(null)은 어느 상태에도 들지 않는다', () => {
    const nodes = pruneTree(NODES, { statuses: ['approved'] }) ?? [];
    expect(nodes.map((node) => node.key)).not.toContain('SUD-GC-1');
  });

  it('그래도 조상이면 남는다 — 자리를 지키러 오는 것이지 매칭이 아니다', () => {
    // GC-1(null) 아래에 draft 를 하나 매단다: 부모가 null 이어도 자리는 있어야 한다
    const deeper: Node[] = [
      ...NODES,
      { id: 'u-ggc', key: 'SUD-GGC', parent_id: 'u-gc-1', doc_status: 'draft', type: 'feature' },
    ];
    const nodes = pruneTree(deeper, { statuses: ['draft'] }) ?? [];
    const gc1 = nodes.find((node) => node.key === 'SUD-GC-1');
    expect(gc1?.matched).toBe(false);
    expect(nodes.map((node) => node.key)).toContain('SUD-GGC');
  });

  it('아무것도 맞지 않으면 빈 목록이다 — 전체로 떨어지지 않는다', () => {
    expect(pruneTree(NODES, { statuses: ['deprecated'] })).toEqual([]);
  });

  it('빈 목록은 거르지 않는다 — 아무것도 고르지 않은 필터는 필터가 아니다', () => {
    expect(pruneTree(NODES, { statuses: [] })).toHaveLength(11);
  });

  it('주지 않으면 matched 필드 자체가 없다 — 늘 붙는 필드는 아무도 읽지 않는다', () => {
    const nodes = pruneTree(NODES, {}) ?? [];
    expect(nodes[0]).not.toHaveProperty('matched');
  });

  it('자리 → 깊이 → 상태 순이다 — 잘라낸 밖에서 조상을 끌어오지 않는다', () => {
    // depth 로 손자를 잘라내면 그 안에 draft 가 없다
    expect(pruneTree(NODES, { depth: 1, statuses: ['draft'] })).toEqual([]);
    // root 로 좁히면 그 범위의 조상까지만 채운다 — VISION 은 밖이라 오지 않는다
    const scoped = pruneTree(NODES, { root: 'SUD-CHILD-0', statuses: ['draft'] }) ?? [];
    expect(scoped.map((node) => node.key)).toEqual(['SUD-CHILD-0', 'SUD-GC-0']);
  });
});

/**
 * 종류 필터(REQ-API-093) — 상태와 **같은 축**이라 규칙도 같다: 매칭 + 조상.
 *
 * `area` 는 본문 없이 자리를 잡는 종류라 `vision,area` 는 곧 **트리의 뼈대**다
 * (실측 clemvion 141편 → 17편 · sudoku 18편 → 5편).
 */
describe('pruneTree — type', () => {
  it('뼈대만 고르면 뼈대가 남는다', () => {
    const nodes = pruneTree(NODES, { types: ['vision', 'area'] }) ?? [];
    expect(nodes).toHaveLength(9);
    expect(nodes.every((node) => node.matched === true)).toBe(true);
  });

  it('잎 종류를 고르면 그 조상이 따라온다 — 상태와 같은 규칙이다', () => {
    const nodes = pruneTree(NODES, { types: ['feature'] }) ?? [];
    expect(nodes.map((node) => node.key)).toEqual([
      'SUD-VISION',
      'SUD-CHILD-0',
      'SUD-GC-0',
      'SUD-GC-1',
    ]);
    expect(nodes.filter((node) => node.matched === true)).toHaveLength(2);
  });

  it('상태와 함께 주면 AND 다 — 둘 다 맞는 것만 센다', () => {
    const nodes = pruneTree(NODES, { types: ['feature'], statuses: ['draft'] }) ?? [];
    // GC-0 만 둘 다 맞는다(GC-1 은 feature 지만 상태가 없다)
    expect(nodes.filter((node) => node.matched === true).map((node) => node.key)).toEqual([
      'SUD-GC-0',
    ]);
  });

  it('한쪽만 맞는 것은 매칭이 아니다 — 조상으로도 남을 이유가 없으면 빠진다', () => {
    const nodes = pruneTree(NODES, { types: ['area'], statuses: ['draft'] }) ?? [];
    expect(nodes).toEqual([]);
  });

  it('빈 목록은 거르지 않는다 — 상태만 걸린 것과 같은 답이다', () => {
    expect(pruneTree(NODES, { types: [], statuses: ['draft'] })).toEqual(
      pruneTree(NODES, { statuses: ['draft'] }),
    );
  });
});
