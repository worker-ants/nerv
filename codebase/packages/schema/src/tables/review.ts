// 리뷰 — review_session · reviewer_report · finding · finding_occurrence · resolution · gate_verdict_comparison
// DDL 정본: docs/04-mvp/database.md §2.7 · 필드 의미: data-model §2.6
//
// 표면을 Phase 2 로 계획했으나(scope.md §5) **지금은 전부 들어와 있다**(2026-09-05 현황 정정):
// 도구 2종·REST 7종은 2026-08-23 부터, S6 리뷰 센터 화면과 `/nerv:review` 스킬도 있다.
// head_sha·base_sha·branch 의 NOT NULL 이 이 스키마에서 가장 값싼 개선이다 —
// clemvion meta.json 에는 이 필드 자체가 없어 표본 SUMMARY 200개 중 47개만 산문에 해시를 남겼다.

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  escalateReason,
  findingArea,
  findingSeverity,
  findingStatus,
  resolutionKind,
  reviewKind,
  reviewRisk,
  reviewSot,
  reviewState,
  reviewTrigger,
} from '../enums.js';
import { bytea, createdAt, idPk, ts } from './_columns.js';
import { agentSession } from './session.js';
import { changeRequest, requirement, specVersion } from './spec.js';
import { task } from './task.js';
import { project, user } from './tenancy.js';

export const reviewSession = pgTable(
  'review_session',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    kind: reviewKind('kind').notNull(),
    /** 컬럼명은 trigger — 예약어라 DDL 에서 인용한다 */
    trigger: reviewTrigger('trigger').notNull(),
    agentSessionId: uuid('agent_session_id').references(() => agentSession.id),
    taskId: uuid('task_id').references(() => task.id),
    branch: text('branch').notNull(),
    /** 검토한 커밋 — 커밋 SHA 만 받는다(2026-10-15 · api.md REQ-API-321 · 그 전의 행에는 `HEAD` 같은 값이 있을 수 있다) */
    headSha: text('head_sha').notNull(),
    /** diff 기준 커밋 — 커밋 SHA 만 받는다(REQ-API-321) */
    baseSha: text('base_sha').notNull(),
    /** 라운드 동일성 판정 */
    changesetHash: bytea('changeset_hash').notNull(),
    fileCount: integer('file_count').notNull().default(0),
    roundNo: integer('round_no').notNull().default(1),
    /** 라운드 체인 */
    previousSessionId: uuid('previous_session_id'),
    routing: jsonb('routing').notNull().default({}),
    forcedRoles: text('forced_roles')
      .array()
      .notNull()
      .default(sql`'{}'`),
    forcedCoverageOk: boolean('forced_coverage_ok').notNull().default(false),
    state: reviewState('state').notNull().default('running'),
    /** 완료 시 산출 — running 동안 NULL */
    risk: reviewRisk('risk'),
    /** consistency 의 BLOCK: YES/NO 계승 */
    block: boolean('block').notNull().default(false),
    /** 재생성 가능한 입력 → 오브젝트 스토리지 */
    promptBlobUri: text('prompt_blob_uri'),
    /** 받을 때 그 프로젝트의 보존 정책(`prompt_blob_ttl_days`)으로 정한 만료(2026-10-15 · codebase.md REQ-CB-032) */
    promptExpiresAt: ts('prompt_expires_at'),
    startedAt: ts('started_at')
      .notNull()
      .default(sql`now()`),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_session_gate').on(t.projectId, t.headSha),
    index('review_session_round').on(t.changesetHash, t.roundNo),
  ],
);

export const reviewerReport = pgTable(
  'reviewer_report',
  {
    id: idPk(),
    reviewSessionId: uuid('review_session_id')
      .notNull()
      .references(() => reviewSession.id),
    /** security · requirement · cross-spec 등 역할 키 */
    role: text('role').notNull(),
    risk: reviewRisk('risk').notNull(),
    bodyMd: text('body_md'),
    /** 커버리지 무결성 판정용 3필드 */
    hasReport: boolean('has_report').notNull().default(true),
    forced: boolean('forced').notNull().default(false),
    recovered: boolean('recovered').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('reviewer_report_role_uq').on(t.reviewSessionId, t.role)],
);

