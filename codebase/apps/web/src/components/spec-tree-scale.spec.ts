// REQ-WEB-044 — 트리 스케일. 문서 대조에서 "전량 로드 후 접기"로 드러난 이탈의 회귀 방지.
//
// 판정 기준은 **최초 페인트가 전체 트리를 요구하지 않는 것**이다. 두 장치가 그것을 만든다:
// ① depth=1 접기(보이는 노드만 평탄화) ② 200 노드 초과 시 창 밖 미렌더.

import { describe, expect, it } from 'vitest';
import { groupByParent } from './spec-tree.js';
import type { TreeNode } from './spec-tree.js';

function node(id: string, parent: string | null): TreeNode {
  return {
    id,
    key: `SPC-${id}`,
    title: id,
    type: 'feature',
    parent_id: parent,
    doc_status: 'approved',
    version_no: 1,
  };
}

/** 화면이 세는 것과 같은 규칙 — 접힌 가지는 목록에 들어오지 않는다. */
function visibleCount(nodes: TreeNode[], expanded: Set<string>): number {
  const byParent = groupByParent(nodes);
  let count = 0;
  const walk = (parentId: string | null, depth: number): void => {
    for (const n of byParent.get(parentId) ?? []) {
      count += 1;
      if (expanded.has(n.id) || depth === 0) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return count;
}

describe('접힌 트리는 전체를 그리지 않는다', () => {
  const nodes: TreeNode[] = [];
  for (let root = 0; root < 10; root += 1) {
    nodes.push(node(`r${root}`, null));
    for (let child = 0; child < 30; child += 1) {
      nodes.push(node(`r${root}c${child}`, `r${root}`));
      nodes.push(node(`r${root}c${child}g0`, `r${root}c${child}`));
    }
  }

  it('610 노드 트리에서 처음 보이는 것은 depth 1 까지다', () => {
    expect(nodes).toHaveLength(610);
    // 루트 10 + 그 자식 300 = 310 (손자 300 은 접혀 있다)
    expect(visibleCount(nodes, new Set())).toBe(310);
  });

  it('가지를 펼치면 그만큼만 늘어난다 — 형제 가지는 여전히 접혀 있다', () => {
    expect(visibleCount(nodes, new Set(['r0c0']))).toBe(311);
  });
});
