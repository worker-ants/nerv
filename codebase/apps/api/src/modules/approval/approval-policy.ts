// 결재 판정 한 벌 — 정본: docs/03-proposal/spec-workflow.md §2.3 · docs/04-mvp/api.md §2.6
//
// **판정이 두 벌이면 언젠가 한쪽만 고쳐진다**(D-05). 이 파일이 생긴 이유가 그것이다:
// 같은 "이 사람이 이 결재를 승인할 수 있는가" 를 세 곳이 각자 답하고 있었다 —
// 목록의 `canApproveSql`(역할 축이 없었다) · `decide` 의 자기 승인 판정(요청자만 봤다) ·
// `SpecService.assertDifferentApprover`(테스트만 부르던 두 번째 구현). 그래서 목록은
// 승인할 수 있다고 말하고 결정은 거절하는 카드가 생겼고, 남이 제출해 준 초안은
// **작성자가 자기 손으로 승인**할 수 있었다.
//
// 여기 있는 SQL 조각은 모두 `approval a` 를 기준으로 하고, 다음 조인을 전제한다:
//   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
//   LEFT JOIN agent_session owner ON owner.id = sv.author_session_id

import { rolesWithScope } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** `approval:decide` 를 가진 역할 — 목록의 정본은 `ROLE_SCOPES` 다(REQ-CB-006). */
export const DECIDER_ROLES = rolesWithScope('approval:decide');

/**
 * 이 프로젝트에서 그 사람이 그 역할을 가졌는가.
 *
 * **조직이 경계다**(REQ-API-125). `project_id IS NULL` 은 "조직 단위 멤버십" 이지
 * "아무 프로젝트나" 가 아니다 — 그 구별을 빠뜨리면 다른 조직의 admin 이 이 프로젝트의
 * 결재를 내릴 수 있게 된다.
 */
function hasRole(userId: string, roles: readonly string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM membership m
     WHERE m.user_id = ${userId}
       AND m.role::text IN (${sql.join(
         roles.map((r) => sql`${r}`),
         sql`, `,
       )})
       AND m.org_id = (SELECT org_id FROM project WHERE id = a.project_id)
       AND (m.project_id = a.project_id OR m.project_id IS NULL)
  )`;
}

/**
 * 이 카드의 **슬롯 역할**을 내가 가졌는가 — 비교 대상이 그 행의 값이라 목록이 아니다.
 * (`design → designer` 처럼 문서 타입이 정한 둘째 승인자 자리다.)
 */
function hasAssigneeRole(userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM membership m
     WHERE m.user_id = ${userId} AND m.role = a.assignee_role
       AND m.org_id = (SELECT org_id FROM project WHERE id = a.project_id)
       AND (m.project_id = a.project_id OR m.project_id IS NULL)
  )`;
}

/** admin 인가 — 자기 승인 완화(2026-08-30 결정)와 역할 큐의 상위 문이다. */
export function isAdminSql(userId: string): SQL {
  return hasRole(userId, ['admin']);
}

/**
 * **이 카드가 내 결재인가** — 지정 승인자 · 역할 슬롯 · 기본 큐 셋 중 하나.
 *
 * 예전에는 `assignee_user_id IS NULL OR = me` 뿐이었다. 그래서 결재권이 없는 viewer 의
 * 받은 요청에도 카드가 있었고(그 사람은 그것을 자기 일로 읽는다), 직군 슬롯은 어디에도
 * 반영되지 않았다 — 매트릭스의 ○ 가 코드에 없었다는 뜻이다.
 */
export function eligibleSql(userId: string): SQL {
  return sql`(
    ${isAdminSql(userId)}
    OR a.assignee_user_id = ${userId}
    OR (a.assignee_role IS NOT NULL AND ${hasAssigneeRole(userId)})
    OR (a.assignee_user_id IS NULL AND a.assignee_role IS NULL AND ${hasRole(userId, DECIDER_ROLES)})
  )`;
}

