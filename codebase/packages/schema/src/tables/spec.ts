// 스펙 — spec · spec_version · requirement · requirement_version · spec_relation
//        · spec_comment · spec_baseline · spec_baseline_item · change_request
// DDL 정본: docs/04-mvp/database.md §2.3·§2.4 · 필드 의미: data-model §2.2·§2.3

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  changeKind,
  changeOrigin,
  changeRequestStatus,
  changeRisk,
  commentStatus,
  implStatus,
  memberRole,
  requirementPriority,
  specRelationKind,
  specType,
  specVersionStatus,
} from '../enums.js';
import { bytea, createdAt, idPk, ts } from './_columns.js';
import { agentSession } from './session.js';
import { project, user } from './tenancy.js';

/** 안정 ID. 이동·개명해도 참조가 불변이다(D-09 · FR-01). */
export const spec = pgTable(
  'spec',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    parentId: uuid('parent_id'),
    type: specType('type').notNull(),
    /** 사람이 읽는 slug(예: channel-web-chat). **참조 키가 아니다** */
    key: text('key').notNull(),
    title: text('title').notNull(),
    /** clemvion 의 0-/1- 정수 접두 규약을 데이터로 흡수한 자리 */
    sortKey: text('sort_key').notNull().default(''),
    /** FK 는 순환이라 §2.11 에서 ALTER 로 건다 */
    currentVersionId: uuid('current_version_id'),
    /** 기본 리뷰어 자동 지정 힌트 */
    ownerRole: memberRole('owner_role'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('spec_tree').on(t.projectId, t.parentId, t.sortKey),
    // 검색 렉시컬 축 — 파이프라인 정본은 api.md §2.2b. 제목은 노드(spec), 본문은 버전에 있다.
    index('spec_title_fts').using('gin', sql`to_tsvector('simple', ${t.title})`),
    // trigram 이 한국어 조사 변형·부분 문자열의 갭을 막는다(REQ-DB-016) — 형태소 분석기는 두지 않는다.
    index('spec_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
  ],
);

/** 불변 스냅샷. **가변 구간은 draft 하나뿐**이다(spec-workflow §1.2). */
export const specVersion = pgTable(
  'spec_version',
  {
    id: idPk(),
    specId: uuid('spec_id')
      .notNull()
      .references(() => spec.id),
    versionNo: integer('version_no').notNull(),
    status: specVersionStatus('status').notNull().default('draft'),
    bodyMd: text('body_md').notNull(),
    /** sha256(body_md) — 무변경 저장 차단 */
    contentHash: bytea('content_hash').notNull(),
    /** 낙관적 동시성. 불일치 = 409 NERV_PRECONDITION */
    baseVersionId: uuid('base_version_id'),
    changeSummaryMd: text('change_summary_md'),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => user.id),
    /** 에이전트 작성이면 세션 — 사람·에이전트 쌍 기록(D-08) */
    authorSessionId: uuid('author_session_id').references(() => agentSession.id),
    /** FK 는 순환이라 §2.11 에서 ALTER 로 건다 */
    changeRequestId: uuid('change_request_id'),
    submittedAt: ts('submitted_at'),
    approvedAt: ts('approved_at'),
    approvedByUserId: uuid('approved_by_user_id').references(() => user.id),
    supersededByVersionId: uuid('superseded_by_version_id'),
    /** 초안 편집 리스 보유자 */
    editLeaseUserId: uuid('edit_lease_user_id').references(() => user.id),
    /** 보유 표면. NULL = 웹 */
    editLeaseSessionId: uuid('edit_lease_session_id').references(() => agentSession.id),
    /** TTL 30분 — Task 클레임 리스와 같은 상수(D-04) */
    editLeaseExpiresAt: ts('edit_lease_expires_at'),
    createdAt: createdAt(),
    /**
     * 본문이 마지막으로 **바뀐** 시각 — 저장된 시각이 아니다.
     *
     * draft 는 같은 행을 덮어쓰므로 `created_at` 은 "언제 만들었나"에만 답한다. 버전
     * 목록이 "2시간 전"이라 적는데 방금 고친 문서인 상황이 그래서 나왔다(실측 2026-08-30).
     * 무변경 저장(요약만 고치는 저장 포함)에는 움직이지 않는다 — 그때는 문서가 바뀌지 않았다.
     */
    updatedAt: ts('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex('spec_version_no_uq').on(t.specId, t.versionNo),
    check('spec_version_no_positive_ck', sql`${t.versionNo} >= 1`),
    // data-model §5.5 규칙 9 — 편집 리스는 draft 에서만 non-NULL
    check(
      'spec_version_lease_draft_only_ck',
      sql`${t.status} = 'draft' OR (${t.editLeaseUserId} IS NULL AND ${t.editLeaseSessionId} IS NULL AND ${t.editLeaseExpiresAt} IS NULL)`,
    ),
    index('spec_version_spec_status').on(t.specId, t.status),
    index('spec_version_body_fts').using('gin', sql`to_tsvector('simple', ${t.bodyMd})`),
    index('spec_version_body_trgm').using('gin', sql`${t.bodyMd} gin_trgm_ops`),
  ],
);

/** 구현 추적의 단위(D-03). */
export const requirement = pgTable(
  'requirement',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    specId: uuid('spec_id')
      .notNull()
      .references(() => spec.id),
    /** 안정 표시 ID(예: REQ-CWC-031) */
    ref: text('ref').notNull(),
    /** EARS 권장 */
    statementMd: text('statement_md').notNull(),
    acceptanceMd: text('acceptance_md'),
    priority: requirementPriority('priority').notNull(),
    implStatus: implStatus('impl_status').notNull().default('unimplemented'),
    introducedInVersionId: uuid('introduced_in_version_id')
      .notNull()
      .references(() => specVersion.id),
    currentVersionId: uuid('current_version_id')
      .notNull()
      .references(() => specVersion.id),
    /** 묘비 — 이력은 지우지 않는다 */
    removedInVersionId: uuid('removed_in_version_id').references(() => specVersion.id),
    verifiedAt: ts('verified_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('requirement_ref_uq').on(t.projectId, t.ref),
    index('requirement_spec_impl').on(t.specId, t.implStatus),
    // EARS 문장 검색(api.md §2.2b).
    // ※ database.md §2.12 는 이 인덱스를 `requirement(text ...)` 로 적었으나 requirement 에
    //    `text` 컬럼은 없다 — 인용 대상은 EARS 문장이므로 statement_md 가 맞다(문서 결함 정정).
    index('requirement_statement_trgm').using('gin', sql`${t.statementMd} gin_trgm_ops`),
  ],
);

/** 버전×요구사항 델타. CR 델타 뷰의 원천(FR-04 — Phase 2). junction 이라 project_id 없음(§1.1). */
export const requirementVersion = pgTable(
  'requirement_version',
  {
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => requirement.id),
    specVersionId: uuid('spec_version_id')
      .notNull()
      .references(() => specVersion.id),
    changeKind: changeKind('change_kind').notNull(),
    /** 그 버전 시점의 스냅샷 */
    statementMd: text('statement_md').notNull(),
    /** 문서 내 표시 순서 */
    ordinal: integer('ordinal').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'requirement_version_pkey', columns: [t.requirementId, t.specVersionId] }),
  ],
);

