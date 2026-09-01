// 리뷰 — review_session · reviewer_report · finding · finding_occurrence · resolution
// DDL 정본: docs/04-mvp/database.md §2.7 · 필드 의미: data-model §2.6
//
// 테이블은 MVP 스키마에 포함되고 **표면은 Phase 2 다**(scope.md §5). 그 중 도구 2종과 REST
// 3종은 2026-08-23 에 들어왔고(FR-09 착수 기록), S6 리뷰 센터 화면은 아직 없다.
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
    /** 검토한 커밋 */
    headSha: text('head_sha').notNull(),
    /** diff 기준 커밋 */
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
    /** TTL 30일(data-model §5.4) */
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
    /** 유예 근거는 1급 데이터다 */
    rationaleMd: text('rationale_md').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    actorSessionId: uuid('actor_session_id').references(() => agentSession.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('resolution_fixed_commit_ck', sql`${t.kind} <> 'fixed' OR ${t.commitSha} IS NOT NULL`),
    // **증거는 둘 중 하나면 된다**(2026-08-30 개정). 예전에는 CR 만 인정했는데 CR 을
    // 만드는 코드가 없어(FR-04 소관) 이 처분 자체가 닿을 수 없는 값이었다.
    check(
      'resolution_spec_change_cr_ck',
      sql`${t.kind} <> 'spec_change' OR ${t.changeRequestId} IS NOT NULL OR ${t.specVersionId} IS NOT NULL`,
    ),
  ],
);
