// 내장 프로파일 — nerv-docs (importer.md §5 도그푸딩)
//
// 이 제안서 문서 세트가 NERV 의 첫 임포트 대상이다. 각 문서 머리의 frontmatter
// (`id: SPC-MVP-CODEBASE` 등)가 이 프로파일의 자연 키다 — backlog.md §1.2 가 그 이유를 적었다.

import type { ImportProfile } from '@nerv/schema';

export const nervDocsProfile: ImportProfile = {
  profile: 'nerv-docs',
  version: 1,
  scan: {
    spec: ['**/*.md'],
    plan: [],
    // 이 프로파일은 문서만 옮긴다 — 리뷰 산출물이 없다
    review: [],
    // html 파생본은 원본이 아니다. **README.md 는 뺀 적이 없다**(2026-09-07 정정) —
    // §5.1 은 그것을 `vision` 노드로 적재하라고 적는데 프로파일이 제외하고 있었다.
    exclude: ['html/**'],
  },
  tree: {
    area_from_directory: true,
    // 문서 세트의 잎은 설계 문서다 — `feature` 는 clemvion 의 잎 종류였다(§5.1)
    leaf_type: 'design',
    overrides: { 'README.md': 'vision' },
  },
  frontmatter: {
    id: 'spec.key',
    status_map: {
      draft: { doc: 'draft', impl: 'unimplemented' },
      approved: { doc: 'approved', impl: 'unimplemented' },
    },
    // **`status` 없는 15편이 초안이 아니다**(2026-09-07 실측 — 23편 전부 frontmatter 는
    // 있고 그중 15편에 `status` 가 없다). 기본이 draft 면 승인된 정본이 초안으로 적재된다.
    status_default: 'approved',
    // NERV 필드로 옮길 자리가 없지만 원본으로 되돌릴 때 필요한 값들 — 잃으면 md 로 다시
    // 쓸 수 없다(정보 손실 0 · §3.3)
    preserve: ['updated', 'referenced_by'],
  },
  requirement: { id_pattern: 'REQ-[A-Z]+-\\d+' },
};
