// Task·클레임 표면의 요청 스키마 — 정본: api.md §2.4 (EP-TASK)
//
// 규율은 `tenancy.ts` 와 같다: `.strict()` 로 알 수 없는 키를 거절하고, 어휘(enum)는
// 도메인이 본다(REQ-API-112). 여기서 보는 것은 **모양**이다.
//
// 이 모듈에서도 결함 둘이 났다 — `EP-TASK-07` 이 본문을 통째로 버렸고(`void body;`),
// `EP-TASK-08` 의 `state_note` 는 저장할 열까지 만들어 두고 MCP 만 배선돼 있었다.
// 스키마가 있으면 "받는다고 적어 두고 안 읽는" 코드가 눈에 띈다.

import { z } from 'zod';
import {
  AWAITING_REF_MAX,
  AWAITING_REFS_MAX,
  EVIDENCE_NOTE_MAX,
  LEASE_TTL_SECONDS,
} from '../constants.js';
import { BLOCKED_REASONS } from '../enums.js';

/** 증적 한 줄 — 한 Task 가 커밋·PR·테스트를 여럿 남기므로 목록이다(REQ-API-056) */
export const TaskEvidenceInput = z
  .object({
    kind: z.string().min(1),
    locator: z.string().min(1),
    /** 이 증적이 무엇을 보여 주는가(2026-09-28 · REQ-API-229) — locator 뒤에 붙이지 않는다 */
    note: z.string().max(EVIDENCE_NOTE_MAX).nullish(),
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
    /**
     * 재브리핑 — **기준 SpecVersion 을 최신 승인본으로 옮기고 플래그를 지운다**
     * (2026-09-06 · REQ-WEB-036 이 요구하던 EP-TASK-05 경로 · REQ-API-121).
     *
     * `rebrief_required_at` 은 세우는 코드만 있고 **지우는 코드가 없었다** — 화면은 배지를
     * 보이는데 그것을 해소할 길이 어디에도 없었다. 플래그만 지우는 선택지도 있었지만
     * ("봤다") 그러면 Task 는 여전히 옛 버전을 가리켜 다음 사람이 같은 배지를 다시 본다.
     * **재브리핑의 뜻은 기준을 옮기는 것**이다.
     */
    rebrief: z.literal(true).nullish(),
    /**
     * **기준선을 옮긴다**(2026-09-27 사람 결정 M9 · REQ-API-210). 기준선으로 개발하는 작업은 기준 버전만
     * 옮기는 재브리핑을 받지 않는다 — 세트가 섞이기 때문이다. 새 기준선 이름을 주면 작업의 기준선과
     * (출처 문서가 그 세트에 있으면) 기준 버전이 함께 옮겨 간다. `null` 은 기준선을 푼다.
     */
    baseline: z.string().nullish(),
    /**
     * 읽은 본문의 지문(`body_hash`) — 주면 그 사이 본문이 바뀌었을 때 409 `stale_body` 다(2026-09-28 · 사람 결정 D12 ·
     * REQ-API-254). REST 는 주면 검사하고, 도구(`nerv_task_update`)는 본문을 고칠 때 반드시 받는다
     */
    base_hash: z.string().nullish(),
  })
  .strict();

/**
 * EP-TASK-09 — 상태 전이. `done` 은 서버 게이트를 탄다(FR-10).
 *
 * **`note` 는 2026-09-06 에 걷었다**(사람 결정). 전표와 이 스키마에 있었는데 컨트롤러가
 * 넘기지 않고 서비스가 받지 않아 **받고 버려지고 있었다** — 400 도 아니고 저장도 아닌
 * 조용한 성공이라, 에이전트는 노트를 남겼다고 믿고 서버에는 그 노트가 없었다.
 * 전이의 사유를 남기는 칸은 이미 둘이고(`blocked_reason` · `spec_impact`), 셋째 칸이
 * 무엇을 답하는지는 정해진 적이 없다. `.strict()` 덕분에 이제 `note` 는 **400 이다** —
 * 조용한 성공보다 명시적 거절이 낫다.
 */
export const TaskTransitionInput = z
  .object({
    status: z.string().min(1),
    /** 어휘는 `@nerv/schema` 가 정본이다(REQ-CB-006) — 표면이 목록을 다시 적지 않는다 */
    blocked_reason: z.enum(BLOCKED_REASONS).nullish(),
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
    lease_seconds: z.number().int().positive().max(LEASE_TTL_SECONDS).nullish(),
  })
  .strict();

/**
 * 대기 표시 — 종류 · 대상 · 언제까지(REQ-API-275). 모양만 본다: 종류의 어휘(`CLAIM_AWAITING_KINDS`)와 시각의 범위
 * (지금보다 뒤 · 리스 만료 시각 이하)는 도메인이 본다 — MCP 는 이 스키마를 거치지 않는다
 */
export const ClaimAwaitingInput = z
  .object({
    kind: z.string().min(1),
    refs: z.array(z.string().min(1).max(AWAITING_REF_MAX)).max(AWAITING_REFS_MAX).nullish(),
    until: z.string().min(1).nullish(),
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
    lease_seconds: z.number().int().positive().max(LEASE_TTL_SECONDS).nullish(),
    /**
     * **무엇을 기다리는가**(2026-10-09 · REQ-API-275). 주면 `until`(없으면 리스 만료 시각)까지 Stop 훅이 이 클레임을
     * 정리하지 않은 것으로 세지 않는다. 빼고 보내면 지운다 — 다시 일을 시작한 하트비트가 곧 대기의 끝이다
     */
    awaiting: ClaimAwaitingInput.nullish(),
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
