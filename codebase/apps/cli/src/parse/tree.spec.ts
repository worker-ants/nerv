// 디렉터리 계층 → 스펙 트리 (importer.md §2.2)
//
// 이 규칙이 없으면 모든 문서가 최상위에 평탄하게 붙는다 — clemvion 130편이 한 층에
// 늘어서면 트리는 항해 수단이 아니라 목록이 된다(실측 2026-08-23).

import { describe, expect, it } from 'vitest';
import { setLocaleForTesting } from '../i18n.js';
import { buildTreeForTesting } from '../run.js';
import type { ImportProfile, ImportSpecItem } from '@nerv/schema';

setLocaleForTesting('ko');

const profile = {
  profile: 'test',
  version: 1,
  scan: { spec: ['spec/**/*.md'], plan: [], exclude: [] },
  tree: {
    area_from_directory: true,
    area_body_file: '_product-overview.md',
    leaf_type: 'feature',
    overrides: {},
  },
  frontmatter: { id: 'spec.key', status_map: {} },
  requirement: { id_pattern: '[A-Z]+-\\d+' },
  task: { status_map: {}, unstarted_sentinel: '(unstarted)' },
} as unknown as ImportProfile;

function item(path: string, key: string): ImportSpecItem {
  return {
    source_path: path,
    key,
    parent_key: null,
    type: 'feature',
    title: key,
    body_md: '본문',
    doc_status: 'approved',
    sort_key: '',
    requirements: [],
    evidence: [],
  };
}

describe('area 트리', () => {
  it('디렉터리마다 area 노드를 만들고 파일을 그 아래 붙인다', () => {
    const entries: never[] = [];
    const out = buildTreeForTesting(
      [item('spec/nav/1-login.md', 'login'), item('spec/nav/2-home.md', 'home')],
      profile,
      entries,
    );
    const area = out.find((i) => i.type === 'area');
    expect(area?.key).toBe('nav');
    expect(out.filter((i) => i.parent_key === 'nav')).toHaveLength(2);
  });

  it('area_body_file 은 리프가 아니라 **그 디렉터리의 area 노드**가 된다', () => {
    const out = buildTreeForTesting(
      [item('spec/nav/_product-overview.md', 'navigation'), item('spec/nav/1-login.md', 'login')],
      profile,
      [],
    );
    // frontmatter id 를 선언했으므로 그 고정 ID 를 area 가 승계한다(FR-01)
    expect(out.find((i) => i.type === 'area')?.key).toBe('navigation');
    expect(out.filter((i) => i.type === 'area')).toHaveLength(1);
    expect(out.find((i) => i.key === 'login')?.parent_key).toBe('navigation');
  });

  it('중간 디렉터리가 비어 있어도 계층이 끊기지 않는다', () => {
    const out = buildTreeForTesting([item('spec/a/b/c/x.md', 'x')], profile, []);
    const areas = out.filter((i) => i.type === 'area').map((i) => i.key);
    expect(areas).toEqual(expect.arrayContaining(['a', 'a-b', 'a-b-c']));
    expect(out.find((i) => i.key === 'x')?.parent_key).toBe('a-b-c');
    expect(out.find((i) => i.key === 'a')?.parent_key).toBeNull();
  });

  it('스캔 뿌리 바로 아래 문서는 최상위다 — 뿌리는 노드가 되지 않는다', () => {
    const out = buildTreeForTesting([item('spec/0-overview.md', 'overview')], profile, []);
    expect(out.find((i) => i.key === 'overview')?.parent_key).toBeNull();
    expect(out.filter((i) => i.type === 'area')).toHaveLength(0);
  });

  it('대표 문서가 없는 영역은 본문 없는 노드로 만들고 리포트에 남긴다', () => {
    const entries: { file: string; reason: string }[] = [];
    const out = buildTreeForTesting(
      [item('spec/nav/1-login.md', 'login')],
      profile,
      entries as never,
    );
    expect(out.find((i) => i.type === 'area')?.body_md).toBe('');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.file).toBe('nav');
  });
});

describe('buildTreeForTesting — sort_key 승계', () => {
  it('area 는 대표 문서가 아니라 **디렉터리 이름**에서 순서를 얻는다', () => {
    // `_product-overview.md` 에는 숫자 접두가 없다. 대표 문서 이름을 보면 모든 area 가
    // 동률이 되어 원본 순서가 사라진다 — 순서를 가진 쪽은 디렉터리다.
    const items = [
      item('spec/1-logic/_product-overview.md', 'logic'),
      item('spec/10-data/_product-overview.md', 'data'),
      item('spec/2-flow/_product-overview.md', 'flow'),
    ];
    const areas = buildTreeForTesting(items, profile, []).filter((s) => s.type === 'area');
    const order = [...areas].sort((a, b) => a.sort_key.localeCompare(b.sort_key)).map((s) => s.key);
    expect(order).toEqual(['logic', 'flow', 'data']);
  });
});
