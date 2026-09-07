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
  /**
   * 같은 draft 를 다시 저장했다 — **새 버전은 생기지 않는다**(2026-08-29 신설).
   *
   * 예전에는 이 자리에서 아무 이벤트도 내지 않았다("리스 갱신만" — api.md EP-SPEC-08).
   * 그런데 에이전트가 스펙을 쓰는 방식이 대부분 **이 경로**라, 화면은 본문이 바뀌어도
   * 새로고침 전에는 알 수 없었다(실측 2026-08-29). 저장 빈도는 자동 저장 주기(60초)라
   * 방송이 넘치지 않는다.
   */
  SPEC_DRAFT_UPDATED: 'spec.draft_updated',
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

  // ── 기준선 (P1) ──────────────────────────────────────────────────────
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
  /**
   * 결재가 결정됐다 — 승인·거절·코멘트(EP-APR-03).
   *
   * 2026-09-07 까지 이 자리는 `question.answered` 를 냈다. 대상이 무엇이든(스펙 승인·플랜·
   * 질문) 같은 이름이라, 실데이터 12건 중 10건이 **스펙 승인·거절인데 "질문에 답했다"** 로
   * 남아 있었다 — `<리소스>.<동사>` 규약이 깨진 자리이고, 이벤트로 결재를 세는 소비자는
   * 질문 수를 함께 세게 된다. 질문 답변의 `question.answered` 는 그대로 남는다.
   */
  APPROVAL_DECIDED: 'approval.decided',
  /**
   * ★ EP-QST-03 — 취소(2026-09-05). 사람이 내리거나 **만든 세션이 스스로** 거둔다.
   * 답변과 다른 이벤트인 이유는 수신함이 이 둘을 다르게 세기 때문이다:
   * 답변은 처리된 것이고 취소는 처리할 필요가 없어진 것이다.
   */
  QUESTION_CANCELLED: 'question.cancelled',

  // ── 게이트 (P1) ──────────────────────────────────────────────────────────
  GATE_BYPASSED: 'gate.bypassed',
  /** 게이트 판정 불가 — fail-open (D-14) */
  GATE_FAILOPEN: 'gate.failopen',

  // ── 증적 (P1) ────────────────────────────────────────────────────────────
  /** ★ EP-REQ-03 · GitHub 웹훅 수집 — 증적이 붙어도 impl_status 는 자동으로 오르지 않는다 */
  EVIDENCE_ADDED: 'evidence.added',

  // ── 임포트·알림 ──────────────────────────────────────────────────────────
  /** ★ EP-IMP-02·03·04 배치 적재 (P0) */
  IMPORT_APPLIED: 'import.applied',
  /** ★ 알림 파생 — 배지 카운트 갱신용 (P1) */
  NOTIFICATION_CREATED: 'notification.created',

  // ── 테넌시·권한·토큰 (2026-09-07 · REQ-API-151) ─────────────────────────
  //
  // **권한 상승과 토큰 발급은 보안 조사의 첫 질문이다** — "누가 언제 이 사람을 admin 으로
  // 올렸나", "이 토큰은 누가 발급했나". 그런데 답할 표가 없었다: FR-16 은 "모든 상태 전이가
  // 액터와 함께 남는다" 인데 멤버십·토큰·프로젝트 변경은 그 축 밖에 있었다.
  //
  // **프로젝트 범위의 사실부터 남긴다**(사람 결정). `event.project_id` 가 NOT NULL 이라
  // 조직 단위 멤버십(`project_id IS NULL`)과 조직 자체의 변경은 이 표에 담기지 않는다 —
  // 담으려면 열을 nullable 로 바꾸는 결정이 먼저다.
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_ARCHIVED: 'project.archived',
  PROJECT_RESTORED: 'project.restored',
  /** 멤버십이 생겼다 — 초대 수락도 같은 이름이다(들어온 문이 다를 뿐 같은 사실이다) */
  MEMBER_ADDED: 'member.added',
  /** 역할이 바뀌었다 — `from_state`·`to_state` 가 그 역할이다(권한 상승이 여기 보인다) */
  MEMBER_UPDATED: 'member.updated',
  MEMBER_REMOVED: 'member.removed',
  /** 토큰 발급 — 값은 남기지 않는다. 접두·권한·만료만이 감사가 묻는 것이다 */
  TOKEN_CREATED: 'token.created',
  TOKEN_REVOKED: 'token.revoked',
  /** 첨부 — S3 는 자기에게 무엇이 올라왔는지 화면에 알려 주지 못한다 */
  SPEC_ATTACHMENT_ADDED: 'spec.attachment_added',
  SPEC_ATTACHMENT_REMOVED: 'spec.attachment_removed',
} as const;

