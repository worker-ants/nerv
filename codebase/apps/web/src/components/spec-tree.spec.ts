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

  it('부모가 목록에 없어도 잃어버리지 않는다 — 지연 로드 중간 상태', () => {
    const map = groupByParent([node('orphan', 'missing-parent')]);
    expect(map.get('missing-parent')?.map((n) => n.id)).toEqual(['orphan']);
  });
});