export const specRelation = pgTable(
  'spec_relation',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    fromSpecId: uuid('from_spec_id')
      .notNull()
      .references(() => spec.id),
    toSpecId: uuid('to_spec_id')
      .notNull()
      .references(() => spec.id),
    kind: specRelationKind('kind').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    check('spec_relation_self_ck', sql`${t.fromSpecId} <> ${t.toSpecId}`),
    uniqueIndex('spec_relation_uq').on(t.fromSpecId, t.toSpecId, t.kind),
  ],
);

/** 앵커 스레드 코멘트(FR-11) — 편집·해소되는 협업 개체다(불변 로그인 activity 와 다르다). */
export const specComment = pgTable(
  'spec_comment',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    specId: uuid('spec_id')
      .notNull()
      .references(() => spec.id),
    specVersionId: uuid('spec_version_id')
      .notNull()
      .references(() => specVersion.id),
    /** 헤딩 slug 또는 requirement.ref(예: REQ-CWC-031) */
    anchor: text('anchor').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => user.id),
    authorSessionId: uuid('author_session_id').references(() => agentSession.id),
    bodyMd: text('body_md').notNull(),
    status: commentStatus('status').notNull().default('open'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => user.id),
    /** 어느 draft 에서 반영됐나 */
    resolvedInVersionId: uuid('resolved_in_version_id').references(() => specVersion.id),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [index('spec_comment_open').on(t.specId, t.status)],
);

/**
 * 베이스라인 — 프로젝트 단위 승인 스냅샷 세트(FR-02 확장. 규약 정본 spec-workflow §3.6).
 * **생성 후 불변** — 항목 UPDATE/DELETE 경로를 만들지 않는다.
 */
export const specBaseline = pgTable(
  'spec_baseline',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    /** 예: 'R1', '2026-09-릴리스' */
    name: text('name').notNull(),
    noteMd: text('note_md'),
    /** 사람 전용 — 에이전트 생성 도구가 없다 */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('spec_baseline_name_uq').on(t.projectId, t.name)],
);

/** junction — project_id 생략 예외(§1.1). 스펙당 1개 핀. */
export const specBaselineItem = pgTable(
  'spec_baseline_item',
  {
    baselineId: uuid('baseline_id')
      .notNull()
      .references(() => specBaseline.id),
    specId: uuid('spec_id')
      .notNull()
      .references(() => spec.id),
    /** approved 만 — 생성 트랜잭션에서 검증한다(REQ-DB-008) */
    specVersionId: uuid('spec_version_id')
      .notNull()
      .references(() => specVersion.id),
  },
  (t) => [primaryKey({ name: 'spec_baseline_item_pkey', columns: [t.baselineId, t.specId] })],
);

export const changeRequest = pgTable('change_request', {
  id: idPk(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id),
  specId: uuid('spec_id')
    .notNull()
    .references(() => spec.id),
  /** 어느 approved 에 대한 변경인가 */
  baseVersionId: uuid('base_version_id')
    .notNull()
    .references(() => specVersion.id),
  /** 제안을 담은 draft */
  proposedVersionId: uuid('proposed_version_id')
    .notNull()
    .references(() => specVersion.id),
  title: text('title').notNull(),
  rationaleMd: text('rationale_md'),
  status: changeRequestStatus('status').notNull().default('open'),
  /** 저위험 자동 통과(D-06) */
  risk: changeRisk('risk').notNull().default('normal'),
  /** spec_drift = 역류 경로 */
  origin: changeOrigin('origin').notNull().default('human'),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => user.id),
  createdBySessionId: uuid('created_by_session_id').references(() => agentSession.id),
  decidedAt: ts('decided_at'),
  createdAt: createdAt(),
});