/**
 * **지시자≠승인자는 세 축이다**(spec-workflow §2.3 · 2026-09-07 정정).
 *
 * 요청자만 보던 동안 구멍이 하나 있었다: 작성자가 남에게 제출을 부탁하면 요청자는 그 남이
 * 되고, 작성자는 자기 초안을 자기 손으로 승인할 수 있었다. 에이전트가 쓴 초안도 같다 —
 * 그 세션의 소유자가 승인하면 사람이 검토한 것이 아니라 **자기가 시킨 것을 자기가 통과**시킨
 * 것이다(D-01 이 막으려는 바로 그것).
 */
export function notSelfSql(userId: string): SQL {
  return sql`(
    a.requested_by_user_id <> ${userId}
    AND (sv.author_user_id IS NULL OR sv.author_user_id <> ${userId})
    AND (owner.user_id IS NULL OR owner.user_id <> ${userId})
  )`;
}

/**
 * **한 사람은 한 번**(정족수의 "서로 다른 사용자").
 *
 * 라운드 경계는 `spec_version.submitted_at` 이다 — 거절 뒤 고쳐 다시 제출하면 옛 승인은
 * 그 시각보다 앞이라 자연히 빠진다. 그래서 정족수 테이블이 따로 필요 없다.
 */
export function notAlreadyApprovedSql(userId: string): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM approval prev
     WHERE prev.subject_type = a.subject_type AND prev.subject_id = a.subject_id
       AND prev.decision = 'approve' AND prev.assignee_user_id = ${userId}
       AND NOT prev.is_bypass
       AND (sv.submitted_at IS NULL OR prev.decided_at > sv.submitted_at)
  )`;
}

/**
 * 프로젝트에 **이 카드를 승인할 수 있는 다른 사람**이 몇이나 있는가(소규모 완화의 축).
 *
 * §2.3 의 문장은 "승인 가능한 다른 역할이 없으면 자동 완화" 다 — 멤버 수가 아니라
 * **승인 가능한 사람 수**가 조건이라, 혼자 도는 프로젝트에서 어떤 결재도 끝나지 않는 일을
 * 막으면서 사람이 둘 이상이면 규칙을 지킨다.
 */
export function otherApproverCountSql(userId: string): SQL {
  return sql`(
    SELECT count(DISTINCT m.user_id) FROM membership m
     WHERE m.org_id = (SELECT org_id FROM project WHERE id = a.project_id)
       AND (m.project_id = a.project_id OR m.project_id IS NULL)
       AND m.role::text IN (${sql.join(
         DECIDER_ROLES.map((r) => sql`${r}`),
         sql`, `,
       )})
       AND m.user_id <> ${userId}
       AND m.user_id <> a.requested_by_user_id
       AND (sv.author_user_id IS NULL OR m.user_id <> sv.author_user_id)
  )`;
}

/**
 * 이 사람이 이 결재를 **승인할 수 있는가** — 자격 · 세 축 · 한 사람 한 번을 한 식으로.
 *
 * 화면은 이 불리언을 그대로 읽는다(REQ-WEB-118). 화면이 규칙을 다시 구현하면 두 벌이
 * 되고, 두 벌이 되면 잠긴 단추와 서버의 답이 갈라진다.
 */
export function canApproveSql(userId: string): SQL {
  return sql`(
    ${eligibleSql(userId)}
    AND ${notAlreadyApprovedSql(userId)}
    AND (
      ${notSelfSql(userId)}
      OR ${isAdminSql(userId)}
      OR ${otherApproverCountSql(userId)} = 0
    )
  ) AS can_approve`;
}

/**
 * **왜 못 누르는가** — 잠긴 단추에는 이유가 있어야 한다(screens §1.5 막다른 길 금지).
 *
 * 순서가 뜻을 만든다: 자격이 없으면 그것이 먼저이고(역할·지정), 자격이 있는데 막히는
 * 이유는 세 축과 "이미 승인함" 이다.
 */
export function canApproveReasonSql(userId: string): SQL {
  return sql`(CASE
    WHEN ${isAdminSql(userId)} AND NOT ${notAlreadyApprovedSql(userId)} THEN 'already_approved'
    WHEN ${isAdminSql(userId)} THEN NULL
    WHEN a.assignee_user_id IS NOT NULL AND a.assignee_user_id <> ${userId} THEN 'not_assignee'
    WHEN a.assignee_role IS NOT NULL AND NOT ${hasAssigneeRole(userId)} THEN 'not_in_role_queue'
    WHEN a.assignee_user_id IS NULL AND a.assignee_role IS NULL
         AND NOT ${hasRole(userId, DECIDER_ROLES)} THEN 'missing_role'
    WHEN NOT ${notAlreadyApprovedSql(userId)} THEN 'already_approved'
    WHEN ${otherApproverCountSql(userId)} = 0 THEN NULL
    WHEN a.requested_by_user_id = ${userId} THEN 'self_requested'
    WHEN sv.author_user_id = ${userId} THEN 'author'
    WHEN owner.user_id = ${userId} THEN 'session_owner'
    ELSE NULL
  END) AS can_approve_reason`;
}

/** 자기 승인의 종류 — 감사에 남는 값이다(어느 축으로 자기 것인가). */
export function selfKindOf(
  row: {
    requested_by_user_id: string;
    author_user_id?: string | null;
    author_owner_user_id?: string | null;
  },
  userId: string,
): 'requester' | 'author' | 'session_owner' | null {
  if (row.requested_by_user_id === userId) return 'requester';
  if (row.author_user_id === userId) return 'author';
  if (row.author_owner_user_id === userId) return 'session_owner';
  return null;
}

/**
 * **정족수는 슬롯을 센다**(2026-09-07 · REQ-API-140).
 *
 * 필요 수(`approvals_required`)는 이번 라운드에 만들어진 결재 행의 수이고, 채운 수
 * (`approvals_given`)는 이번 라운드에 `approve` 를 낸 **서로 다른 사용자**의 수다.
 * 라운드 경계는 `spec_version.submitted_at` 이라, 거절 뒤 고쳐 다시 제출하면 옛 승인은
 * 그 시각보다 앞이라 자연히 빠진다 — 정족수 테이블을 따로 두지 않는 이유가 그것이다.
 *
 * 면제(`is_bypass`)는 세지 않는다. 면제는 게이트를 지나가는 것이지 승인이 아니다.
 */
export function quorumSql(subjectId: string, submittedAt: string | null): SQL {
  const round =
    submittedAt === null
      ? sql``
      : sql` AND (q.requested_at >= ${submittedAt}::timestamptz
                  OR q.decided_at >= ${submittedAt}::timestamptz)`;
  return sql`
    SELECT count(*)::int AS required,
           count(DISTINCT q.assignee_user_id) FILTER (WHERE q.decision = 'approve')::int AS given
      FROM approval q
     WHERE q.subject_type = 'spec_version' AND q.subject_id = ${subjectId}
       AND NOT q.is_bypass${round}
  `;
}

/**
 * 목록·상세가 카드에 싣는 정족수 두 값 — `approval a` · `sv` 조인을 전제로 한 상관 서브쿼리다.
 * 값이 없으면(스펙이 아닌 대상) 각각 1·0 이다.
 */
export function quorumColumnsSql(): SQL {
  return sql`
    COALESCE((SELECT count(*)::int FROM approval q
               WHERE q.subject_type = a.subject_type AND q.subject_id = a.subject_id
                 AND NOT q.is_bypass
                 AND (sv.submitted_at IS NULL OR q.requested_at >= sv.submitted_at
                      OR q.decided_at >= sv.submitted_at)), 1) AS approvals_required,
    COALESCE((SELECT count(DISTINCT q.assignee_user_id)::int FROM approval q
               WHERE q.subject_type = a.subject_type AND q.subject_id = a.subject_id
                 AND q.decision = 'approve' AND NOT q.is_bypass
                 AND (sv.submitted_at IS NULL OR q.decided_at >= sv.submitted_at)), 0) AS approvals_given`;
}
