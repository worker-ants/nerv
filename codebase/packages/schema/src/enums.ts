// pgEnum 선언 39종 — DDL 정본: docs/04-mvp/database.md §2.1
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

/**
 * `blocked` 로 들어갈 때의 사유 코드 — 정본: [3.5 스펙 워크플로우](docs/03-proposal/spec-workflow.md) §2.
 *
 * **어휘를 코드에 두는 이유.** 4.3 과 3.5 가 이 넷을 선언하는데 2026-09-06 까지
 * `blocked_reason` 은 `z.string()` 이었다 — CHECK 도 zod enum 도 상수도 없었다. 어휘가
 * 코드에 없으면 임포터·MCP·웹이 각자 다른 문자열을 넣고, **화면의 필터는 그 순간부터
 * 사실을 못 센다.** 권한 축에서 이미 겪은 형태다(0018 이 존재한 적 없는 값 셋을 청소했다).
 *
 * **열은 아직 `text` 다.** pg enum 으로 굳히지 않은 것은 정본이 함께 요구하는 "해소 조건"
 * 의 뜻이 아직 정해지지 않았기 때문이다(자유 텍스트인가 · Task 참조인가 · 조건인가).
 * 뜻을 정하기 전에 열을 만들면 `EP-TASK-09` 의 `note` 와 같은 운명이 된다 — 받고 버리는 칸.
 * 지금 막아야 하는 것은 **저장 형태**가 아니라 **아무 문자열이나 들어오는 것**이다.
 */
export const BLOCKED_REASONS = [
  /** 질문을 올렸고 답을 기다린다 */
  'awaiting_answer',
  /** 선행 의존이 깨졌다 */
  'dependency_broken',
  /** 기준 스펙과 어긋난다 */
  'spec_conflict',
  /** 저장소 밖의 사정 */
  'external',
] as const;

export type BlockedReason = (typeof BLOCKED_REASONS)[number];

/**
 * 이 값이 **어휘 안의 것인가** — 화면이 라벨을 붙일지 원문을 그대로 보일지 가르는 판정.
 *
 * 열이 아직 `text` 라(위 주석) 2026-09-06 이전에 저장된 자유 텍스트가 그대로 남아 있다.
 * 그런 값에 `blocked.<값>` 문구 키를 만들어 붙이면 카탈로그에 없으므로 번역기가 **키
 * 자체를 돌려주고**(`translator.ts` 의 마지막 폴백), 화면에는 `blocked.막힌 이유` 같은
 * 문자열이 뜬다 — 사람이 적은 사유가 있는데도 그것을 못 보게 된다.
 *
 * 판정을 여기 두는 이유는 어휘의 정본이 여기이기 때문이다(REQ-CB-006). 화면마다
 * `BLOCKED_REASONS.includes(...)` 를 다시 쓰면 어휘가 늘 때 함께 늘지 않는다.
 */
export function isBlockedReason(value: unknown): value is BlockedReason {
  return typeof value === 'string' && (BLOCKED_REASONS as readonly string[]).includes(value);
}

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
 * 셋은 사람·에이전트가 **고른** 이유이고, 나머지는 서버가 **판정한** 이유다:
 * `expired` 는 리스가 만료된 것, `session_end` 는 세션이 끝나며 회수된 것,
 * `stopped` 는 사람이 세션을 중단해 회수된 것이다(뒤의 둘은 2026-09-06 신설 —
 * 그 전까지 두 경로가 `manual` 로 뭉쳐 같은 결함을 반복하고 있었다).
 * `manual` 은 남긴다 — 옛 행이 그 값을 들고 있고, **과거를 위조하지 않는다.**
 */
