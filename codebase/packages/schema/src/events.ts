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
  /** ★ EP-TASK-10 · `nerv_task_update`(`archive`) — 진행하지 않기로 한 작업(REQ-API-284) */
  TASK_ARCHIVED: 'task.archived',
  /** ★ EP-TASK-11 — 사람이 되살렸다(REQ-API-285) */
  TASK_RESTORED: 'task.restored',

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
   * ★ 아직 결정되지 않은 결재를 다시 알린다(2026-10-11 · api.md REQ-API-296 · spec-workflow §2.6). 워커가 요청 뒤
   * 4시간(1회째 · 앱 안)과 1일(2회째 · 앱 안과 메일 요약)에 한 번씩 낸다. payload 의 `level` 이 몇 번째인지다.
   * 행위자는 없다 — 사람이 한 일이 아니라 시간이 지난 것이다.
   */
  APPROVAL_REMINDED: 'approval.reminded',
  /**
   * ★ 결정되지 않은 결재가 요청 뒤 2일을 넘겼다(2026-10-15 · 사람 결정 · api.md REQ-API-305 · spec-workflow §2.6 T+2d).
   * 워커가 결재마다(라운드마다) 한 번 낸다. 중요 알림은 결정할 수 있는데 요청 알림을 받지 못한 사람에게만 간다 —
   * 직군 자리 결재의 admin. 기본 큐 결재는 받는 사람이 없다(카드와 개요의 "지연" 표시만). 행위자는 없다.
   */
  APPROVAL_OVERDUE: 'approval.overdue',
  /**
   * ★ 스펙 결재가 요청 뒤 7일 동안 결정되지 않아 만료됐다(2026-10-15 · 사람 결정 · api.md REQ-API-304 · §2.6 T+7d).
   * 대상은 **그 스펙 버전**이고 라운드마다 한 번이다 — 그 버전은 거절과 같은 전이로 초안이 되고, 결정되지 않은 자리
   * 전부가 payload 의 `approval_ids` 다. 결재 행에는 결정을 쓰지 않는다. 요청자에게 보통 알림이 간다. 행위자는 없다.
   */
  APPROVAL_EXPIRED: 'approval.expired',
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
  /** ★ EP-REQ-03 · GitHub 웹훅 수집 — 요구사항에 붙은 증적은 구현 축을 다시 파생한다(REQ-API-141) */
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
  /**
   * 초대받은 사람이 거절했다(2026-09-24 · 사람 결정 · REQ-API-178). **프로젝트 초대만** 남는다 —
   * `event.project_id` 가 NOT NULL 이라 조직 전체 초대는 이 표에 담기지 않는다(위 머리글). 그쪽은
   * 초대 목록의 상태(`declined`)가 기록이다. 초대한 사람에게 알림이 간다
   */
  INVITATION_DECLINED: 'invitation.declined',
  /** 토큰 발급 — 값은 남기지 않는다. 접두·권한·만료만이 감사가 묻는 것이다 */
  TOKEN_CREATED: 'token.created',
  TOKEN_REVOKED: 'token.revoked',
  /** 토큰의 이름 · 권한을 고쳤다(2026-10-11 · REQ-API-292) — 바꾸기 전과 뒤를 함께 남긴다. 값은 여전히 남기지 않는다 */
  TOKEN_UPDATED: 'token.updated',
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
  // ── 변경 요청(CR) — 승인본 위의 초안을 감싼 제안의 전이(2026-10-16 · 사람 결정 D1 · spec-workflow §3.5 · §6.3) ──
  // 대상은 `change_request` 이고 `subject_key` 는 CR 의 표시 키(`<PRJ>-C-…`)다. 결재는 스펙 버전이 받으므로 결재 이벤트
  // (`approval.*` · `spec.*`)와 겹치는 알림은 만들지 않는다 — CR 이벤트가 알림을 만드는 것은 카탈로그의 셋뿐이다.
  /**
   * 열렸다 — 승인본이 있는 문서에 새 초안이 생겼다(저장 · 되돌리기). 그 문서의 작업 가운데 초안이 바꾸거나 뺀 요구사항의
   * 작업을 쥔 세션이 있으면 그 사람에게 critical 알림이 간다(payload `claim_user_ids`)
   */
  CR_OPENED: 'cr.opened',
  /** ★ 검토 요청됐다 — 그 초안이 `in_review` 가 됐다. 결재 요청 알림이 따로 가므로 기록만 한다 */
  CR_SUBMITTED: 'cr.submitted',
  /** ★ 결재가 거절 · 코멘트 · 만료로 초안을 돌려보냈다 — CR 은 닫히지 않고 다시 열림이다. 기록만 한다 */
  CR_REOPENED: 'cr.reopened',
  /**
   * 승인됐다 — 그 버전이 승인본이 됐다. payload 가 고른 제안의 결과(만든 작업 · 보관한 작업)와 델타의 수를 든다. 바뀌거나
   * 빠진 요구사항의 작업을 쥔 세션의 사람에게 critical 알림이 간다(spec-workflow §3.3 · payload `claim_user_ids`)
   */
  CR_APPROVED: 'cr.approved',
  /** 거절됐다 — planner · admin 이 이 제안을 하지 않기로 했고 초안을 버렸다. 작성자에게 high 알림이 간다 */
  CR_REJECTED: 'cr.rejected',
  /** ★ 철회됐다 — 작성자가 초안을 스스로 버렸다. 기록만 한다 */
  CR_WITHDRAWN: 'cr.withdrawn',
  /**
   * ★ **fail-open 격상**(2026-10-15 · 사람 결정 · api.md REQ-API-319 · spec-workflow §4.6). 정책의 시간 창
   * (`failopen.window_hours`) 안에 `gate.failopen` 이 `failopen.escalate_count` 회 이상 쌓여 게이트가 사실상 꺼졌다고
   * 올렸다. 대상은 프로젝트이고 행위자는 없다. 그 프로젝트의 admin 에게 중요 알림이 간다. 이미 격상이면 다시 내지 않는다
   */
  GATE_FAILOPEN_ESCALATED: 'gate.failopen_escalated',
  /** ★ 격상이 풀렸다 — 그 창 동안 새 fail-open 이 없었다(같은 결정 · REQ-API-319). 기록만 하고 알림은 만들지 않는다 */
  GATE_FAILOPEN_CLEARED: 'gate.failopen_cleared',
  /**
   * ★ **면제를 끝냈다**(2026-10-17 · 사람 결정 · api.md REQ-API-357). 사람이 사유와 함께 게이트 면제 하나를 끝냈다 — 그 뒤의
   * 판정(게이트 판정 · done 게이트)이 그 면제를 세지 않는다. 결재 행은 지우지 않고 끝낸 사람 · 시각 · 사유를 남긴다. 대상은
   * 그 면제의 결재(`approval`)이고 payload 는 사유 · 면제의 범위(작업 키 · 브랜치 · 커밋 · 종류) · 면제를 낸 사람이다. 면제를
   * 낸 사람이 아닌 사람이 끝냈으면 낸 사람에게 high 알림이 간다(그 사람의 브랜치 · 작업이 다시 막힐 수 있다)
   */
  GATE_BYPASS_REVOKED: 'gate.bypass_revoked',
  /**
   * ★ **게이트 판정 불일치**(2026-10-16 · 사람 결정 D6 · E21-S03 · api.md REQ-API-347 · roadmap §7.4 규칙 3). M1 이중화 기간(`review_sot =
   * dual`)에 로컬 훅이 보낸 판정(EP-REV-08b `local_state`)과 서버 판정이 달랐다 — 서버 판정이 적용됐고 「조용히 지지 않는다」가 이
   * 이벤트다. 대상은 프로젝트이고 행위자는 훅을 부른 토큰의 사람이다. 같은 비교(프로젝트 · 브랜치 · 종류 · 커밋 · 로컬 판정)에는 한 번만
   * 낸다. payload 는 비교 id · 브랜치 · 커밋 · 종류 · 두 판정 · 훅 이름 · 종류마다의 서버 상태다 — 훅이 적은 이유 원문은 넣지 않는다
   * (비교 표에 있다). 그 프로젝트의 admin 에게 보통 알림이 간다(같은 프로젝트의 불일치는 읽을 때까지 한 줄로 묶는다)
   */
  GATE_VERDICT_MISMATCH: 'gate.verdict_mismatch',
  /**
   * ★ **미러 push 를 멈췄다**(2026-10-16 · E21-S02 · codebase.md REQ-CB-063 · roadmap §7.4 규칙 1). git 미러의 원격에 NERV 가
   * 만들지 않은 커밋이 있어(fast-forward 가 아니다) 덮어쓰지 않고 멈췄다. 대상은 그 커밋이 바꾼 폴더의 프로젝트(어느 프로젝트의
   * 폴더도 아니면 내보낸 프로젝트 전부)이고 행위자는 없다. 그 프로젝트의 admin 에게 중요 알림이 간다. 같은 원격 커밋에는 다시
   * 내지 않는다. 원격 주소는 넣지 않는다(자격증명이 들어 있을 수 있다)
   */
  MIRROR_DIVERGED: 'mirror.diverged',
  /**
   * ★ **오프라인 큐의 재전송이 거절됐다**(2026-10-16 · E21-S01 · NFR-05 · api.md REQ-API-322 · plugin.md §3.4). 플러그인의
   * `nerv-outbox flush` 가 서버의 답(4xx · 구조화 에러)으로 `outbox/failed/` 에 옮긴 항목을 `/ingest/hooks/outbox-failed` 로
   * 알렸다. 대상은 그 사람의 세션(자기 세션이 아니면 프로젝트)이고 행위자는 토큰의 사람(`is_agent`)이다. payload 의 `items` 는
   * 도구 · 멱등 키 · 큐에 넣은 시각 · 상태 코드 · 에러 코드 · `kind` 뿐이다 — 메시지 원문은 넣지 않는다. 같은 멱등 키는 다시
   * 남기지 않는다. 보고한 사람 자신에게 중요 알림이 간다 — 그 사람의 쓰기가 서버에 들어가지 않았다
   */
  SESSION_OUTBOX_FAILED: 'session.outbox_failed',
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
 * 본문 데이터를 넣지 않는다. 수신자는 이 식별자로 자기 권한으로 재조회한다(D-14).
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
