// 리뷰·승인·질문 표면의 요청 스키마 — 정본: api.md §2.6·§2.7 (EP-REV · EP-APR · EP-QST)
//
// 규율은 `tenancy.ts` 와 같다: `.strict()` 로 알 수 없는 키를 거절하고, 어휘(enum)는
// 도메인이 본다(REQ-API-112 · `resolutionOf` · `ESCALATE_REASONS`).

import { z } from 'zod';
import { COMMIT_SHA_PATTERN, FULL_COMMIT_SHA_PATTERN } from '../evidence-locator.js';

/** 리뷰어 한 명의 자기 보고 — 위험도는 세션 위험도의 재료다 */
export const ReviewerReportInput = z
  .object({
    role: z.string().nullish(),
    risk: z.string().nullish(),
    body_md: z.string().nullish(),
  })
  .strict();

/** 발견 한 줄 — `fingerprint` 는 서버가 만든다(라운드를 넘어 하나로 유지하기 위해) */
export const ReviewFindingInput = z
  .object({
    severity: z.string().min(1),
    title: z.string().min(1),
    body: z.string().nullish(),
    suggestion: z.string().nullish(),
    file: z.string().nullish(),
    line: z.number().int().nullish(),
    area: z.string().nullish(),
    category: z.string().nullish(),
    /** 고정 ID(`REQ-…`)든 UUID 든 — 서버가 그 프로젝트 안에서 UUID 로 푼다(2026-10-15 · REQ-API-311) */
    requirement_id: z.string().nullish(),
    /**
     * `spec_drift` 같은 분류 — 발견 목록의 필터와 대상 추론(`inferArea`)이 읽는다. 10개까지 · 하나 64자까지
     * (2026-09-28 · clemvion 요청 N8 · REQ-API-253). 예전에는 서비스가 받는데 REST · MCP 가 넘기지 않아 저장되지 않았다
     */
    tags: z.array(z.string().trim().min(1).max(64)).max(10).nullish(),
  })
  .passthrough();

/**
 * **리뷰의 입력 커밋 스냅샷 — 둘 다 커밋 SHA 다**(2026-10-15 · 사람 결정 · api.md REQ-API-321). 증적 형식 검사와 같은
 * 정규식(7~40자 16진수 · 대소문자 무시)이고 앞뒤 공백은 정리한다. `HEAD` · 브랜치 이름은 움직이는 이름이라 나중에 "무엇을
 * 봤는가" 에 답하지 못하고 작업의 커밋과 견줄 수도 없다 — 예전에는 받았고, done 게이트가 견주지 못해 fail-open 으로
 * 넘겼다(`head_sha: "HEAD"` 로 신선도를 넘을 수 있었다). 제출하는 쪽이 `git rev-parse` 로 고칠 수 있는 입력이라 막는다.
 * `base_sha` 도 diff 의 기준 커밋이라(data-model §2.6) 같은 규칙이다.
 *
 * REST 의 `ReviewSubmitInput` 이 이 두 칸을 쓰고, MCP 도구와 리뷰 임포트는 서비스가 같은 스키마로 본다(표면이 셋이라도
 * 규칙은 이 한 벌이다).
 */
const commitSha = (message: string) =>
  z.string().trim().regex(new RegExp(COMMIT_SHA_PATTERN, 'i'), message);

export const ReviewSnapshotInput = z
  .object({
    base_sha: commitSha('error.review.base_not_commit'),
    head_sha: commitSha('error.review.head_not_commit'),
  })
  .strict();

/**
 * EP-REV-01 — 제출.
 *
 * **입력 커밋 스냅샷이 필수다**(D-07). 그것 없이는 "어느 코드에 대한 지적인가" 를
 * 나중에 되물을 수 없고, 그러면 발견은 산문으로 되돌아간다. 두 값은 커밋 SHA 여야 한다(`ReviewSnapshotInput`).
 */
export const ReviewSubmitInput = z
  .object({
    repo: z.string().nullish(),
    branch: z.string().min(1),
    base_sha: ReviewSnapshotInput.shape.base_sha,
    head_sha: ReviewSnapshotInput.shape.head_sha,
    changeset: z.array(z.string()).default([]),
    kind: z.string().default('code'),
    round_of: z.string().nullish(),
    reviewer: ReviewerReportInput.nullish(),
    summary: z.string().nullish(),
    findings: z.array(ReviewFindingInput).default([]),
    task_id: z.string().nullish(),
    payload_ref: z.string().nullish(),
    session_id: z.string().nullish(),
  })
  .strict();

