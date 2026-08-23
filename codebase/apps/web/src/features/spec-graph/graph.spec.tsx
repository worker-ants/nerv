// 그래프의 **선택 규칙**만 검사한다 — cytoscape 의 렌더링은 jsdom 에서 의미가 없다.
//
// 여기서 지키는 것: 중심 모드가 hop 을 정확히 세는가. 이게 틀리면 화면은 그럴듯한데
// 엉뚱한 문서가 "영향 범위"로 보인다 — 눈으로는 절대 못 잡는 종류의 오류다.

import { describe, expect, it } from 'vitest';
import { neighborhoodForTesting } from './graph.js';

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