/** 라운드를 넘어 하나로 유지되는 지적. fingerprint 가 라운드 불변 dedup 키다(data-model §5.2). */
export const finding = pgTable(
  'finding',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    fingerprint: bytea('fingerprint').notNull(),
    severity: findingSeverity('severity').notNull(),
    /** 'spec_drift' 등 */
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    category: text('category').notNull(),
    title: text('title').notNull(),
    detailMd: text('detail_md'),
    suggestionMd: text('suggestion_md'),
    filePath: text('file_path'),
    lineStart: integer('line_start'),
    symbol: text('symbol'),
    /** 출처: 어느 스펙 근거인가 */
    specVersionId: uuid('spec_version_id').references(() => specVersion.id),
    requirementId: uuid('requirement_id').references(() => requirement.id),
    status: findingStatus('status').notNull().default('open'),
    /** 어디에 대한 지적인가 — 필터의 축이다(REQ-API-073) */
    area: findingArea('area').notNull().default('codebase'),
    /**
     * 그 값이 **추론된 것인가**.
     *
     * 에이전트가 선언하면 false, 서버가 출처로 유추했으면 true 다. 구별해 두는 이유는
     * 추론 규칙이 틀렸을 때 **무엇을 다시 계산해도 되는지** 알기 위해서다 — 사람과
     * 에이전트가 정한 값을 나중에 규칙이 덮으면 그건 고치는 게 아니라 지우는 것이다.
     */
    areaInferred: boolean('area_inferred').notNull().default(true),
    firstSessionId: uuid('first_session_id')
      .notNull()
      .references(() => reviewSession.id),
    lastSessionId: uuid('last_session_id')
      .notNull()
      .references(() => reviewSession.id),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    /**
     * 이 발견이 **어느 Task 가 됐는가**(2026-08-30 신설 — 사람 결정).
     *
     * 처분 3종(fixed·dismissed·wont_fix)만으로는 "나중에 하자"가 갈 곳이 없었다.
     * `wont_fix` 는 근거만 남기고 사라지므로 사실상 삭제와 같았다. 발견을 Task 로
     * 올리면 그 뒤는 작업 축이 맡는다 — 그것이 "티켓 연쇄"의 실물이다.
     *
     * 한 발견은 Task 하나가 된다: 두 번 올리려는 시도는 이미 만든 것을 돌려준다.
     */
    promotedTaskId: uuid('promoted_task_id').references(() => task.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('finding_fingerprint_uq').on(t.projectId, t.fingerprint),
    index('finding_queue').on(t.projectId, t.status, t.severity),
  ],
);

/**
 * 발견에 대한 사람의 말 — 처분 이전에, 또는 처분과 무관하게 (2026-08-30 신설 · REQ-API-057)
 *
 * **처분 버튼 셋만으로는 "왜"를 적을 자리가 없었다.** 스펙에는 코멘트가 있는데 발견에는
 * 없어서, 사람이 "이건 이래서 오탐이다"라고 말하려면 처분 근거 칸에 몰아 쓰거나
 * 아무 데도 못 썼다 — 그리고 지적한 에이전트는 그것을 **영영 듣지 못했다**.
 *
 * 이 표가 사람 → 에이전트 역채널의 둘째 종류다(첫째는 질문 답변).
 */
export const findingComment = pgTable(
  'finding_comment',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    findingId: uuid('finding_id')
      .notNull()
      .references(() => finding.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => user.id),
    authorSessionId: uuid('author_session_id').references(() => agentSession.id),
    bodyMd: text('body_md').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('finding_comment_thread').on(t.findingId, t.createdAt)],
);

/** 어느 라운드에서 몇 번으로 보였는가(구 SUMMARY#n). junction — project_id 생략 예외(§1.1). */
export const findingOccurrence = pgTable(
  'finding_occurrence',
  {
    id: idPk(),
    findingId: uuid('finding_id')
      .notNull()
      .references(() => finding.id),
    reviewSessionId: uuid('review_session_id')
      .notNull()
      .references(() => reviewSession.id),
    reviewerReportId: uuid('reviewer_report_id').references(() => reviewerReport.id),
    roundNo: integer('round_no').notNull(),
    displayNo: integer('display_no').notNull(),
    /** 하향 모순 감사용 원값(24/732 실측) */
    rawSeverity: findingSeverity('raw_severity').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('finding_occurrence_uq').on(t.findingId, t.reviewSessionId)],
);

