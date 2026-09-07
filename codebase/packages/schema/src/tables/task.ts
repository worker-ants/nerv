// 작업 — task · task_dependency · claim · evidence
// DDL 정본: docs/04-mvp/database.md §2.5·§2.9 · 필드 의미: data-model §2.4·§2.8
//
// task 의 CHECK 3개는 data-model §5.5 규칙 3·4 중 CHECK 로 내릴 수 있는 부분이다 —
// 게이트 판정(해소된 리뷰 존재)은 질의가 필요하므로 API 계층(TaskService)에 남는다.

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  claimReleaseReason,
  claimStatus,
  dependencyKind,
  evidenceKind,
  evidenceSource,
  taskPriority,
  taskStatus,
} from '../enums.js';
import { createdAt, idPk, ts } from './_columns.js';
import { agentSession } from './session.js';
import { requirement, specBaseline, specVersion } from './spec.js';
import { project, user } from './tenancy.js';

export const task = pgTable(
  'task',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    /** 표시 ID. 서버 발급(data-model §5.1) */
    key: text('key').notNull(),
    title: text('title').notNull(),
    bodyMd: text('body_md'),
    status: taskStatus('status').notNull().default('backlog'),
    /**
     * **미표기는 NULL 이다**(2026-09-07 · REQ-IMP-027 · 0020 이 요구사항에서 한 판단과 같다).
     *
     * 열이 `NOT NULL DEFAULT 'P2'` 인 동안 임포터는 원본이 우선순위를 적은 적 없는 계획
     * 481건을 전부 `P2` 로 적재했고, 보드는 그것을 **사람이 고른 값**으로 그렸다.
     * NULL 은 `P2` 의 축약이 아니라 **표기가 없었다는 사실**이다 — 정렬에서는 뒤로 간다.
     */
    priority: taskPriority('priority').default('P2'),
    /**
     * 기준 버전(agent-integration §2.4). NULL 은 임포트 레거시 전용이고,
     * 신규 생성 표면(REST·MCP)의 zod 는 이 값을 필수로 받는다.
     */
    sourceSpecVersionId: uuid('source_spec_version_id').references(() => specVersion.id),
    sourceRequirementId: uuid('source_requirement_id').references(() => requirement.id),
    /** 기준 기준선 — 주변 문서를 읽는 세트 */
    baselineId: uuid('baseline_id').references(() => specBaseline.id),
    /** 기준 버전 superseded 시 서버가 세팅, 재브리핑 시 해제(spec-workflow §3.3) */
    rebriefRequiredAt: ts('rebrief_required_at'),
    /** 사람 책임자(D-08) */
    assigneeUserId: uuid('assignee_user_id').references(() => user.id),
    /** 에이전트 수행 세션 */
    delegateSessionId: uuid('delegate_session_id').references(() => agentSession.id),
    /** 위임 명세 ① 목표 */
    goalMd: text('goal_md'),
    /** 위임 명세 ② 산출물 형식 */
    outputFormatMd: text('output_format_md'),
    /** 위임 명세 ③ 도구·출처 */
    toolsSourcesMd: text('tools_sources_md'),
    /** 위임 명세 ④ 경계 */
    boundariesMd: text('boundaries_md'),
    /** done 전제조건: 영향 스펙 목록 또는 {"none": true} */
    specImpact: jsonb('spec_impact'),
    /** 어휘: awaiting_answer / dependency_broken / spec_conflict / external */
    blockedReason: text('blocked_reason'),
    doneAt: ts('done_at'),
    updatedAt: ts('updated_at')
      .notNull()
      .default(sql`now()`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_key_uq').on(t.projectId, t.key),
    // 규칙 3 — backlog·blocked 밖으로 나가려면 위임 명세 4요소 전부 NOT NULL
    check(
      'task_delegation_spec_ck',
      sql`${t.status} IN ('backlog', 'blocked') OR (${t.goalMd} IS NOT NULL AND ${t.outputFormatMd} IS NOT NULL AND ${t.toolsSourcesMd} IS NOT NULL AND ${t.boundariesMd} IS NOT NULL)`,
    ),
    // 규칙 4의 CHECK 절반 — done 이면 spec_impact 선언 필수(Gate C 이식)
    check('task_done_spec_impact_ck', sql`${t.status} <> 'done' OR ${t.specImpact} IS NOT NULL`),
    check('task_done_at_ck', sql`${t.status} <> 'done' OR ${t.doneAt} IS NOT NULL`),
    // 사유 없는 blocked 는 백로그 부패의 씨앗이다(spec-workflow §1.4)
    check(
      'task_blocked_reason_ck',
      sql`${t.status} <> 'blocked' OR ${t.blockedReason} IS NOT NULL`,
    ),
    // ready 큐(§4.5)
    index('task_ready_queue').on(t.projectId, t.status, t.priority),
  ],
);

