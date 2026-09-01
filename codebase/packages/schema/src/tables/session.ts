// 세션 — agent_session · activity
// DDL 정본: docs/04-mvp/database.md §2.6 · 필드 의미: data-model §2.5
//
// **생성 순서 예외**: spec_version · task · claim · change_request 가 agent_session 을 FK 로
// 참조하므로 0001 에서는 테넌시 직후로 전진 배치한다(database.md §2 첫머리).
// activity 는 월 파티션이라 PK 가 (id, created_at) 복합이다 — 파티션 키가 PK 에 포함돼야 한다.

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { activityType, agentType, sessionEndReason, sessionState } from '../enums.js';
import { createdAt, idPk, ts } from './_columns.js';
import { project, user } from './tenancy.js';

export const agentSession = pgTable(
  'agent_session',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    /** 소유자 — 권한 상속의 원천(D-08) */
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    agentType: agentType('agent_type').notNull(),
    agentVersion: text('agent_version'),
    /** 누구의 어느 머신인가 — P8 의 핵심 필드 */
    hostname: text('hostname').notNull(),
    cwd: text('cwd'),
    worktreePath: text('worktree_path'),
    branch: text('branch'),
    /** 하네스 발급 세션 ID — 훅 페이로드 조인 키 */
    externalSessionId: text('external_session_id'),
    state: sessionState('state').notNull().default('pending'),
    model: text('model'),
    startedAt: ts('started_at')
      .notNull()
      .default(sql`now()`),
    lastHeartbeatAt: ts('last_heartbeat_at'),
    endedAt: ts('ended_at'),
    endReason: sessionEndReason('end_reason'),
    /** 세션 카드의 +N −M */
    diffAdded: integer('diff_added').notNull().default(0),
    diffRemoved: integer('diff_removed').notNull().default(0),
    tokenUsage: jsonb('token_usage').notNull().default({}),
    /**
     * **원문이 사라진 뒤에도 남는 것**(2026-09-01 신설 · REQ-API-067).
     *
     * 보존 잡이 90일 지난 Activity 를 지우는데, 지우고 나면 그 세션은 아무것도 안 한 것처럼
     * 보였다 — 빈 레일은 "기록이 없다" 와 "아무것도 안 했다" 를 구별하지 못한다.
     * 지우기 **전에** 도구별 횟수와 기간을 여기 접어 둔다: `{"Bash": 383, "Edit": 5, …}`.
     */
    activitySummary: jsonb('activity_summary').notNull().default({}),
    /** 조회 편의 비정규화 — 진실은 claim 이다. FK 는 순환이라 §2.11 에서 ALTER 로 건다 */
    currentTaskId: uuid('current_task_id'),
    createdAt: createdAt(),
  },
  (t) => [
    // S5 보드 + stale 스캔
    index('agent_session_board').on(t.projectId, t.state, t.lastHeartbeatAt),
    uniqueIndex('agent_session_external_uq')
      .on(t.projectId, t.externalSessionId)
      .where(sql`${t.externalSessionId} IS NOT NULL`),
  ],
);

/**
 * 타입드 불변 로그 — 편집 가능한 코멘트(spec_comment)와 분리된 개체다.
 * UNIQUE (session_id, seq) 는 파티션 부모에 걸 수 없어 두 겹으로 지킨다(database.md §2.6):
 *   ① 파티션마다 (session_id, seq) unique 인덱스(§2.14 파티션 생성 함수)
 *   ② 월 경계를 넘는 재전송은 ingest 멱등 키가 막는다
 */
export const activity = pgTable(
  'activity',
  {
    id: uuid('id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSession.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    /** 세션 내 단조 증가 */
    seq: bigint('seq', { mode: 'bigint' }).notNull(),
    type: activityType('type').notNull(),
    title: text('title'),
    bodyMd: text('body_md'),
    /** type='action' 일 때 도구 이름 */
    toolName: text('tool_name'),
    payload: jsonb('payload').notNull().default({}),
    /** 다음 활동이 오면 UI 에서 접힌다 */
    ephemeral: boolean('ephemeral').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'activity_pkey', columns: [t.id, t.createdAt] }),
    index('activity_session_time').on(t.sessionId, t.createdAt),
    index('activity_project_time').on(t.projectId, t.createdAt.desc()),
  ],
);
