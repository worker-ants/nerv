// REQ-WEB-044 · REQ-WEB-101 · REQ-WEB-108 — 트리 스케일과 **전수 계약**.
//
// **두 자리의 초깃값은 같다**(2026-08-30 개정): 나열하는 자리는 전부 나열한다. 사이드바만
// 뿌리까지 펼치던 때가 있었는데, 일부만 나열하면 없는 문서와 접힌 문서를 사람이 구분하지
// 못한다.
//
// 규모의 부담은 접기가 아니라 가상 스크롤이 진다(창 밖 미렌더).

import { describe, expect, it } from 'vitest';
import { defaultExpanded, groupByParent } from './spec-tree.js';
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
  const walk = (parentId: string | null): void => {
    for (const n of byParent.get(parentId) ?? []) {
      count += 1;
      if (expanded.has(n.id)) walk(n.id);
    }
  };
  walk(null);
  return count;
}

const nodes: TreeNode[] = [];
for (let root = 0; root < 10; root += 1) {
  nodes.push(node(`r${root}`, null));
  for (let child = 0; child < 30; child += 1) {
    nodes.push(node(`r${root}c${child}`, `r${root}`));
    nodes.push(node(`r${root}c${child}g0`, `r${root}c${child}`));
  }
}

describe('나열하는 자리는 전부 나열한다 (REQ-WEB-101 · REQ-WEB-108)', () => {
  it('610 노드가 610 줄로 선다 — 접힌 가지에 문서가 남지 않는다', () => {
    expect(nodes).toHaveLength(610);
    expect(visibleCount(nodes, defaultExpanded(nodes))).toBe(610);
  });

  it('잎은 펼침 집합에 넣지 않는다 — 펼칠 것이 없는 노드다', () => {
    expect(defaultExpanded(nodes).has('r0c0g0')).toBe(false);
    expect(defaultExpanded(nodes).has('r0c0')).toBe(true);
  });
});

describe('접는 것은 사람의 조작이다', () => {
  it('가지를 접으면 그만큼만 줄어든다 — 형제 가지는 그대로다', () => {
    const open = new Set(defaultExpanded(nodes));
    open.delete('r0c0'); // 손자 하나를 접는다
    expect(visibleCount(nodes, open)).toBe(609);
  });

  it('뿌리를 접으면 그 아래가 통째로 사라진다 — 수 표기가 그것을 말해야 한다', () => {
    const open = new Set(defaultExpanded(nodes));
    open.delete('r0');
    // r0 의 자식 30 + 손자 30 이 함께 접힌다
    expect(visibleCount(nodes, open)).toBe(610 - 60);
  });
});
