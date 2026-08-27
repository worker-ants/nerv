// 그래프의 **선택 규칙**만 검사한다 — cytoscape 의 렌더링은 jsdom 에서 의미가 없다.
//
// 여기서 지키는 것: 중심 모드가 hop 을 정확히 세는가. 이게 틀리면 화면은 그럴듯한데
// 엉뚱한 문서가 "영향 범위"로 보인다 — 눈으로는 절대 못 잡는 종류의 오류다.

import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { connectionsOf, letAreasPan, neighborhoodForTesting } from './graph.js';

const nodes = ['a', 'b', 'c', 'd', 'z'].map((k) => ({
  id: k,
  key: k,
  title: k,
  type: 'feature',
  parent_id: null,
  doc_status: 'approved',
}));
// a → b → c → d,  z 는 고립
const edges = [
  { from_id: 'a', to_id: 'b', kind: 'references' },
  { from_id: 'b', to_id: 'c', kind: 'references' },
  { from_id: 'c', to_id: 'd', kind: 'references' },
];

describe('중심 모드의 hop 계산', () => {
  it('1단계는 직접 이웃까지', () => {
    expect([...neighborhoodForTesting(nodes, edges, 'a', 1)].sort()).toEqual(['a', 'b']);
  });

  it('2단계는 한 칸 더', () => {
    expect([...neighborhoodForTesting(nodes, edges, 'a', 2)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('방향을 가리지 않는다 — 참조당한 쪽도 영향 범위다', () => {
    expect([...neighborhoodForTesting(nodes, edges, 'd', 1)].sort()).toEqual(['c', 'd']);
  });

  it('고립 노드는 자기 자신만', () => {
    expect([...neighborhoodForTesting(nodes, edges, 'z', 2)]).toEqual(['z']);
  });

  it('모르는 키면 전체를 보여준다 — 빈 화면보다 낫다', () => {
    expect(neighborhoodForTesting(nodes, edges, 'nope', 1).size).toBe(nodes.length);
  });
});

describe('패널이 적는 이웃 (2026-08-24 · 사람 지시)', () => {
  it('방향으로 가른다 — 레퍼런스는 나가는 것, 역참조는 들어오는 것', () => {
    const links = connectionsOf(nodes, edges, 'b');
    expect(links.out.map((c) => c.node.key)).toEqual(['c']);
    expect(links.in.map((c) => c.node.key)).toEqual(['a']);
  });

  it('관계 종류를 함께 나른다 — "무엇으로 이어졌나"가 목록의 절반이다', () => {
    expect(connectionsOf(nodes, edges, 'b').out[0]?.kind).toBe('references');
  });

  it('그린 것이 아니라 **실제 관계 전부**를 센다', () => {
    // 중심 모드 1 hop 에서 c 는 화면에 없지만, b 를 고르면 패널은 c 를 적어야 한다 —
    // 화면을 따라 줄이면 패널이 "이 문서는 이것뿐"이라고 거짓을 말한다.
    expect(neighborhoodForTesting(nodes, edges, 'a', 1).has('c')).toBe(false);
    expect(connectionsOf(nodes, edges, 'b').out.map((c) => c.node.key)).toContain('c');
  });

  it('고르지 않았거나 모르는 키면 빈 목록이다 — 빈 패널이 열리지 않는다', () => {
    expect(connectionsOf(nodes, edges, null)).toEqual({ out: [], in: [] });
    expect(connectionsOf(nodes, edges, 'nope')).toEqual({ out: [], in: [] });
  });

  it('고립 노드는 양쪽 다 비어 있다', () => {
    expect(connectionsOf(nodes, edges, 'z')).toEqual({ out: [], in: [] });
  });
});

describe('영역 상자 위의 드래그 (2026-08-27 · 사람 보고)', () => {
  // 영역으로 묶으면 상자가 화면의 대부분을 덮는다. 그 위의 드래그가 노드를 잡는 일로
  // 남아 있으면 — 이 그래프는 아무 노드도 잡히지 않으므로 — 화면이 끌리지 않는다.
  const grouped = (): cytoscape.Core =>
    cytoscape({
      headless: true,
      elements: [
        { data: { id: 'area' } },
        { data: { id: 'doc', parent: 'area' } },
        { data: { id: 'loose' } },
      ],
      autoungrabify: true,
    });

  it('영역은 배경이다 — 그 위의 드래그는 화면 이동으로 넘어간다', () => {
    const cy = grouped();
    expect(cy.$id('area').pannable()).toBe(false); // cytoscape 기본값
    letAreasPan(cy);
    expect(cy.$id('area').pannable()).toBe(true);
    cy.destroy();
  });

  it('문서 노드는 그대로다 — 누르면 고르는 것이 노드의 일이다', () => {
    const cy = grouped();
    letAreasPan(cy);
    expect(cy.$id('doc').pannable()).toBe(false);
    expect(cy.$id('loose').pannable()).toBe(false);
    cy.destroy();
  });
});
