// 임포트 계약 — apps/api ↔ apps/cli 공유 (codebase.md §1.1 · api.md §2.10)
//
// 이 스키마가 schema 패키지에 있는 이유가 임포터 구조의 핵심이다. CLI 는 원본 파일 옆에서
// 돌고 서버는 그 파일을 볼 수 없으므로(importer.md §3.2), 둘 사이를 잇는 것은 **이 타입뿐**이다.
// 서버는 프로파일도 파싱 규칙도 모른다 — 이미 판정된 결과만 받는다.

import { z } from 'zod';

/** 프로파일 — **클라이언트 것이다.** 서버는 이름만 기록한다(importer.md §1.4 경계 1). */
export const importProfileSchema = z.object({
  profile: z.string().min(1),
  version: z.literal(1),
  scan: z.object({
    spec: z.array(z.string()).default([]),
    plan: z.array(z.string()).default([]),
    /** 재생성 가능한 산출물은 옮기지 않는다(D-07) */
    exclude: z.array(z.string()).default([]),
  }),
  /**
   * 기대 집계 — **선택이다**(REQ-IMP-016). clemvion 처럼 실측 정본이 있는 대상은 선언해
   * "측정 방법이 흔들리는 수치"(P4)를 방어하고, 신규 대상은 선언 없이 계정만 한다.
   */
  expect: z
    .object({
      spec_total: z.number().int().positive().optional(),
      status_distribution: z.record(z.string(), z.number().int()).optional(),
      /** plan 패스의 기대 집계 — clemvion 은 450건·complete 387 이 실측 정본이다(importer.md §2.6) */
      plan_total: z.number().int().positive().optional(),
      plan_status_distribution: z.record(z.string(), z.number().int()).optional(),
    })
    .optional(),
  tree: z
    .object({
      area_from_directory: z.boolean().default(true),
      area_body_file: z.string().optional(),
      leaf_type: z.string().default('feature'),
      overrides: z.record(z.string(), z.string()).default({}),
    })
    .default({ area_from_directory: true, leaf_type: 'feature', overrides: {} }),
  frontmatter: z.object({
    id: z.string().default('spec.key'),
    /** 원본 status 1축 → 문서 축 × 구현 축 2축 분해(importer.md §2.3) */
    status_map: z.record(z.string(), z.object({ doc: z.string(), impl: z.string() })),
    code: z.string().optional(),
    pending_plans: z.string().optional(),
  }),
  requirement: z
    .object({ id_pattern: z.string().default('[A-Z]+-[A-Z]+-\\d+') })
    .default({ id_pattern: '[A-Z]+-[A-Z]+-\\d+' }),
  task: z
    .object({
      status_map: z.record(z.string(), z.string()).default({}),
      unstarted_sentinel: z.string().optional(),
    })
    .optional(),
});

export type ImportProfile = z.infer<typeof importProfileSchema>;

// ── EP-IMP-01 preflight ────────────────────────────────────────────────────

export const importPreflightItemSchema = z.object({
  source_path: z.string().min(1),
  /** 멱등 키의 축 — (파일 경로 + frontmatter id) (importer.md §3.3) */
  natural_key: z.string().min(1),
  content_hash: z.string().min(1),
});

export const importPreflightInputSchema = z.object({
  profile: z.string().min(1),
  root_commit: z.string().optional(),
  kind: z.enum(['spec', 'plan']),
  items: z.array(importPreflightItemSchema).max(1000),
});

/** 항목 상태 — 재실행이 변경분만 보내게 하는 판정(§3.4) */
export const importItemStateSchema = z.enum(['new', 'unchanged', 'changed', 'conflict']);

export const importPreflightResultSchema = z.object({
  items: z.array(
    z.object({
      source_path: z.string(),
      natural_key: z.string(),
      state: importItemStateSchema,
      spec_id: z.string().nullable(),
      version_no: z.number().int().nullable(),
    }),
  ),
});

// ── EP-IMP-02 specs ────────────────────────────────────────────────────────

export const importRequirementSchema = z.object({
  ref: z.string().min(1),
  text: z.string().min(1),
  priority: z.enum(['must', 'should', 'could']).default('must'),
  impl_status: z
    .enum(['unimplemented', 'in_progress', 'implemented', 'verified'])
    .default('unimplemented'),
});

