// pgEnum 선언 38종 — DDL 정본: docs/04-mvp/database.md §2.1
//
// **값 문자열은 data-model.md §2 필드 표와 문자 단위로 일치한다** — `claude-code` 처럼
// 하이픈이 든 값도 그대로 enum 라벨이다(database.md §1.3).
// `event.type` 은 enum 이 아니라 text 다 — 이벤트 어휘는 열려 있고 정본은 spec-workflow §6 이다.

import { pgEnum } from 'drizzle-orm/pg-core';

// ── 테넌시 ────────────────────────────────────────────────────────────────
export const userState = pgEnum('user_state', ['invited', 'active', 'disabled']);
export const memberRole = pgEnum('member_role', [
  'admin',
  'planner',
  'designer',
  'developer',
  'qa',
  'viewer',
]);

// ── 스펙 ──────────────────────────────────────────────────────────────────
export const specType = pgEnum('spec_type', [
  'vision',
  'area',
  'feature',
  'design',
  'convention',
  'adr',
]);
export const specVersionStatus = pgEnum('spec_version_status', [
  'draft',
  'in_review',
  'approved',
  'superseded',
  'deprecated',
]);
export const requirementPriority = pgEnum('requirement_priority', ['must', 'should', 'could']);
export const implStatus = pgEnum('impl_status', [
  'unimplemented',
  'in_progress',
  'implemented',
  'verified',
]);
export const changeKind = pgEnum('change_kind', ['added', 'modified', 'removed', 'unchanged']);
export const specRelationKind = pgEnum('spec_relation_kind', [
  'references',
  'refines',
  'depends_on',
  'duplicates',
  'supersedes',
]);
export const commentStatus = pgEnum('comment_status', ['open', 'resolved']);

// ── 변경 요청 ─────────────────────────────────────────────────────────────
export const changeRequestStatus = pgEnum('change_request_status', [
  'open',
  'in_review',
  'approved',
  'rejected',
  'withdrawn',
]);
export const changeRisk = pgEnum('change_risk', ['low', 'normal', 'high']);
export const changeOrigin = pgEnum('change_origin', ['human', 'agent', 'spec_drift']);

// ── 작업·클레임 ───────────────────────────────────────────────────────────
export const taskStatus = pgEnum('task_status', [
  'backlog',
  'ready',
  'claimed',
  'in_progress',
  'in_review',
  'done',
  'blocked',
]);
export const taskPriority = pgEnum('task_priority', ['P0', 'P1', 'P2', 'P3']);
export const dependencyKind = pgEnum('dependency_kind', ['blocks', 'relates']);
export const claimStatus = pgEnum('claim_status', ['active', 'released', 'expired', 'revoked']);
export const claimReleaseReason = pgEnum('claim_release_reason', [
  'done',
  'manual',
  'expired',
  'conflict',
]);

// ── 세션·활동 ─────────────────────────────────────────────────────────────
export const agentType = pgEnum('agent_type', ['claude-code', 'codex', 'web', 'other']);
export const sessionState = pgEnum('session_state', [
  'pending',
  'active',
  'awaiting_input',
  'complete',
  'error',
  'stale',
]);
export const sessionEndReason = pgEnum('session_end_reason', [
  'complete',
  'error',
  'stopped',
  'stale',
]);
export const activityType = pgEnum('activity_type', [
  'thought',
  'action',
  'elicitation',
  'response',
  'error',
]);

// ── 리뷰 (Phase 2 표면. 스키마는 MVP 에 포함 — scope.md §5) ────────────────
export const reviewKind = pgEnum('review_kind', ['code', 'consistency', 'spec_coverage', 'merge']);
export const reviewTrigger = pgEnum('review_trigger', ['auto', 'manual', 'gate']);
export const reviewState = pgEnum('review_state', ['running', 'complete', 'failed']);
export const reviewRisk = pgEnum('review_risk', ['none', 'low', 'medium', 'high', 'critical']);
export const findingSeverity = pgEnum('finding_severity', ['critical', 'warning', 'info']);
export const findingStatus = pgEnum('finding_status', ['open', 'fixed', 'dismissed', 'wont_fix']);
export const resolutionKind = pgEnum('resolution_kind', [
  'fixed',
  'deferred',
  'dismissed',
  'escalated',
  'spec_change',
]);
/** clemvion 에서 5개월 검증된 ESCALATE 어휘 그대로 — 하이픈 값 포함(data-model §2.6) */
export const escalateReason = pgEnum('escalate_reason', [
  'no',
  'spec',
  'user-decision',
  'infra',
  'e2e-fail-3x',
  'sensitive-fix',
]);

// ── 사람 개입 ─────────────────────────────────────────────────────────────
export const approvalSubjectType = pgEnum('approval_subject_type', [
  'spec_version',
  'change_request',
  'plan',
  'question',
  'gate_bypass',
  /** 리뷰 발견 — critical 하향(A3)의 승인 카드가 붙는 곳(FR-09, 2026-08-23 추가) */
  'finding',
]);
export const approvalDecision = pgEnum('approval_decision', ['approve', 'reject', 'comment']);
export const questionUrgency = pgEnum('question_urgency', ['blocking', 'normal']);
export const questionStatus = pgEnum('question_status', [
  'open',
  'answered',
  'cancelled',
  'expired',
]);

// ── 증적 ──────────────────────────────────────────────────────────────────
export const evidenceKind = pgEnum('evidence_kind', [
  'code_path',
  'test',
  'pr',
  'commit',
  'review',
  'user_guide',
]);
export const evidenceSource = pgEnum('evidence_source', ['agent', 'human', 'ci']);

// ── 알림 ──────────────────────────────────────────────────────────────────
export const notificationImportance = pgEnum('notification_importance', ['immediate', 'digest']);
export const notificationChannel = pgEnum('notification_channel', ['inapp', 'slack', 'email']);
export const notificationState = pgEnum('notification_state', ['unread', 'read', 'archived']);