export const claimReleaseReason = pgEnum('claim_release_reason', [
  'done',
  'handoff',
  'abandon',
  'manual',
  'expired',
  /**
   * 세션이 끝나며 회수됐다(`nerv_session_end`) · 사람이 세션을 중단해 회수됐다(EP-SES-04).
   *
   * **둘 다 고른 것이 아니라 판정된 것이다**(2026-09-06 · 사람 결정). 그래서 `handoff`·
   * `abandon` 에 얹지 않는다 — 그렇게 얹으면 0019 가 고친 오류(인계와 포기가 같은 값이
   * 되는 일)를 반대 방향으로 반복한다. 그 전까지 두 경로는 `manual` 로 뭉쳐 있었고,
   * 그래서 "왜 내려놨나" 에 답할 수 있는 것이 `release_note` 뿐이었다.
   */
  'session_end',
  'stopped',
  /**
   * 세션이 무활동으로 `stale` 이 되며 서버가 거뒀다(2026-09-07 · D-13 · 0023).
   *
   * `expired` 와 갈라 두는 이유는 **판정한 이유가 다르기 때문**이다 — `expired` 는 시간이
   * 지난 것이고 이것은 세션이 사라진 것이다. 리스가 stale 임계보다 길면 둘은 다른 시점에
   * 일어난다. 0021 이 세운 원칙("판정된 값은 판정한 이유대로 적는다")이 그대로 적용된다.
   */
  'stale',
  /**
   * **생산자가 없다**(2026-09-06 확인 — `apps/api/src` 전체에서 쓰기 0건).
   *
   * 이 설계에서 겹침은 **회수가 아니라 거절**이다: 두 번째 클레임이 `NERV_CONFLICT_SCOPE`
   * 로 막히고 첫 번째는 그대로 남는다(D-04 · `task.service.ts` 의 `scope_conflict`).
   * 값을 걷지 않는 이유는 걷는 것이 파괴적 마이그레이션이기 때문이고, 남겨 두는 이유는
   * **없는 생산자를 있는 것처럼 적어 두지 않기 위해서**다 — 이 줄이 그 사실이다.
   */
  'conflict',
]);

/**
 * **부른 쪽이 고를 수 있는 것**은 셋뿐이다 — 나머지는 서버가 판정한 값이다
 * (`expired` 리스 만료 · `session_end` 세션 종료 · `stopped` 사람의 중단 ·
 * `manual` 은 2026-09-06 이전의 잔재 · `conflict` 는 생산자가 없다).
 *
 * 표면이 이 목록을 다시 적지 않게 여기 둔다(REQ-CB-006). 예전에는 REST 컨트롤러가
 * 삼항식으로 "셋 중 하나가 아니면 handoff" 라고 **조용히 바꿔** 놓고 있었다 —
 * 보낸 쪽은 자기가 고른 값이 들어갔다고 믿는다.
 */
export const CLAIM_RELEASE_INPUTS = ['done', 'handoff', 'abandon'] as const;
/** 이름은 `ClaimReleaseReason` 이다 — `ClaimReleaseInput` 은 전표가 요청 스키마에 쓰는 이름이다(§1.7) */
export type ClaimReleaseReason = (typeof CLAIM_RELEASE_INPUTS)[number];

/**
 * 받은 요청 목록의 `state` — **pg enum 이 아니라 파생 어휘다**(결재의 `decision IS NULL` 여부).
 * 그래도 정본은 여기다: 표면이 리터럴로 들고 있으면 검사도 리터럴로 다시 적게 된다.
 */
export const APPROVAL_INBOX_STATES = ['pending', 'decided'] as const;
export type ApprovalInboxState = (typeof APPROVAL_INBOX_STATES)[number];

/** 관계 목록의 방향 — 같은 이유로 여기 둔다(EP-SPEC-18) */
export const SPEC_RELATION_DIRECTIONS = ['out', 'in', 'both'] as const;
export type SpecRelationDirection = (typeof SPEC_RELATION_DIRECTIONS)[number];

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

/**
 * **부를 수 있는 사유는 다섯이다** — `no` 는 "에스컬레이션 아님" 이라 목록 밖이다.
 *
 * 질문(`question.escalate`)과 발견 처분(`resolution.escalate_reason`)이 **같은 어휘를**
 * 쓴다(data-model §2.7). 표면이 이 목록을 다시 적지 않게 여기 둔다.
 */
