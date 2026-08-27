// 사람 개입 — approval · question
// DDL 정본: docs/04-mvp/database.md §2.8 · 필드 의미: data-model §2.7
//
// **지시자≠승인자(규칙 5)는 CHECK 로 내리지 않는다** — spec-workflow §2.3 의 소규모 완화
// (멤버 2인 미만이면 차단 대신 배너 + 감사 이벤트)가 있어 하드 제약이면 안 되고,
// 정본대로 "저장 시 검증 + 질의 필터"(ApprovalService)로 강제한다.

import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  approvalDecision,
  approvalSubjectType,
  memberRole,
  questionStatus,
  questionUrgency,
} from '../enums.js';
import { createdAt, idPk, ts } from './_columns.js';
import { agentSession } from './session.js';
import { task } from './task.js';
import { project, user } from './tenancy.js';

export const approval = pgTable(
  'approval',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    subjectType: approvalSubjectType('subject_type').notNull(),
    /** 다형 참조 — 물리 FK 없음(앱 검증) */
    subjectId: uuid('subject_id').notNull(),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => user.id),
    requestedBySessionId: uuid('requested_by_session_id').references(() => agentSession.id),
    assigneeUserId: uuid('assignee_user_id').references(() => user.id),
    /** 역할 큐로 열어두는 경우 */
    assigneeRole: memberRole('assignee_role'),
    /** NULL = 대기 */
    decision: approvalDecision('decision'),
    commentMd: text('comment_md'),
    requestedAt: ts('requested_at')
      .notNull()
      .default(sql`now()`),
    dueAt: ts('due_at'),
    decidedAt: ts('decided_at'),
    /** 게이트 면제도 결재 레코드다(FR-10) */
    isBypass: boolean('is_bypass').notNull().default(false),
    bypassReason: text('bypass_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    check('approval_bypass_reason_ck', sql`NOT ${t.isBypass} OR ${t.bypassReason} IS NOT NULL`),
    // 받은 요청(§4.7) — 내 결정을 기다리는 것만 센다
    index('approval_inbox')
      .on(t.projectId, t.assigneeUserId)
      .where(sql`${t.decision} IS NULL`),
  ],
);

/** 세션은 awaiting_input 으로 대기한다(P7 의 핵심). */
export const question = pgTable(
  'question',
  {
    id: idPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id),
    agentSessionId: uuid('agent_session_id')
      .notNull()
      .references(() => agentSession.id),
    taskId: uuid('task_id').references(() => task.id),
    title: text('title').notNull(),
    bodyMd: text('body_md'),
    /** 선택지(있으면 원클릭 응답) */
    options: jsonb('options').notNull().default([]),
    urgency: questionUrgency('urgency').notNull().default('normal'),
    status: questionStatus('status').notNull().default('open'),
    answerKey: text('answer_key'),
    answerMd: text('answer_md'),
    answeredByUserId: uuid('answered_by_user_id').references(() => user.id),
    askedAt: ts('asked_at')
      .notNull()
      .default(sql`now()`),
    answeredAt: ts('answered_at'),
    createdAt: createdAt(),
  },
  (t) => [index('question_open').on(t.projectId, t.status)],
);