/**
 * EP-REV-02 — 처분.
 *
 * `escalate_reason` 은 `escalated` 의 **필수 짝**이고 그 판정은 도메인이 한다
 * (REQ-API-108 — 사유 없는 에스컬레이션은 처분이 아니라 방치다).
 */
export const FindingResolveInput = z
  .object({
    resolution: z.string().default('dismissed'),
    rationale: z.string().min(1),
    commit_sha: z.string().nullish(),
    change_request_id: z.string().nullish(),
    spec_version_id: z.string().nullish(),
    escalate_reason: z.string().nullish(),
    /**
     * **넘긴 쪽이 결정을 기다리는가**(2026-10-16 · 사람 결정 D3 · REQ-API-334). `escalated` 에만 읽는다. 주지 않으면 세션이 부른
     * 처분은 기다리고(질문과 같다 — 사람을 부르고도 그냥 진행하는 것은 에스컬레이션이 아니다) 세션 없는 처분은 기다릴 세션이 없다
     */
    blocking: z.boolean().nullish(),
  })
  .strict();

/**
 * EP-REV-09 — **발견을 변경 요청으로 보낸다**(2026-10-16 · 사람 결정 · REQ-API-332). 근거는 선택이다 — 주지 않으면 서버가
 * "발견 제목 — 구현이 스펙을 바꿨다" 로 적는다. 발견의 본문 · 근거 · 커밋은 서버가 발견에서 옮긴다.
 */
export const FindingToChangeRequestInput = z
  .object({
    rationale: z.string().trim().max(2000).nullish(),
  })
  .strict();

/** EP-REV-05 — 발견 코멘트. 사람이 지적에 답하는 자리다 */
export const FindingCommentInput = z.object({ body_md: z.string().min(1) }).strict();

/** 브랜치 이름의 상한 — git 은 길이를 정하지 않지만 결재 기록에 남길 값이라 묶는다(리뷰 제출의 브랜치와 같은 모양) */
export const GATE_BYPASS_BRANCH_MAX = 255;

/** EP-APR-04 — 게이트 면제. **면제도 결재 레코드다**(FR-10) */
export const GateBypassInput = z
  .object({
    /** 면제의 대상 — 작업(키 또는 UUID) 또는 리뷰 세션. `branch` 를 주면 받지 않는다(그때 대상은 브랜치다) */
    subject_id: z.string().min(1).optional(),
    reason: z.string().min(1),
    /**
     * **면제할 리뷰 종류**(2026-10-09 · REQ-API-274). 주면 `subject_id` 는 이 프로젝트의 작업(키 또는 UUID)이고, done
     * 게이트가 그 종류만 요구에서 뺀다. 주지 않으면 범위 없는 면제다 — admin만 리뷰 커버리지 전부를 넘기고, planner ·
     * developer는 그 역할이 면제할 수 있는 종류 전부로 풀어 읽는다(2026-10-11 · REQ-API-293)
     */
    kinds: z.array(z.string().min(1)).min(1).optional(),
    /**
     * **브랜치 면제**(2026-10-16 · 사람 결정 D4 · REQ-API-338). 리뷰가 한 번도 없는 브랜치에도 낸다 — 게이트 판정(EP-REV-08)이
     * 그 (브랜치 · 종류)를 `waived` 로 통과시키고 게이트 현황의 그 브랜치 줄에 보인다. 종류 · 역할 규칙은 작업 면제와 같다
     */
    branch: z.string().trim().min(1).max(GATE_BYPASS_BRANCH_MAX).optional(),
    /**
     * 브랜치 면제를 **커밋 하나로** 좁힌다 — 40자 커밋 SHA 만 받는다(`FULL_COMMIT_SHA_PATTERN`). 주지 않으면 그 브랜치의 모든
     * 커밋에 유효하다(새 커밋이 와도 남는다)
     */
    head_sha: z
      .string()
      .trim()
      .regex(new RegExp(FULL_COMMIT_SHA_PATTERN, 'i'), 'error.approval.bypass_head_not_full_sha')
      .transform((sha) => sha.toLowerCase())
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    // 대상은 하나다 — 작업 · 리뷰 세션이든 브랜치든. 둘 다 주면 어느 게이트를 넘기려는지 서버가 짐작하게 된다
    if (input.branch === undefined && input.subject_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject_id'],
        message: 'error.approval.bypass_target_required',
      });
    }
    if (input.branch !== undefined && input.subject_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branch'],
        message: 'error.approval.bypass_target_required',
      });
    }
    if (input.head_sha !== undefined && input.branch === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['head_sha'],
        message: 'error.approval.bypass_head_needs_branch',
      });
    }
  });