export const resolution = pgTable(
  'resolution',
  {
    id: idPk(),
    findingId: uuid('finding_id')
      .notNull()
      .references(() => finding.id),
    kind: resolutionKind('kind').notNull(),
    commitSha: text('commit_sha'),
    changeRequestId: uuid('change_request_id').references(() => changeRequest.id),
    /**
     * **스펙을 고쳐 해결한 증거**(2026-08-30 신설 — 사람 결정).
     *
     * `spec_change` 는 처음부터 이 열거에 있었는데 **도구에서 닿을 수 없었고**, CHECK 가
     * `change_request_id` 를 요구하는데 그 표에 INSERT 하는 코드가 없어 사실상 막혀 있었다.
     * 그래서 스펙을 고쳐 해결한 에이전트에게는 정직한 선택지가 하나도 없었다 —
     * `fixed` 는 커밋이 없어 막히고, `dismissed`·`wont_fix` 는 거짓말이다(사람 보고).
     *
     * 커밋이 코드 쪽의 증거이듯 이것이 문서 쪽의 증거다: "다 했습니다" 를 증거로 받지
     * 않는다는 규약은 두 축에서 같아야 한다.
     */
    specVersionId: uuid('spec_version_id').references(() => specVersion.id),
    escalateReason: escalateReason('escalate_reason'),
    /**
     * **넘긴 세션이 사람의 결정을 기다리는가**(2026-10-16 · 사람 결정 D3 · 마이그레이션 0054). `escalated` 처분에만 뜻이 있다 —
     * 참이면 그 세션은 `awaiting_input` 이 되고 에스컬레이션 카드의 결정이 바로 푼다. 거짓이면 카드는 서지만 세션은 일을 잇는다.
     * 다른 결재의 결정이 세션을 깨울 때도 이 값을 본다 — 기다리지 않는 카드가 세션을 붙잡지 않는다.
     */
    blocking: boolean('blocking').notNull().default(false),
    /** 유예 근거는 1급 데이터다 */
    rationaleMd: text('rationale_md').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    actorSessionId: uuid('actor_session_id').references(() => agentSession.id),
    createdAt: createdAt(),
  },
  (t) => [
    // **변경 요청에 묶인 발견**(2026-10-16 · REQ-DB-049) — CR 이 승인 · 거절될 때 그 CR 로 보낸 발견을 찾는다
    index('resolution_change_request')
      .on(t.changeRequestId)
      .where(sql`${t.changeRequestId} IS NOT NULL`),
    check('resolution_fixed_commit_ck', sql`${t.kind} <> 'fixed' OR ${t.commitSha} IS NOT NULL`),
    // **증거는 둘 중 하나면 된다**(2026-08-30 개정). 예전에는 CR 만 인정했는데 CR 을
    // 만드는 코드가 없어(FR-04 소관) 이 처분 자체가 닿을 수 없는 값이었다.
    check(
      'resolution_spec_change_cr_ck',
      sql`${t.kind} <> 'spec_change' OR ${t.changeRequestId} IS NOT NULL OR ${t.specVersionId} IS NOT NULL`,
    ),
  ],
);

/**
 * **게이트 판정 비교**(2026-10-16 · 사람 결정 D6 · E21-S03 · REQ-DB-052 · api.md REQ-API-346 · roadmap §7.4 규칙 3).
 *
 * 로컬 훅이 게이트 판정(EP-REV-08b — POST)을 물으며 자기 판정(`local_state`)을 함께 보내면 서버 판정과 견준 결과를 한 줄로 남긴다.
 * M1 이중화 기간의 불일치율(불일치 / 비교 수 · roadmap §7.5 · §7.6)이 이 표에서 나온다 — 부른 수가 곧 분모라 **같은 (프로젝트 ·
 * 브랜치 · 종류 · 커밋 · 로컬 판정)은 한 줄**이다(재시도가 분모를 부풀리지 않게). 다시 부르면 `repeat_count` 와 `last_seen_at` 만
 * 바뀌고 판정은 처음 것이 남는다 — 그 커밋에서 두 판정이 처음 만난 때가 그 비교다.
 *
 * 이벤트 표에 두지 않은 이유: 비교는 push 마다 생겨 활동 피드와 알림 워커가 훑는 양을 늘리고, 멱등 키를 걸 자리가 없다. 불일치는
 * 따로 `gate.verdict_mismatch` 이벤트가 된다(이중화 기간만).
 */
export const gateVerdictComparison = pgTable(
  'gate_verdict_comparison',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    branch: text('branch').notNull(),
    /** 물은 종류 — 쉼표로 이은 정렬 목록. 종류를 묻지 않았으면 빈 문자열(그때 판정은 라운드가 있는 종류와 정책이 요구하는 종류다) */
    kinds: text('kinds').notNull(),
    /** 40자 커밋 SHA(소문자) */
    headSha: text('head_sha').notNull(),
    /** 로컬 훅의 판정 — 통과면 참 */
    localPass: boolean('local_pass').notNull(),
    /** 판정을 낸 로컬 훅의 이름(선택 · 128자) */
    localHook: text('local_hook'),
    /** 로컬 훅이 적은 이유(선택 · 500자) — 사람이 불일치의 원인을 찾을 때 읽는다. 이벤트에는 넣지 않는다 */
    localReason: text('local_reason'),
    /** 서버 판정 — 물은 종류가 모두 `passed` · `waived` 면 참 */
    serverPass: boolean('server_pass').notNull(),
    /** 그때 서버가 준 종류마다의 상태 `[{kind, state}]` */
    serverStates: jsonb('server_states').notNull().default([]),
    /** 그때의 컷오버 단계 — 지표의 창이 단계를 넘어 걸쳐도 어느 기간의 비교인지 남는다 */
    reviewSot: reviewSot('review_sot').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    /** 같은 비교를 받은 횟수 — 첫 호출이 1 이다 */
    repeatCount: integer('repeat_count').notNull().default(1),
    lastSeenAt: ts('last_seen_at')
      .notNull()
      .default(sql`now()`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('gate_verdict_comparison_uq').on(
      t.projectId,
      t.branch,
      t.kinds,
      t.headSha,
      t.localPass,
    ),
    // 2주 창의 지표(EP-REV-10)가 프로젝트 · 시각으로 읽는다
    index('gate_verdict_comparison_time').on(t.projectId, t.createdAt),
  ],
);