export const ESCALATE_REASONS = [
  'spec',
  'user-decision',
  'infra',
  'e2e-fail-3x',
  'sensitive-fix',
] as const;
export type EscalateReason = (typeof ESCALATE_REASONS)[number];

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
/**
 * 증적의 종류 — **어휘의 정본이 여기 하나다**(REQ-CB-006 · 2026-09-10 · REQ-WEB-160).
 *
 * 열은 pg enum 이므로 `evidenceKind.enumValues` 로도 같은 목록을 얻지만, 그 값을 읽으려면
 * 브라우저 번들이 drizzle 을 물어야 한다. 목록을 먼저 두고 enum 이 그것을 쓰게 하면 정본은
 * 하나인 채로 화면도 맨 배열을 읽는다.
 *
 * **화면이 이 목록을 다시 적지 않게 하려고 만들었다.** 작업 상세의 증적 폼이 여섯 중 넷을
 * 손으로 적어 두고 있었고(`pr`·`commit`·`test`·`code_path`), 그래서 `review`·`user_guide`
 * 증적은 웹에서 붙일 길이 없었다 — 서버는 처음부터 여섯을 받는데. 어휘가 늘어도 손으로 적은
 * 목록은 함께 늘지 않는다(`BLOCKED_REASONS` 가 막은 것과 같은 형태다).
 */
export const EVIDENCE_KINDS = [
  'code_path',
  'test',
  'pr',
  'commit',
  'review',
  'user_guide',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const evidenceKind = pgEnum('evidence_kind', EVIDENCE_KINDS);
export const evidenceSource = pgEnum('evidence_source', ['agent', 'human', 'ci']);

// ── 저장소 ────────────────────────────────────────────────────────────────
/**
 * 프로젝트의 저장소가 **어느 모양의 호스트**에 있는가 (2026-09-10 · REQ-API-158).
 *
 * 이 값이 정하는 것은 접속이 아니라 **주소의 모양**이다. 증적의 커밋·코드 경로를 링크로
 * 만들 때(`[4.5](screens.md)` REQ-WEB-159) 여태 GitHub 모양 하나만 만들었고, 자체 호스팅
 * GitLab 은 경로에 `/-/` 가 끼므로 그 링크가 404 로 끝났다 — 링크가 생긴 뒤로는 "없는
 * 편이 나은" 종류의 오답이다.
 *
 * **검증은 여전히 호스트를 보지 않는다**(`evidence-locator.ts` — "GitHub 를 박지 않는다").
 * 그쪽은 무엇을 받아들일지의 규칙이고 이쪽은 **표시 규칙**이다. 값은 사람이 고른다:
 * 도메인으로 추정하면 자체 호스팅에서 반드시 틀린다(`git.example.com` 은 아무것도 말하지
 * 않는다).
 *
 * 기본은 `github` 다 — 지금 만들어져 있는 링크가 전부 그 모양이므로, 기본값을 다른 것으로
 * 두면 아무도 고르지 않은 값 때문에 오늘 되던 링크가 내일 깨진다.
 *
 * 늘리는 자리는 둘이다: 이 목록과 주소를 만드는 한 함수(`apps/web/src/lib/evidence.ts`).
 * 모양을 확인하지 못한 호스트를 넣지 않는다 — 짐작한 주소는 틀린 곳으로 데려간다.
 */
export const REPO_HOSTS = ['github', 'gitlab'] as const;

export type RepoHost = (typeof REPO_HOSTS)[number];

export const repoHost = pgEnum('repo_host', REPO_HOSTS);

/** 어휘 안의 값인가 — 화면·서비스가 목록을 다시 적지 않게 한다(REQ-CB-006) */
export function isRepoHost(value: unknown): value is RepoHost {
  return typeof value === 'string' && (REPO_HOSTS as readonly string[]).includes(value);
}

// ── 알림 ──────────────────────────────────────────────────────────────────
export const notificationImportance = pgEnum('notification_importance', ['immediate', 'digest']);
export const notificationChannel = pgEnum('notification_channel', ['inapp', 'slack', 'email']);
export const notificationState = pgEnum('notification_state', ['unread', 'read', 'archived']);
