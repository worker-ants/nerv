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
/**
 * 클레임을 왜 내려놓았나.
 *
 * **입력 셋과 저장 넷이 어긋나 있었다**(2026-09-05 정정 · 사람 결정). 표면은
 * `done`/`handoff`/`abandon` 을 받는데 저장은 `done` 외를 전부 `manual` 로 뭉쳤다 —
 * **인계와 포기가 저장에서 구별되지 않았고**, 그 대응이 의도인지 사고인지 말하는
 * 문장도 어디에도 없었다. 구별을 저장에 남긴다.
 *
 * 셋은 사람·에이전트가 **고른** 이유이고, 둘은 서버가 **판정한** 이유다:
 * `expired` 는 리스가 만료된 것, `conflict` 는 겹침으로 회수된 것이다.
 * `manual` 은 남긴다 — 옛 행이 그 값을 들고 있고, **과거를 위조하지 않는다.**
 */
export const claimReleaseReason = pgEnum('claim_release_reason', [
  'done',
  'handoff',
  'abandon',
  'manual',
  'expired',
  'conflict',
]);

/**
 * **부른 쪽이 고를 수 있는 것**은 셋뿐이다 — 나머지 셋은 서버가 판정한 값이다
 * (`expired` 리스 만료 · `conflict` 겹침 회수 · `manual` 은 2026-09-05 이전의 잔재).
 *
 * 표면이 이 목록을 다시 적지 않게 여기 둔다(REQ-CB-006). 예전에는 REST 컨트롤러가
 * 삼항식으로 "셋 중 하나가 아니면 handoff" 라고 **조용히 바꿔** 놓고 있었다 —
 * 보낸 쪽은 자기가 고른 값이 들어갔다고 믿는다.
 */
export const CLAIM_RELEASE_INPUTS = ['done', 'handoff', 'abandon'] as const;
export type ClaimReleaseInput = (typeof CLAIM_RELEASE_INPUTS)[number];

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
/**
 * **어디에 대한 지적인가**(2026-09-01 신설 — 사람 결정). `category` 와 다른 축이다:
 * category 는 "무슨 종류인가"(보안·테스트·명명)이고 이것은 **"무엇을 고쳐야 하는가"** 다.
 *
 * 사람이 발견을 보고 다음에 할 행동이 이 넷으로 갈린다 — 코드를 고친다 / 스펙을 고친다
 * (`spec_change` 처분이 그 자리다) / 작업을 다시 쪼갠다 / 규약을 짚는다.
 *
 * `process` 가 넷째인 이유: 나머지 셋에 안 맞는 것이 반드시 생기는데, 그때 `codebase` 로
 * 밀어 넣으면 그 값이 "분류 안 된 것" 의 쓰레기통이 된다. 이름이 있는 편이 정직하다.
 */
export const findingArea = pgEnum('finding_area', ['codebase', 'spec', 'task', 'process']);
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
