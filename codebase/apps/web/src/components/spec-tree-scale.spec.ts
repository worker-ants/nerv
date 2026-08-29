// REQ-WEB-044 · REQ-WEB-101 — 트리 스케일과 **전수 계약**.
//
// 두 자리의 초깃값이 다르다는 것이 이 파일의 주제다.
// - `full`(스펙 목록) — 전부 펼친다. 목록에 없으면 열람도 없다.
// - `rail`(사이드바) — 뿌리까지만. 610줄이 늘 떠 있으면 그 아래 아무것도 안 보인다.
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

describe('전수 목록은 처음부터 전부 보인다 (REQ-WEB-101)', () => {
  it('610 노드가 610 줄로 선다 — 접힌 가지에 문서가 남지 않는다', () => {
    expect(nodes).toHaveLength(610);
    expect(visibleCount(nodes, defaultExpanded(nodes, 'full'))).toBe(610);
  });

  it('잎은 펼침 집합에 넣지 않는다 — 펼칠 것이 없는 노드다', () => {
    expect(defaultExpanded(nodes, 'full').has('r0c0g0')).toBe(false);
    expect(defaultExpanded(nodes, 'full').has('r0c0')).toBe(true);
  });
});

describe('사이드바는 동반자다 — 부분이어도 된다', () => {
  it('뿌리까지만 펼친다 (루트 10 + 자식 300)', () => {
    expect(visibleCount(nodes, defaultExpanded(nodes, 'rail'))).toBe(310);
  });

  it('가지를 펼치면 그만큼만 늘어난다 — 형제 가지는 여전히 접혀 있다', () => {
    const open = new Set([...defaultExpanded(nodes, 'rail'), 'r0c0']);
    expect(visibleCount(nodes, open)).toBe(311);
  });
});
