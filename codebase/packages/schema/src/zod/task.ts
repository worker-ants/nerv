// Task·클레임 표면의 요청 스키마 — 정본: api.md §2.4 (EP-TASK)
//
// 규율은 `tenancy.ts` 와 같다: `.strict()` 로 알 수 없는 키를 거절하고, 어휘(enum)는
// 도메인이 본다(REQ-API-112). 여기서 보는 것은 **모양**이다.
//
// 이 모듈에서도 결함 둘이 났다 — `EP-TASK-07` 이 본문을 통째로 버렸고(`void body;`),
// `EP-TASK-08` 의 `state_note` 는 저장할 열까지 만들어 두고 MCP 만 배선돼 있었다.
// 스키마가 있으면 "받는다고 적어 두고 안 읽는" 코드가 눈에 띈다.

import { z } from 'zod';

/** 증적 한 줄 — 한 Task 가 커밋·PR·테스트를 여럿 남기므로 목록이다(REQ-API-056) */
export const TaskEvidenceInput = z
  .object({
    kind: z.string().min(1),
    locator: z.string().min(1),
  })
  .strict();

/**
 * EP-TASK-03 — 생성.
 *
 * **위임 명세 4요소가 차야 서버가 `ready` 로 올린다**(D-09). 그래서 넷 다 선택이다:
 * 덜 찬 채로 만들 수 있어야 "이건 이번 작업 밖의 별도 건이다" 를 남길 자리가 생긴다.
 */
export const TaskCreateInput = z
  .object({
    title: z.string().min(1),
    body_md: z.string().nullish(),
    source_spec_version_id: z.string().nullish(),
    baseline: z.string().nullish(),
    source_requirement_id: z.string().nullish(),
    priority: z.string().nullish(),
    goal_md: z.string().nullish(),
    output_format_md: z.string().nullish(),
    tools_sources_md: z.string().nullish(),
    boundaries_md: z.string().nullish(),
  })
  .strict();

/** EP-TASK-05 — 수정. 주지 않은 값은 건드리지 않는다 */
export const TaskUpdateInput = z
  .object({
    title: z.string().nullish(),
    body_md: z.string().nullish(),
    priority: z.string().nullish(),
    goal_md: z.string().nullish(),
    output_format_md: z.string().nullish(),
    tools_sources_md: z.string().nullish(),
    boundaries_md: z.string().nullish(),
    assignee_user_id: z.string().nullish(),
    depends_on: z.array(z.string()).nullish(),
  })
  .strict();

/** EP-TASK-09 — 상태 전이. `done` 은 서버 게이트를 탄다(FR-10) */
export const TaskTransitionInput = z
  .object({
    status: z.string().min(1),
    note: z.string().nullish(),
    blocked_reason: z.string().nullish(),
    spec_impact: z.record(z.string(), z.unknown()).nullish(),
    evidence: z.array(TaskEvidenceInput).nullish(),
  })
  .strict();

/** 클레임이 선언하는 작업 범위 — 서버가 겹침을 본다(D-04) */
export const ClaimScopeInput = z
  .object({
    spec_ids: z.array(z.string()).default([]),
    file_globs: z.array(z.string()).default([]),
  })
  .strict();

/** EP-TASK-06 — 클레임 */
export const TaskClaimInput = z
  .object({
    session_id: z.string().nullish(),
    scope: ClaimScopeInput.default({ spec_ids: [], file_globs: [] }),
    lease_seconds: z.number().int().positive().nullish(),
  })
  .strict();

/**
 * EP-TASK-07 — 하트비트.
 *
 * 이 셋이 **`void body;` 한 줄에 통째로 버려지고 있었다**(2026-09-05 · REQ-API-100).
 * 세션 카드의 +N −M 이 REST 경로에서만 비던 이유다.
 */
export const HeartbeatInput = z
  .object({
    progress: z.string().nullish(),
    stats: z
      .object({
        added: z.number().int().nullish(),
        removed: z.number().int().nullish(),
        files: z.number().int().nullish(),
      })
      .strict()
      .nullish(),
    lease_seconds: z.number().int().positive().nullish(),
  })
  .strict();

/**
 * EP-TASK-08 — 내려놓기.
 *
 * `reason` 의 어휘는 `CLAIM_RELEASE_INPUTS` 셋이고 판정은 도메인이 한다 —
 * 예전에는 REST 가 "셋 중 하나가 아니면 handoff" 로 **조용히 바꾸고** 있었다.
 */
export const ClaimReleaseInput = z
  .object({
    reason: z.string().min(1),
    state_note: z.string().nullish(),
  })
  .strict();
