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
    firstSessionId: uuid('first_session_id')
      .notNull()
      .references(() => reviewSession.id),
    lastSessionId: uuid('last_session_id')
      .notNull()
      .references(() => reviewSession.id),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('finding_fingerprint_uq').on(t.projectId, t.fingerprint),
    index('finding_queue').on(t.projectId, t.status, t.severity),
  ],
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
    check(
      'resolution_spec_change_cr_ck',
      sql`${t.kind} <> 'spec_change' OR ${t.changeRequestId} IS NOT NULL`,
    ),
  ],
);
