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
    // html 파생본과 자산은 원본이 아니다
    exclude: ['html/**', 'README.md'],
  },
  tree: {
    area_from_directory: true,
    leaf_type: 'feature',
    overrides: {},
  },
  frontmatter: {
    id: 'spec.key',
    status_map: {
      draft: { doc: 'draft', impl: 'unimplemented' },
      approved: { doc: 'approved', impl: 'unimplemented' },
    },
  },
  requirement: { id_pattern: 'REQ-[A-Z]+-\\d+' },
};
