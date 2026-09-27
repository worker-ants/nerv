// 이벤트·알림 — event · notification · notification_batch_event · notification_preference
// DDL 정본: docs/04-mvp/database.md §2.10 · 필드 의미: data-model §2.9
//
// event 는 append-only(D-10) 이고 월 파티션이라 PK 가 (id, occurred_at) 복합이다.
// notification.event_id 는 **논리 FK** 다 — 파티션 부모의 유일 키가 복합이라 단일 컬럼
// 물리 FK 를 걸 수 없고, notification 생성 경로가 워커 하나뿐이므로 무결성은 그 경로가 진다.

import { sql } from 'drizzle-orm';
import {
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
import {
  notificationChannel,
  notificationImportance,
  notificationLevel,
  notificationState,
} from '../enums.js';
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
    /**
     * **앱 안 묶음**(2026-09-27 · 사람 결정 G1 · G2 · G3 · REQ-DB-030 · api.md REQ-API-223).
     * 보통 등급 알림은 같은 사람 · 같은 배치 키(spec-workflow §6.3 — 예: `spec:{id}:recheck`)면 새 줄을
     * 만들지 않고 열린 묶음에 더한다. 중요 알림은 묶지 않는다(NULL).
     */
    batchKey: text('batch_key'),
    /** 묶음에 든 이벤트 수 — 목록이 매번 세지 않게 행에 둔다. 묶지 않은 알림은 1 */
    batchSize: integer('batch_size').notNull().default(1),
    /**
     * 마지막으로 이벤트가 더해진 시각 — 목록은 이 순서다(더해지면 맨 위로 온다). 묶지 않은 알림은
     * `created_at` 과 같다
     */
    lastAt: ts('last_at').notNull().defaultNow(),
    /** 아직 더할 수 있는 묶음인가 — 사람이 읽으면 닫히고, 다음 알림은 새 줄로 시작한다 */
    batchOpen: boolean('batch_open').notNull().default(false),
  },
  (t) => [
    // 목록은 마지막 시각 순이다(2026-09-27 · REQ-DB-030) — 묶음에 더해진 알림이 맨 위로 온다
    index('notification_inbox').on(t.userId, t.state, t.lastAt.desc()),
    // 범위별 수와 범위 안의 [모두 읽음](2026-09-27 · REQ-DB-027 · REQ-API-214·216) — 위 인덱스는
    // 프로젝트를 몰라, 프로젝트마다 안 읽은 수를 세려면 그 사람의 알림 전부를 훑어야 했다
    index('notification_scope').on(t.userId, t.projectId, t.state),
    // **파생의 멱등 키**(2026-09-27 · REQ-DB-029 · api.md REQ-API-222). 워커는 "알림 행이 없는 이벤트" 를
    // 찾아 넣는데, 그 판단은 읽는 순간의 것이라 파생이 겹치면 같은 알림이 두 번 들어갈 수 있었다
    uniqueIndex('notification_event_user').on(t.eventId, t.userId),
    // **열린 묶음은 키마다 하나**(2026-09-27 · REQ-DB-030 · spec-workflow §6.5 의 "동시 이벤트가 두 배치를
    // 만드는 경쟁"). 파생은 이 인덱스로 upsert 한다 — 둘이 겹쳐도 둘째는 같은 줄에 더해진다
    uniqueIndex('notification_open_batch')
      .on(t.userId, t.batchKey)
      .where(sql`${t.batchOpen}`),
  ],
);

/**
 * **묶음에 든 이벤트**(2026-09-27 · 사람 결정 G2 · REQ-DB-030 · api.md REQ-API-223·224).
 *
 * 묶음 줄 하나가 "무엇 때문에" 를 보이려면 그 줄에 더해진 이벤트를 알아야 한다(원인 문서 · 코멘트한
 * 사람). `event_id` 는 논리 FK 다(위 설명). `(event_id, user_id)` 유일이 **파생의 멱등 키**다 — 한 이벤트는
 * 한 사람에게 한 묶음에만 든다. 알림 줄이 지워지면 함께 지운다.
 */
export const notificationBatchEvent = pgTable(
  'notification_batch_event',
  {
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notification.id, { onDelete: 'cascade' }),
    /** 논리 FK → event.id */
    eventId: uuid('event_id').notNull(),
    /** 멱등 키의 절반 — 묶음 줄의 `user_id` 와 같다 */
    userId: uuid('user_id').notNull(),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'notification_batch_event_pkey', columns: [t.notificationId, t.eventId] }),
    uniqueIndex('notification_batch_event_user').on(t.eventId, t.userId),
  ],
);

/**
 * **프로젝트마다 알림을 받는 수준**(2026-09-27 · 사람 결정 N3 · REQ-DB-028 · api.md REQ-API-219·220).
 *
 * 알림을 끄거나 줄일 방법이 없어서, 한 프로젝트의 한 종류가 안 읽은 알림의 90%를 차지해도 사람이 할
 * 수 있는 것은 [모두 읽음]뿐이었다(로컬 실측 2026-09-27: 1,027건 중 921건이 참조 스펙 재검토).
 * 행이 없으면 `all` 이다 — 기본값을 행으로 채우지 않는다(멤버가 늘 때마다 행을 만들 일이 없다).
 * 고른 수준 밖의 알림은 **버리지 않고 읽음 상태로 넣는다**(REQ-API-176 과 같은 방식) — 배지에는
 * 잡히지 않지만 그 프로젝트를 골라 보면 기록이 남아 있다.
 */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    level: notificationLevel('level').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'notification_preference_pkey', columns: [t.userId, t.projectId] })],
);