export const taskDependency = pgTable(
  'task_dependency',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => task.id),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => task.id),
    /** blocks 만 ready 판정에 영향을 준다 */
    kind: dependencyKind('kind').notNull().default('blocks'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'task_dependency_pkey', columns: [t.taskId, t.dependsOnTaskId] }),
    check('task_dependency_self_ck', sql`${t.taskId} <> ${t.dependsOnTaskId}`),
  ],
);

/** D-04 의 실체 — nerv_task_claim 이 쓰는 테이블. Phase 0 의 핵심 검증 대상(FR-06). */
export const claim = pgTable(
  'claim',
  {
    id: idPk(),
    /** §1.1 예외 1 — 겹침 검사가 task 조인 없이 프로젝트 범위를 훑는 스캔 축이다 */
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => task.id),
    /** 사람이 직접 잡으면 NULL */
    agentSessionId: uuid('agent_session_id').references(() => agentSession.id),
    /** 책임자(세션 소유자) */
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    status: claimStatus('status').notNull().default('active'),
    /** 이 작업이 건드릴 스펙 */
    scopeSpecIds: uuid('scope_spec_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** 이 작업이 건드릴 파일 */
    scopeFileGlobs: text('scope_file_globs')
      .array()
      .notNull()
      .default(sql`'{}'`),
    acquiredAt: ts('acquired_at')
      .notNull()
      .default(sql`now()`),
    /** TTL 30분, 하트비트 60초로 연장 */
    leaseExpiresAt: ts('lease_expires_at').notNull(),
    lastHeartbeatAt: ts('last_heartbeat_at')
      .notNull()
      .default(sql`now()`),
    releasedAt: ts('released_at'),
    releaseReason: claimReleaseReason('release_reason'),
    /**
     * 인수인계 노트 — `nerv_task_release(state_note)` 가 남기는 것(2026-09-03 신설 · REQ-API-081).
     *
     * 카탈로그(3.4 §2.3)는 이 입력과 "인수인계 노트" 출력을 처음부터 적고 있었지만 저장할
     * 열이 없어 **성공 응답과 함께 버려졌다.** 다음 사람이 이 작업을 집을 때 "왜 내려놨나"에
     * 답하는 자리이므로 세션 타임라인이 아니라 **클레임에** 붙는다 — 타임라인에만 있으면
     * `nerv_task_next` 로 후보를 보는 다음 에이전트가 찾지 못한다.
     */
    releaseNote: text('release_note'),
    /**
     * 진행 요약 — 하트비트가 60초마다 덮어쓴다(LWW). 카탈로그의 `progress?` 가 여기 앉는다.
     * 이력이 아니라 **지금 무엇을 하는 중인가**라서 행을 쌓지 않는다(하트비트는 자연 멱등이다).
     */
    progressNote: text('progress_note'),
    createdAt: createdAt(),
  },
  (t) => [
    // "한 Task 에 활성 클레임은 하나" — 규칙 2 의 실물(partial unique)
    uniqueIndex('claim_task_active_uq')
      .on(t.taskId)
      .where(sql`${t.status} = 'active'`),
    index('claim_scope_specs_gin').using('gin', t.scopeSpecIds),
    index('claim_scope_globs_gin').using('gin', t.scopeFileGlobs),
    index('claim_project_active')
      .on(t.projectId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const evidence = pgTable(
  'evidence',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    requirementId: uuid('requirement_id').references(() => requirement.id),
    specVersionId: uuid('spec_version_id').references(() => specVersion.id),
    taskId: uuid('task_id').references(() => task.id),
    kind: evidenceKind('kind').notNull(),
    /** 경로 glob · PR URL · 커밋 SHA · 테스트 이름 */
    locator: text('locator').notNull(),
    /** 멀티 저장소 대비 */
    repo: text('repo'),
    source: evidenceSource('source').notNull(),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by').references(() => user.id),
    /** clemvion R-1(stale glob)의 교훈 */
    stale: boolean('stale').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // 셋 중 최소 1개 필수(data-model §2.8)
    check(
      'evidence_anchor_ck',
      sql`${t.requirementId} IS NOT NULL OR ${t.specVersionId} IS NOT NULL OR ${t.taskId} IS NOT NULL`,
    ),
    index('evidence_requirement')
      .on(t.requirementId)
      .where(sql`NOT ${t.stale}`),
  ],
);