/**
 * Phase 2 이벤트 — 리뷰 수집(FR-09)·CR 델타(FR-04)와 함께 들어온다.
 * MVP 범위가 아니므로 위 유니온과 분리해 둔다(docs/04-mvp/scope.md §5).
 */
export const NERV_EVENT_PHASE2 = {
  /**
   * 한 라운드가 들어왔다 — **발견이 하나도 새로 열리지 않아도** 난다(2026-08-30).
   *
   * `finding.opened` 는 **새** 발견에만 난다. 그래서 재리뷰가 기존 발견에 합쳐지거나
   * ("봤고 문제가 없었다" 처럼) 발견이 0건이면 게이트 현황만 조용히 바뀌었다 —
   * 화면은 새로고침 전에는 그것을 몰랐다(사람 보고).
   */
  REVIEW_SUBMITTED: 'review.submitted',
  FINDING_OPENED: 'finding.opened',
  // 사람이 발견에 말을 남겼다 — 지적한 세션이 하트비트로 듣는다(2026-08-30 · REQ-API-058)
  FINDING_COMMENTED: 'finding.commented',
  FINDING_RESOLVED: 'finding.resolved',
  CR_OPENED: 'cr.opened',
} as const;

/**
 * 이벤트 이름 — **MVP 와 Phase 2 를 한 유니온으로 본다**(2026-08-23, FR-09 착수).
 *
 * 둘을 갈라 둔 것은 "아직 구현하지 않았다"는 표시였지 다른 종류라는 뜻이 아니다.
 * 카탈로그(spec-workflow §6)는 처음부터 `finding.opened` 를 알림 라우팅과 함께 싣고
 * 있었고, 리뷰 수집이 들어온 지금 그 이름이 실제로 쓰인다. 상수는 Phase 별로 나눠 둔
 * 채로 두어 **언제 들어온 이름인지**는 계속 읽히게 한다.
 */
export type NervEventName =
  | (typeof NERV_EVENT)[keyof typeof NERV_EVENT]
  | (typeof NERV_EVENT_PHASE2)[keyof typeof NERV_EVENT_PHASE2];

export const NERV_EVENT_NAMES = [
  ...Object.values(NERV_EVENT),
  ...Object.values(NERV_EVENT_PHASE2),
] as readonly NervEventName[];

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
  /**
   * 누가 일으켰나 — **식별자만**이라 D-14(본문 없음)와 어긋나지 않는다.
   *
   * 받는 쪽이 "내가 방금 한 일"과 "남이 한 일"을 갈라야 하기 때문이다. 이것이 없으면
   * 화면은 자기 저장에도 "바뀌었습니다"를 띄우고, 그 소음은 알림 자체를 못 믿게 만든다.
   */
  actor_user_id: string | null;
  /** 사람이 아니라 에이전트가 한 일인가(D-08 표기 규약) */
  is_agent: boolean;
  /** ISO 8601 */
  occurred_at: string;
  /**
   * **개인 룸 수신자**(api.md §3.3 의 "+ `user:{id}`" 열).
   *
   * 방송 전용이다 — `event` 행에는 없다. 봉투를 받은 파드는 이 목록의 `user:{id}` 룸에도
   * 흘린다. 없거나 비면 프로젝트 룸에만 간다.
   *
   * 이 필드가 없던 동안 `user:{id}` 룸과 `GET /sse/me` 로는 **아무것도 나가지 않았다**:
   * 종 아이콘은 새로고침해야 숫자가 바뀌었고, 다른 프로젝트 화면에 있던 사람은 자기 앞으로
   * 온 승인 요청을 실시간으로 받지 못했다(2026-09-02 정정).
   */
  recipient_user_ids?: string[];
}
