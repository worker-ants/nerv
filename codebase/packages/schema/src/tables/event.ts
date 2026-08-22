// 이벤트·알림 — event · notification
// DDL 정본: docs/04-mvp/database.md §2.10 · 필드 의미: data-model §2.9
//
// event 는 append-only(D-10) 이고 월 파티션이라 PK 가 (id, occurred_at) 복합이다.
// notification.event_id 는 **논리 FK** 다 — 파티션 부모의 유일 키가 복합이라 단일 컬럼
// 물리 FK 를 걸 수 없고, notification 생성 경로가 워커 하나뿐이므로 무결성은 그 경로가 진다.

import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { notificationChannel, notificationImportance, notificationState } from '../enums.js';
import { createdAt, idPk, ts } from './_columns.js';
import { agentSession } from './session.js';
import { project, user } from './tenancy.js';

export const event = pgTable(
  'event',
  {
    id: uuid('id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    /** 파티션 키 */
    occurredAt: ts('occurred_at')
      .notNull()
      .default(sql`now()`),
    /** enum 이 아니라 text — 이벤트 어휘는 열려 있고 정본은 spec-workflow §6 이다 */
    type: text('type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => user.id),
    actorSessionId: uuid('actor_session_id').references(() => agentSession.id),
    /** 감사에서 사람/에이전트 구분(FR-16) */
    isAgent: boolean('is_agent').notNull().default(false),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    fromState: text('from_state'),
    toState: text('to_state'),
    /** 개인정보 금지 — ID 참조만(data-model §5.4) */
    payload: jsonb('payload').notNull().default({}),
    /** 요청 단위 상관관계 */
    requestId: text('request_id'),
  },
  (t) => [
    primaryKey({ name: 'event_pkey', columns: [t.id, t.occurredAt] }),
    index('event_project_time').on(t.projectId, t.occurredAt.desc()),
    index('event_subject').on(t.subjectType, t.subjectId, t.occurredAt),
  ],
);

export const notification = pgTable(
  'notification',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    /** 논리 FK → event.id (위 설명) */
    eventId: uuid('event_id').notNull(),
    importance: notificationImportance('importance').notNull(),
    channel: notificationChannel('channel').notNull().default('inapp'),
    state: notificationState('state').notNull().default('unread'),
    digestBatchId: uuid('digest_batch_id'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notification_inbox').on(t.userId, t.state, t.createdAt.desc())],
);
