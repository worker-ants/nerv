// 이벤트 이름 — `<리소스>.<동사>` 규약.
//   정본(알림 카탈로그): docs/03-proposal/spec-workflow.md §6
//   정본(실시간 채널 전수 목록): docs/04-mvp/api.md §3.3
//
// event 행의 `type` 값이자 WebSocket socket.io 이벤트 이름이자 SSE 의 `event:` 필드다 —
// 세 표면이 같은 문자열을 쓴다. 이 파일 밖 하드코딩은 lint 로 금지한다(REQ-CB-006).
//
// ★ 표시는 api.md §3.3 이 신설한 이름(알림을 만들지 않는 기록용)이고, 나머지는 정본 인용이다.

/** MVP(P0+P1) 이벤트 */
export const NERV_EVENT = {
  // ── 스펙 문서 축 전이 (P1) ────────────────────────────────────────────────
  SPEC_DRAFT_CREATED: 'spec.draft_created',
  SPEC_SUBMITTED: 'spec.submitted',
  SPEC_REJECTED: 'spec.rejected',
  SPEC_APPROVED: 'spec.approved',
  SPEC_SUPERSEDED: 'spec.superseded',
  SPEC_DEPRECATED: 'spec.deprecated',
  SPEC_COMMENT_ADDED: 'spec.comment_added',
  /** ★ EP-SPEC-15 */
  SPEC_META_UPDATED: 'spec.meta_updated',
  /** ★ EP-SPEC-16 */
  SPEC_ARCHIVED: 'spec.archived',
  /** ★ EP-SPEC-17 */
  SPEC_RESTORED: 'spec.restored',
  /** 참조 문서 전파 — 참조하는 스펙의 새 버전 승인 */
  SPEC_RECHECK_REQUESTED: 'spec.recheck_requested',
  /** ★ EP-CMT-04 */
  COMMENT_RESOLVED: 'comment.resolved',

  // ── 베이스라인 (P1) ──────────────────────────────────────────────────────
  /** ★ EP-SPEC-12 */
  BASELINE_CREATED: 'baseline.created',

  // ── Task 축 전이 (P0~P1) ─────────────────────────────────────────────────
  TASK_READY: 'task.ready',
  TASK_CLAIMED: 'task.claimed',
  TASK_BLOCKED: 'task.blocked',
  TASK_DONE: 'task.done',
  /** 기준 SpecVersion superseded — 재브리핑 플래그 세팅 */
  TASK_REBRIEF_REQUIRED: 'task.rebrief_required',
  /** ★ EP-TASK-03 */
  TASK_CREATED: 'task.created',
  /** ★ EP-TASK-09 */
  TASK_UPDATED: 'task.updated',

  // ── 클레임 (P0) ──────────────────────────────────────────────────────────
  CLAIM_CONFLICT_WARN: 'claim.conflict_warn',
  CLAIM_CONFLICT_BLOCKED: 'claim.conflict_blocked',
  /** ★ EP-TASK-08 · EP-SES-04(stop) · 리스 만료 회수 */
  CLAIM_RELEASED: 'claim.released',

  // ── 세션 (P0~P1) ─────────────────────────────────────────────────────────
  SESSION_STARTED: 'session.started',
  SESSION_STALE: 'session.stale',
  SESSION_COMPLETE: 'session.complete',
  /** ★ EP-SES-04 */
  SESSION_STEERED: 'session.steered',

  // ── 사람 개입 (P1) ───────────────────────────────────────────────────────
  APPROVAL_REQUESTED: 'approval.requested',
  QUESTION_CREATED: 'question.created',
  /** ★ EP-APR-03 · EP-QST-02 */
  QUESTION_ANSWERED: 'question.answered',

  // ── 게이트 (P1) ──────────────────────────────────────────────────────────
  GATE_BYPASSED: 'gate.bypassed',
  /** 게이트 판정 불가 — fail-open (D-14) */
  GATE_FAILOPEN: 'gate.failopen',

  // ── 임포트·알림 ──────────────────────────────────────────────────────────
  /** ★ EP-IMP-02·03·04 배치 적재 (P0) */
  IMPORT_APPLIED: 'import.applied',
  /** ★ 알림 파생 — 배지 카운트 갱신용 (P1) */
  NOTIFICATION_CREATED: 'notification.created',
} as const;

export type NervEventName = (typeof NERV_EVENT)[keyof typeof NERV_EVENT];

export const NERV_EVENT_NAMES = Object.values(NERV_EVENT) as readonly NervEventName[];

/**
 * Phase 2 이벤트 — 리뷰 수집(FR-09)·CR 델타(FR-04)와 함께 들어온다.
 * MVP 범위가 아니므로 위 유니온과 분리해 둔다(docs/04-mvp/scope.md §5).
 */
export const NERV_EVENT_PHASE2 = {
  FINDING_OPENED: 'finding.opened',
  FINDING_RESOLVED: 'finding.resolved',
  CR_OPENED: 'cr.opened',
} as const;

/**
 * WS·SSE 로 흐르는 최소 봉투 — 정본: docs/04-mvp/api.md §3.3
 *
 * 본문 데이터를 싣지 않는다. 수신자는 이 식별자로 자기 권한으로 재조회한다(D-14).
 * 서버(apps/api)와 웹(apps/web)이 같은 타입을 봐야 하므로 여기가 그 자리다(REQ-CB-006).
 */
export interface NervEventEnvelope {
  id: string;
  type: NervEventName;
  project_id: string;
  subject_type: string;
  subject_id: string;
  subject_key: string | null;
  /** ISO 8601 */
  occurred_at: string;
}