/** 한 칸에 담을 수 있는 수 — 한 문서의 요구사항 · 작업이 이보다 많은 일은 없다(임포트 실측의 가장 큰 문서가 140줄) */
export const CR_ACTION_LIMIT = 200;

/**
 * **변경 요청 승인과 함께 할 일**(2026-10-16 · spec-workflow §3.3 · REQ-API-330) — 영향 미리보기(EP-SPEC-31)의 제안 가운데
 * 사람이 고른 것이다. 셋 다 선택이고 빈 배열은 "하지 않는다" 다.
 *
 * - `derive` — 더해진(ADDED) 요구사항 번호. 그 요구사항의 파생 작업을 `backlog` 로 만든다(목표 칸에 문장을 담은 위임 명세 초안)
 * - `reverify` — 바뀐(MODIFIED) 요구사항 번호. 완료한 작업이 있으면 재검증 작업을 하나 만든다
 * - `cancel` — 빠진(REMOVED) 요구사항의 미착수 작업 키. 그 작업을 보관한다(사유 `obsolete`)
 */
export const CrActionsInput = z
  .object({
    derive: z.array(z.string().min(1).max(200)).max(CR_ACTION_LIMIT).optional(),
    reverify: z.array(z.string().min(1).max(200)).max(CR_ACTION_LIMIT).optional(),
    cancel: z.array(z.string().min(1).max(200)).max(CR_ACTION_LIMIT).optional(),
  })
  .strict();
export type CrActions = z.infer<typeof CrActionsInput>;

/**
 * EP-APR-03 — 결정.
 *
 * `seen_content_hash` 는 **무엇을 보고 승인했는가**다 — 본문이 그 뒤 바뀌었으면
 * 그 승인은 다른 문서에 대한 것이라 막힌다.
 */
export const ApprovalDecisionInput = z
  .object({
    decision: z.string().default('comment'),
    comment: z.string().nullish(),
    seen_content_hash: z.string().nullish(),
    /**
     * **변경 요청을 승인하며 함께 할 일**(2026-10-16 · REQ-API-330) — 영향 미리보기에서 고른 제안. 승인 결정에서만 읽고,
     * 그 버전을 감싼 변경 요청에 남긴 뒤 버전이 승인되는 순간(정족수가 차는 순간) 서버가 한다. 변경 요청이 없는 결재면 400 이다
     */
    cr_actions: CrActionsInput.nullish(),
    /**
     * **에스컬레이션 카드의 처분**(2026-10-16 · 사람 결정 D3 · REQ-API-335) — `fix`(고칠 것) · `wont_fix`(유예) · `dismissed`(기각).
     * 에스컬레이션 카드에는 필수이고 다른 결재에 오면 400 이다. 어휘 판정은 도메인이 한다(`ESCALATION_RESOLUTIONS`)
     */
    resolution: z.string().nullish(),
  })
  .strict();

/**
 * EP-CR-03 — **변경 요청 거절**(2026-10-16 · 사람 결정 D1 · REQ-API-328). 결재의 거절(초안으로 돌아가 고쳐 다시 낸다)과 다르다
 * — 이 제안을 하지 않기로 하고 초안을 버린다. 사유는 필수다(작성자에게 가는 알림과 감사가 그 문장을 남긴다).
 */
