// 내장 프로파일 — clemvion (importer.md §2 가 이 프로파일의 규칙 전문)
//
// **임포터는 clemvion 전용 도구가 아니다.** 엔진은 저장소 이름을 모르고, 저장소마다 다른 것은
// 전부 프로파일 한 곳에 선언된다(§1.4). clemvion 은 그중 하나이며 FR-17 은
// "clemvion 프로파일이 존재하고 그 기대 집계를 통과한다"로 충족된다.

import type { ImportProfile } from '@nerv/schema';

export const clemvionProfile: ImportProfile = {
  profile: 'clemvion',
  version: 1,
  scan: {
    spec: ['spec/**/*.md'],
    plan: ['plan/{in-progress,complete,research}/**/*.md'],
    // 기계생성 API 카탈로그는 옮기지 않는다 — 재생성 가능한 산출물이다(D-07).
    // **접두사를 흘려 받는다**(`*api-catalog`): 실제 디렉터리는 `makeshop-api-catalog`·
    // `cafe24-api-catalog` 이고, 정확 일치 글롭은 249건을 그대로 통과시켰다(실측 2026-08-23).
    exclude: ['spec/**/*api-catalog/**', 'spec/**/*generated/**'],
  },
  // 실측 정본이 있는 대상이라 기대 집계를 선언한다 — "측정 방법이 흔들리는 수치"(P4) 방어
  expect: {
    spec_total: 135,
    status_distribution: { implemented: 117, partial: 17, backlog: 1 },
    // plan 실측(importer.md §2.6 · 로드맵 §7.3(2)): 450건 · complete 387 · research 1
    plan_total: 450,
    plan_status_distribution: { done: 387, reference: 1 },
  },
  tree: {
    area_from_directory: true,
    area_body_file: '_product-overview.md',
    leaf_type: 'feature',
    overrides: { 'conventions/**': 'convention' },
  },
  frontmatter: {
    id: 'spec.key',
    // 원본 status 1축을 문서 축 × 구현 축 2축으로 분해한다(§2.3)
    status_map: {
      implemented: { doc: 'approved', impl: 'implemented' },
      partial: { doc: 'approved', impl: 'in_progress' },
      backlog: { doc: 'draft', impl: 'unimplemented' },
      'spec-only': { doc: 'approved', impl: 'unimplemented' },
      archived: { doc: 'deprecated', impl: 'unimplemented' },
    },
    code: 'evidence.code_path',
    pending_plans: 'requirement.pending_task_links',
  },
  requirement: { id_pattern: '[A-Z]+-[A-Z]+-\\d+' },
  task: {
    status_map: { 'complete/**': 'done', 'research/**': 'reference' },
    unstarted_sentinel: '(unstarted)',
  },
};
