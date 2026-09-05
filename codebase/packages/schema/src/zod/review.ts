// 리뷰·승인·질문 표면의 요청 스키마 — 정본: api.md §2.6·§2.7 (EP-REV · EP-APR · EP-QST)
//
// 규율은 `tenancy.ts` 와 같다: `.strict()` 로 알 수 없는 키를 거절하고, 어휘(enum)는
// 도메인이 본다(REQ-API-112 · `resolutionOf` · `ESCALATE_REASONS`).

import { z } from 'zod';

/** 리뷰어 한 명의 자기 보고 — 위험도는 세션 위험도의 재료다 */
export const ReviewerReportInput = z
  .object({
    role: z.string().nullish(),
    risk: z.string().nullish(),
    body_md: z.string().nullish(),
  })
  .strict();

/** 발견 한 줄 — `fingerprint` 는 서버가 만든다(라운드를 넘어 하나로 유지하기 위해) */
export const ReviewFindingInput = z
  .object({
    severity: z.string().min(1),
    title: z.string().min(1),
    body: z.string().nullish(),
    suggestion: z.string().nullish(),
    file: z.string().nullish(),
    line: z.number().int().nullish(),
    area: z.string().nullish(),
    category: z.string().nullish(),
    requirement_id: z.string().nullish(),
  })
  .passthrough();

/**
 * EP-REV-01 — 제출.
 *
 * **입력 커밋 스냅샷이 필수다**(D-07). 그것 없이는 "어느 코드에 대한 지적인가" 를
 * 나중에 되물을 수 없고, 그러면 발견은 산문으로 되돌아간다.
 */
export const ReviewSubmitInput = z
  .object({
    repo: z.string().nullish(),
    branch: z.string().min(1),
    base_sha: z.string().min(1),
    head_sha: z.string().min(1),
    changeset: z.array(z.string()).default([]),
    kind: z.string().default('code'),
    round_of: z.string().nullish(),
    reviewer: ReviewerReportInput.nullish(),
    summary: z.string().nullish(),
    findings: z.array(ReviewFindingInput).default([]),
    task_id: z.string().nullish(),
    payload_ref: z.string().nullish(),
    session_id: z.string().nullish(),
  })
  .strict();

/**
 * EP-REV-03 — 처분.
 *
 * `escalate_reason` 은 `escalated` 의 **필수 짝**이고 그 판정은 도메인이 한다
 * (REQ-API-108 — 사유 없는 에스컬레이션은 처분이 아니라 방치다).
 */
export const FindingResolveInput = z
  .object({
    resolution: z.string().default('dismissed'),
    rationale: z.string().min(1),
    commit_sha: z.string().nullish(),
    change_request_id: z.string().nullish(),
    spec_version_id: z.string().nullish(),
    escalate_reason: z.string().nullish(),
  })
  .strict();

/** EP-REV-05 — 발견 코멘트. 사람이 지적에 답하는 자리다 */
export const FindingCommentInput = z.object({ body_md: z.string().min(1) }).strict();

/** EP-APR-04 — 게이트 면제. **면제도 결재 레코드다**(FR-10) */
export const GateBypassInput = z
  .object({
    subject_id: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

/**
 * EP-APR-03 — 결정.
 *
 * `seen_content_hash` 는 **무엇을 보고 승인했는가**다 — 본문이 그 뒤 바뀌었으면
 * 그 승인은 다른 문서에 대한 것이라 막힌다.
 */
export const ApprovalDecisionInput = z
  .object({
    decision: z.string().default('comment'),
    comment: z.string().nullish(),
    seen_content_hash: z.string().nullish(),
  })
  .strict();

/** EP-QST-02 — 답변. 선택지를 골랐으면 키, 자유 서술이면 본문 */
export const QuestionAnswerInput = z
  .object({
    answer_key: z.string().nullish(),
    answer_md: z.string().nullish(),
  })
  .strict();
