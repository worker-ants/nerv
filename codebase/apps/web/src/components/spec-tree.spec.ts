// E08-S10 — 트리 조립 (screens.md §2.4 · REQ-WEB-041)

import { describe, expect, it } from 'vitest';
import { groupByParent } from './spec-tree.js';
import type { TreeNode } from './spec-tree.js';

const node = (id: string, parent: string | null): TreeNode => ({
  id,
  key: `SPC-${id}`,
  title: id,
  type: 'feature',
  parent_id: parent,
  doc_status: 'approved',
  version_no: 1,
});

describe('평면 목록 → 계층', () => {
  it('부모별로 묶는다 — 루트는 null 키다', () => {
    const map = groupByParent([node('a', null), node('b', 'a'), node('c', 'a'), node('d', null)]);
    expect(map.get(null)?.map((n) => n.id)).toEqual(['a', 'd']);
    expect(map.get('a')?.map((n) => n.id)).toEqual(['b', 'c']);
  });

  it('서버가 준 순서를 유지한다 — 정렬은 서버 몫(sort_key)이다', () => {
    const map = groupByParent([node('z', null), node('a', null)]);
    expect(map.get(null)?.map((n) => n.id)).toEqual(['z', 'a']);
  });

  // 이 테스트는 예전에 **결함을 지키고 있었다**: 부모 키 아래에 남겨 두는 것을 "잃어버리지
  // 않는다"로 읽었지만, 렌더는 뿌리에서 내려가므로 그 노드는 화면에서 사라졌다. 목록에
  // 없으면 열람도 없다(REQ-WEB-101) — 그래서 뿌리로 올린다.
  it('부모를 못 찾은 노드는 뿌리로 올린다 — 트리에 자리가 없다고 문서를 지우지 않는다', () => {
    const map = groupByParent([node('a', null), node('orphan', 'missing-parent')]);
    expect(map.get(null)?.map((n) => n.id)).toEqual(['a', 'orphan']);
    expect(map.get('missing-parent')).toBeUndefined();
  });

  it('부모가 있는 노드는 그대로 부모 밑이다 — 승격은 못 찾았을 때만이다', () => {
    const map = groupByParent([node('a', null), node('b', 'a')]);
    expect(map.get(null)?.map((n) => n.id)).toEqual(['a']);
    expect(map.get('a')?.map((n) => n.id)).toEqual(['b']);
  });
});
