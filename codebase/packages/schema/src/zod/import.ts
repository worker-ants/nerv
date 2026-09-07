// 임포트 계약 — apps/api ↔ apps/cli 공유 (codebase.md §1.1 · api.md §2.10)
//
// 이 스키마가 schema 패키지에 있는 이유가 임포터 구조의 핵심이다. CLI 는 원본 파일 옆에서
// 돌고 서버는 그 파일을 볼 수 없으므로(importer.md §3.2), 둘 사이를 잇는 것은 **이 타입뿐**이다.
// 서버는 프로파일도 파싱 규칙도 모른다 — 이미 판정된 결과만 받는다.

import { z } from 'zod';
import { BLOCKED_REASONS } from '../enums.js';

/** 프로파일 — **클라이언트 것이다.** 서버는 이름만 기록한다(importer.md §1.4 경계 1). */
export const importProfileSchema = z.object({
  profile: z.string().min(1),
  version: z.literal(1),
  scan: z.object({
    spec: z.array(z.string()).default([]),
    plan: z.array(z.string()).default([]),
    /**
     * 리뷰 세션의 `SUMMARY.md` 를 가리킨다(FR-09 임포트). 역할별 md·`_prompts/` 는
     * **가리키지 않는다** — 옮기는 것은 결론이지 재생성 가능한 입력이 아니다(D-07).
     */
    review: z.array(z.string()).default([]),
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
      /** review 패스 — clemvion 은 SUMMARY.md 1,984건이 실측 정본이다(2026-08-24) */
      review_total: z.number().int().positive().optional(),
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
    /**
     * 원본에 `status` 가 없을 때 쓸 문서 축 값(importer.md §5.1).
     *
     * **없으면 draft 다.** 이 저장소의 문서 23편은 전부 frontmatter 를 갖지만 그중 15편에
     * `status` 가 없다(2026-09-07 실측) — 기본이 draft 면 승인된 정본 15편이 초안으로
     * 적재되고, 그러면 첫 임포트의 결과가 사실과 다르다.
     */
    status_default: z.string().optional(),
    /**
     * 적재하지는 않지만 **매니페스트에 남길** frontmatter 키(importer.md §3.3).
     *
     * 이 저장소의 `updated`·`referenced_by` 가 그런 값이다 — NERV 의 필드로 옮길 자리가
     * 없지만 원본으로 되돌릴 때 필요하고, 잃으면 md 로 다시 쓸 수 없다(정보 손실 0).
     */
    preserve: z.array(z.string()).default([]),
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

/**
 * 한 배치의 항목 상한 — **계약이 정하고 클라이언트가 지킨다.**
 *
 * 상수로 내보내는 이유는 CLI 가 `--batch-size` 를 사람에게서 받기 때문이다. 값을 그대로
 * 믿으면 큰 수가 왔을 때 서버가 스키마 위반으로 거절하고, 사람은 "왜 거절당했는지"를
 * 계약 문서를 열어야 안다. 숫자를 양쪽에 따로 적으면 그 순간 두 벌이 된다(REQ-CB-006 의 정신).
 */
export const IMPORT_BATCH_MAX = 200;

// ── EP-IMP-02 specs ────────────────────────────────────────────────────────

export const importRequirementSchema = z.object({
  ref: z.string().min(1),
  text: z.string().min(1),
  /**
   * 수용 기준 셀의 원문 — **EARS 정규화는 자동으로 하지 않는다**(importer.md §2.5 규칙 2).
   * 수용 기준 열이 따로 없으면 null 이다: 설명 셀을 복사해 두 벌로 만들지 않는다.
   */
  acceptance_md: z.string().nullable().default(null),
  /**
   * **미표기는 null 이다**(§2.5 규칙 4). 기본값을 `must` 로 두면 표기가 없던 행과 필수라고
   * 적힌 행이 저장에서 같아지고, 그 순간 "추정하지 않는다" 는 규칙이 코드에서 사라진다.
   * CLI 는 null 을 보낼 때 `req-priority-missing` 을 수동 확인 큐에 함께 올린다(§4.1).
   */
  priority: z.enum(['must', 'should', 'could']).nullable().default(null),
  impl_status: z
    .enum(['unimplemented', 'in_progress', 'implemented', 'verified'])
    .default('unimplemented'),
  /** 문서 내 정의 순서 — `requirement_version.ordinal` 이 된다(§2.5 규칙 7) */
  ordinal: z.number().int().nonnegative().default(0),
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
  /**
   * 형제 정렬 키. **원본의 순서는 원본만 안다** — `0-common.md`·`1-logic/` 의 숫자 접두는
   * 저자가 읽는 순서를 적어 둔 것인데, 키·제목 어디에도 남지 않아 임포트를 지나면 사라진다.
   * 그래서 계약에 필드를 둔다: 규칙(무엇이 순서를 뜻하는가)은 프로파일을 아는 CLI 가 정하고,
   * 서버는 판정 없이 값만 받는다(importer.md §1.4 경계 1).
   *
   * 생략하면 빈 문자열 — 트리는 `ORDER BY sort_key, key` 이므로 키 알파벳 순으로 돌아간다.
   */
  sort_key: z.string().default(''),
  requirements: z.array(importRequirementSchema).default([]),
  evidence: z.array(z.object({ kind: z.string(), locator: z.string() })).default([]),
});

export const importSpecBatchInputSchema = z.object({
  profile: z.string().min(1),
  root_commit: z.string().optional(),
  /** structure = 트리 골격(배치 1 트랜잭션) · document = 본문(파일 1건 = 트랜잭션 1건) */
  kind: z.enum(['structure', 'document']),
  items: z.array(importSpecItemSchema).max(IMPORT_BATCH_MAX),
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
  /**
   * 막힘 사유 — **어휘는 하나다**(`BLOCKED_REASONS` · REQ-API-117).
   *
   * 임포터도 예외가 아니다: 세 표면(임포터·MCP·웹)이 각자 다른 문자열을 넣으면 화면의
   * 막힘 필터가 그 순간부터 사실을 못 센다. 원본이 어휘 밖의 말을 적었으면 **NULL 로
   * 두고 수동 확인 큐로 올린다** — 지어내지 않는 것이 §2.5 규칙 4 와 같은 원칙이다.
   */
  blocked_reason: z.enum(BLOCKED_REASONS).nullable().optional(),
  /**
   * 완료 시각 — **적재 시각이 아니다**(2026-08-24 신설).
   *
   * 비워 두면 서버가 `now()` 로 채우는데, 그러면 과거에 끝난 계획 419건이 전부 "지금
   * 끝난 것"이 되고 **완료 창(`TASK_DONE_WINDOW_DAYS`)이 무의미해진다** — 보관 보기
   * 토글이 아무것도 드러내지 못한 이유가 그것이었다(실측). 원본 frontmatter 에는
   * 완료일이 없으므로 임포터가 git 에서 되찾는다(importer.md §2.6d).
   */
  done_at: z.string().nullable().optional(),
  /**
   * 우선순위 — **미표기는 보내지 않는다**(2026-09-07 · REQ-IMP-027).
   *
   * 계획 문서는 우선순위를 적지 않는데 열이 `NOT NULL DEFAULT 'P2'` 라 481건이 전부
   * `P2` 로 적재됐고, 보드는 그것을 **사람이 고른 값**으로 그렸다. 0024 가 열을 열었으므로
   * 이제 미표기는 NULL 이다 — `P2` 의 축약이 아니라 표기가 없었다는 사실이다.
   */
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).nullable().optional(),
  /**
   * 원본이 적은 생성 시각 — `done_at` 과 같은 이유다(적재 시각이 아니다).
   *
   * 계획의 `started:` 를 임포터가 계산해 놓고 **계약에 실을 자리가 없어 버리고 있었다**
   * (2026-09-07 실측). 비우면 서버가 `now()` 로 채운다.
   */
  created_at: z.string().nullable().optional(),
  /**
   * 스펙 영향 선언 — **done 게이트의 입력**이다(REQ-API-146).
   *
   * 서버는 `done` 으로 적재하는 Task 에 `{"none": true}` 를 넣고 있었는데, 그것은
   * "영향 없음을 **확인했다**" 는 선언이라 지어 넣으면 **거짓 부정**이다. 임포터가
   * 계산한 값이 있으면 그것을 싣고, 없으면 서버가 `{"unknown": true}` 로 적는다 —
   * 게이트는 키 이름을 보지 않고 비어 있지 않음만 보므로 판정은 그대로다.
   */
  spec_impact: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const importTaskBatchInputSchema = z.object({
  profile: z.string().min(1),
  root_commit: z.string().optional(),
  items: z.array(importTaskItemSchema).max(IMPORT_BATCH_MAX),
});

// ── EP-IMP-06 reviews (FR-09 · 2026-08-24) ─────────────────────────────────
//
// **리뷰를 파일에서 레코드로 옮기는 경로다.** clemvion 의 `review/**` 는 md 13,777개이고
// 그 자체가 다음 리뷰의 입력이 되는 자기증식 루프였다(D-01·D-07). 임포트는 그 산출물을
// 한 번만 읽어 결론(Finding)으로 옮긴다 — 옮기고 나면 파일은 이력일 뿐이다.
//
// 이 계약이 `nerv_review_submit` 과 다른 점은 하나다: **리뷰어가 여럿**이다. 원본의 한
// 세션 디렉터리에는 역할별 md 가 여러 개 있고, 그것이 곧 한 세션의 여러 reviewer_report 다.

export const importReviewFindingSchema = z.object({
  severity: z.enum(['critical', 'warning', 'info']),
  category: z.string().default(''),
  title: z.string().min(1),
  detail_md: z.string().nullable().optional(),
  suggestion_md: z.string().nullable().optional(),
  file: z.string().nullable().optional(),
  line: z.number().int().nullable().optional(),
  tags: z.array(z.string()).default([]),
});

export const importReviewReportSchema = z.object({
  role: z.string().min(1),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  body_md: z.string().nullable().optional(),
});

export const importReviewItemSchema = z.object({
  /** 원본 세션 디렉터리 — 리포트의 식별자이고 재실행 대조의 축이다 */
  source_path: z.string().min(1),
  kind: z.enum(['code', 'consistency', 'spec_coverage', 'merge']),
  /**
   * 입력 스냅샷 3종. **원본에는 없다** — clemvion `meta.json` 에 이 필드 자체가 없어
   * 임포터가 git 에서 되찾는다(importer.md §2.7). 되찾지 못하면 그 세션은 건너뛴다:
   * 무엇을 봤는지 답할 수 없는 리뷰는 게이트의 근거가 되지 못한다.
   */
  branch: z.string().min(1),
  base_sha: z.string().min(1),
  head_sha: z.string().min(1),
  changeset: z.array(z.string()).default([]),
  /** 원본이 돌던 시각 — 지금이 아니다. 타임라인이 임포트 시각으로 뭉치면 이력이 사라진다 */
  reviewed_at: z.string().optional(),
  /** consistency 의 `BLOCK: YES/NO` 계승 */
  block: z.boolean().default(false),
  reports: z.array(importReviewReportSchema).default([]),
  findings: z.array(importReviewFindingSchema).default([]),
});

export const importReviewBatchInputSchema = z.object({
  profile: z.string().min(1),
  items: z.array(importReviewItemSchema).max(IMPORT_BATCH_MAX),
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
export type ImportReviewFinding = z.infer<typeof importReviewFindingSchema>;
export type ImportReviewItem = z.infer<typeof importReviewItemSchema>;
export type ImportReviewBatchInput = z.infer<typeof importReviewBatchInputSchema>;
export type ImportBatchResult = z.infer<typeof importBatchResultSchema>;
export type ImportItemResult = z.infer<typeof importItemResultSchema>;
export type ImportItemState = z.infer<typeof importItemStateSchema>;

// ── 전표가 쓰는 이름 ────────────────────────────────────────────────────────
//
// §1.7 은 "요청 열은 zod 스키마 이름이고 export 와 1:1" 이라 못 박는다. 이 파일은
// `…Schema` 접미사를 쓰고 전표는 안 쓴다 — **둘 다 옳게 만드는 값싼 길**은 별칭이다.
// `contract.spec.ts` 가 이 1:1 을 센다(REQ-API-113).

export const ImportPreflightInput = importPreflightInputSchema;
export const ImportSpecBatchInput = importSpecBatchInputSchema;
export const ImportTaskBatchInput = importTaskBatchInputSchema;
export const ImportLinkBatchInput = importLinkBatchInputSchema;
export const ImportReviewBatchInput = importReviewBatchInputSchema;