export const importSpecItemSchema = z.object({
  source_path: z.string().min(1),
  key: z.string().min(1),
  parent_key: z.string().nullable().optional(),
  type: z.enum(['vision', 'area', 'feature', 'design', 'convention', 'adr']),
  title: z.string().min(1),
  /** 원문 보존이 제1규칙이다(importer.md §2.4) — 서버는 이 본문을 손대지 않는다 */
  body_md: z.string(),
  doc_status: z.enum(['draft', 'in_review', 'approved', 'superseded', 'deprecated']),
  requirements: z.array(importRequirementSchema).default([]),
  evidence: z.array(z.object({ kind: z.string(), locator: z.string() })).default([]),
});

export const importSpecBatchInputSchema = z.object({
  profile: z.string().min(1),
  root_commit: z.string().optional(),
  /** structure = 트리 골격(배치 1 트랜잭션) · document = 본문(파일 1건 = 트랜잭션 1건) */
  kind: z.enum(['structure', 'document']),
  items: z.array(importSpecItemSchema).max(200),
});

// ── EP-IMP-03 tasks ────────────────────────────────────────────────────────

export const importTaskItemSchema = z.object({
  source_path: z.string().min(1),
  title: z.string().min(1),
  body_md: z.string().default(''),
  /**
   * **`ready` 는 받지 않는다**(REQ-IMP-009). ready 는 위임 명세 4요소와 의존 판정을 통과했다는
   * 뜻인데 임포트한 Task 에는 그 근거가 없다 — 소급 적재가 ready 큐를 오염시키면 에이전트가
   * 근거 없는 작업을 집어간다.
   */
  status: z.enum(['backlog', 'claimed', 'in_progress', 'in_review', 'done', 'blocked']),
  assignee_user_id: z.string().nullable().optional(),
  source_spec_key: z.string().nullable().optional(),
  depends_on: z.array(z.string()).default([]),
  blocked_reason: z.string().nullable().optional(),
});

export const importTaskBatchInputSchema = z.object({
  profile: z.string().min(1),
  root_commit: z.string().optional(),
  items: z.array(importTaskItemSchema).max(200),
});

// ── EP-IMP-04 links ────────────────────────────────────────────────────────

export const importLinkBatchInputSchema = z.object({
  profile: z.string().min(1),
  relations: z
    .array(
      z.object({
        from_key: z.string(),
        to_key: z.string(),
        kind: z.enum(['references', 'refines', 'depends_on', 'duplicates', 'supersedes']),
      }),
    )
    .default([]),
  pending: z
    .array(z.object({ requirement_ref: z.string(), task_source_path: z.string() }))
    .default([]),
});

// ── 공통 결과 봉투 ─────────────────────────────────────────────────────────

/**
 * 항목별 결과. 배치는 전송 단위일 뿐이라 **한 항목의 실패가 배치를 되돌리지 않는다**
 * (api.md §2.10 · REQ-API-018). 실패는 리포트로 가고 나머지는 커밋된다.
 */
export const importItemResultSchema = z.object({
  source_path: z.string(),
  status: z.enum(['ok', 'error', 'skipped']),
  spec_id: z.string().optional(),
  spec_version_id: z.string().optional(),
  task_id: z.string().optional(),
  requirement_refs: z.record(z.string(), z.string()).optional(),
  code: z.string().optional(),
  detail: z.string().optional(),
});

export const importBatchResultSchema = z.object({
  applied: z.number().int(),
  errors: z.number().int(),
  skipped: z.number().int(),
  items: z.array(importItemResultSchema),
});

export type ImportPreflightInput = z.infer<typeof importPreflightInputSchema>;
export type ImportPreflightResult = z.infer<typeof importPreflightResultSchema>;
export type ImportSpecBatchInput = z.infer<typeof importSpecBatchInputSchema>;
export type ImportSpecItem = z.infer<typeof importSpecItemSchema>;
export type ImportTaskItem = z.infer<typeof importTaskItemSchema>;
export type ImportTaskBatchInput = z.infer<typeof importTaskBatchInputSchema>;
export type ImportLinkBatchInput = z.infer<typeof importLinkBatchInputSchema>;
export type ImportBatchResult = z.infer<typeof importBatchResultSchema>;
export type ImportItemResult = z.infer<typeof importItemResultSchema>;
export type ImportItemState = z.infer<typeof importItemStateSchema>;
