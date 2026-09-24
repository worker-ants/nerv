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
  escalateReason,
  memberRole,
  questionStatus,
  questionUrgency,
} from '../enums.js';
import { createdAt, idPk, ts } from './_columns.js';
import { finding } from './review.js';
import { agentSession } from './session.js';
import { spec } from './spec.js';
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
    /**
     * **누가 결정했는가** — 경로가 달라도 여기 하나에 남는다(2026-09-24 · 마이그레이션 0029).
     *
     * 그 사실이 경로마다 다른 열에 있었다: `decide()` 는 `assignee_user_id` 를 COALESCE 로
     * 채우고, 게이트 면제는 그 열을 비운 채 `requested_by_user_id` 만 남기며, 지정 카드를
     * admin 이 대신 결정하면 `assignee_user_id` 는 **지정된 사람**으로 남는다. 한 사실이
     * 세 곳에 흩어져 있으니 "내가 결정한 것" 을 묻는 화면은 어느 쪽을 봐도 틀렸다 —
     * 받은 요청의 처리됨 탭이 자기가 끝낸 것은 빼고 남이 낸 면제는 싣고 있었다(실측).
     *
     * `assignee_user_id` 와 겸하지 않는 이유: 그 열은 **누구의 큐인가**를 말하고
     * (결정 전에도 뜻이 있다), 이 열은 **누가 눌렀는가**를 말한다. 둘은 다른 질문이다.
     */
    decidedByUserId: uuid('decided_by_user_id').references(() => user.id),
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
    // **결정된 행에는 결정자가 있다.** 없으면 그 행은 처리됨 탭에서 사라지는데, 사라진
    // 것은 아무도 못 본다 — 코드 규약으로 두지 않고 DB 가 붙잡는다.
    check('approval_decided_by_ck', sql`${t.decision} IS NULL OR ${t.decidedByUserId} IS NOT NULL`),
    // 받은 요청(§4.7) — 내 결정을 기다리는 것만 센다
    index('approval_inbox')
      .on(t.projectId, t.assigneeUserId)
      .where(sql`${t.decision} IS NULL`),
    // 처리됨(§4.7) — **내가 결정한 것**만 센다. 대기 쪽과 같은 모양의 짝이다
    index('approval_decided')
      .on(t.projectId, t.decidedByUserId)
      .where(sql`${t.decision} IS NOT NULL`),
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
    /**
     * 출처(`context`) — **사람은 에이전트의 요약이 아니라 원문을 보고 판단한다**
     * (skills/question §절차 2). 셋 다 선택이고, 받은 요청 카드가 이 링크를 건다.
     */
    taskId: uuid('task_id').references(() => task.id),
    specId: uuid('spec_id').references(() => spec.id),
    findingId: uuid('finding_id').references(() => finding.id),
    /**
     * 왜 사람을 부르는가 — **어휘를 새로 만들지 않는다.** `escalate_reason` 은
     * clemvion 에서 5개월 검증된 매트릭스이고(data-model §2.6) 이미 Resolution 이 쓴다.
     * 같은 뜻에 두 어휘를 두면 그 순간부터 둘이 갈라진다.
     */
    escalate: escalateReason('escalate'),
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