export const CrRejectInput = z
  .object({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

/** EP-CR-04 — **철회**(REQ-API-328). 작성자가 초안을 스스로 버린다 — 한 줄 사유는 선택이다 */
export const CrWithdrawInput = z
  .object({
    reason: z.string().trim().max(2000).nullish(),
  })
  .strict();

/**
 * EP-APR-06 — **일괄 결정**(REQ-API-162).
 *
 * 항목마다 `seen_content_hash` 를 따로 싣는 것이 이 스키마의 요점이다. 일괄이 그 검사를
 * 건너뛰면 일괄 승인은 stale 승인 차단(§2.6 · OWASP ASI09 방어)의 **구멍**이 된다 —
 * 본문이 바뀐 한 건만 막히고 나머지는 지나가야 한다.
 *
 * 상한 50 은 서버가 쥔다. 화면이 쥐면 그 상수는 화면의 것이 되고, 다른 표면이 생기는
 * 순간 두 벌이 된다.
 */
export const BULK_DECISION_LIMIT = 50;

export const ApprovalBulkDecisionInput = z
  .object({
    decision: z.string().default('comment'),
    /** 거절 사유는 전 건에 같은 한 벌이 간다 — 사유가 건마다 다르면 그것은 일괄이 아니다 */
    comment: z.string().nullish(),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1),
            seen_content_hash: z.string().nullish(),
          })
          .strict(),
      )
      .min(1)
      // 넘기면 이 문장으로 답한다 — 일반 형식 오류로는 무엇을 줄여야 하는지 알 수 없다(parseBody)
      .max(BULK_DECISION_LIMIT, 'error.approval.bulk_limit'),
  })
  .strict();

/** EP-QST-02 — 답변. 선택지를 골랐으면 키, 자유 서술이면 본문 */
export const QuestionAnswerInput = z
  .object({
    answer_key: z.string().nullish(),
    answer_md: z.string().nullish(),
  })
  .strict();

/**
 * **[모두 읽음]의 범위**(2026-09-27 · 사람 결정 N4 · REQ-API-216) — 화면이 보고 있는 것만 바꾼다.
 *
 * 예전에는 화면의 필터와 상관없이 내 알림 전부를 읽음으로 바꿨다. 범위 칸이 생기면 사람이 보는
 * 것과 바뀌는 것이 더 크게 벌어진다. 모두 비우면 예전과 같다(모든 조직의 안 읽은 알림 전부).
 */
export const NotificationReadAllInput = z
  .object({
    /** 프로젝트 slug 또는 UUID — slug 는 `org` 로 좁힌다(REQ-API-213 과 같은 규칙) */
    project: z.string().min(1).nullish(),
    /** 조직 slug — `project` 없이 오면 그 조직의 프로젝트 전부다 */
    org: z.string().min(1).nullish(),
    /** 등급(`immediate` · `digest`) — 화면의 "중요" 필터 */
    importance: z.string().min(1).nullish(),
    /**
     * 기준 시각 — 화면이 받은 가장 새 알림의 `created_at`. 그 뒤에 온 알림은 그대로 둔다. 누르는
     * 사이에 온 알림까지 읽음으로 바꾸면 사람은 본 적 없는 알림을 잃는다.
     */
    until: z.string().min(1).nullish(),
  })
  .strict();
export type NotificationReadAllInput = z.infer<typeof NotificationReadAllInput>;

/**
 * **프로젝트의 알림 수준을 고른다**(2026-09-27 · 사람 결정 N3 · REQ-API-220). `all` 로 돌리면 행을
 * 지운다 — 기본값을 행으로 남기지 않는다.
 */
export const NotificationLevelInput = z
  .object({
    /** 프로젝트 slug 또는 UUID — slug 는 `org` 로 좁힌다(REQ-API-213 과 같은 규칙) */
    project: z.string().min(1),
    org: z.string().min(1).nullish(),
    /** 어휘는 `NOTIFICATION_LEVELS` — 판정은 서버가 한다 */
    level: z.string().min(1),
  })
  .strict();
export type NotificationLevelInput = z.infer<typeof NotificationLevelInput>;

/**
 * EP-NTF-08 — 알림 메일 요약을 켜고 끈다(2026-09-28 · 사람 결정 EM1~EM9 · REQ-API-232). 켤 때 시간대와
 * 언어는 화면이 브라우저의 값을 보낸다(EM5). 끄면 행을 지운다 — 켠 사람만 행이 있다.
 */
export const NotificationDigestInput = z
  .object({
    enabled: z.boolean(),
    /** 받는 시(時) — 그 사람의 현지 시각 */
    hour: z.number().int().min(0).max(23).optional(),
    /** IANA 시간대 이름 — 판정(실재하는 이름인가)은 서버가 한다 */
    timezone: z.string().min(1).max(64).optional(),
    /** 어휘는 `LOCALES` — 판정은 서버가 한다 */
    locale: z.string().min(1).optional(),
  })
  .strict();
export type NotificationDigestInput = z.infer<typeof NotificationDigestInput>;
