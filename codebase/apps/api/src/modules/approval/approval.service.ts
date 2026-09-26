// 받은 요청 — 결정 · 지시자≠승인자 · stale 승인 차단
// 정본: docs/03-proposal/spec-workflow.md §2.5·§6.4 · docs/04-mvp/api.md §2.6
//
// **승인·질문·리뷰 요청은 알림이 아니라 작업 항목이다**(§6.4). 흩어진 핑 대신 미결 액션을
// 한 곳에서 추적하는 것이 받은 요청의 존재 이유이고, Phase 1 종료 게이트가 그것을 수치로 잰다 —
// 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건**.
//
// 카드는 세 유형이다: 승인 · 질문 · 통지. 그리고 **에이전트의 요약문이 아니라 실제 diff·대상
// 리소스를 먼저 보여준다** — 매끄러운 설명으로 사람을 속여 유해한 승인을 받아내는 것이
// OWASP ASI09 가 명명한 공격 표면이고, 원문 우선 표시가 그에 대한 구조적 방어다.

import { Injectable, Logger } from '@nestjs/common';
import {
  APPROVAL_INBOX_STATES,
  approvalDecision,
  msg,
  NERV_ERROR,
  NERV_EVENT,
  newId,
  questionStatus,
  scopesForRoles,
} from '@nerv/schema';
import type { Message, NervErrorCode } from '@nerv/schema';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  DECIDER_ROLES,
  bulkBlockReasonSql,
  canApproveReasonSql,
  canBulkApproveSql,
  quorumSql,
  canApproveExpr,
  canApproveSql,
  eligibleSql,
  quorumColumnsSql,
  selfKindOf,
} from './approval-policy.js';
import { InjectDb } from '../../common/database.module.js';
import {
  cursorId,
  cursorTimestamp,
  decodeCursor,
  encodeCursor,
  pageLimit,
} from '../../common/cursor.js';
import { assertVocab } from '../../common/query-vocab.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertHuman } from '../../common/human-only.js';
import type { Actor } from '../../common/human-only.js';
import { EventService } from '../event/event.service.js';
import { closeRequestNotifications } from '../event/request-notifications.js';
import { SpecService } from '../spec/spec.service.js';
import { AuthService } from '../auth/auth.service.js';

export type ApprovalDecision = 'approve' | 'reject' | 'comment';

/**
 * 일괄이 받는 결정 — 어휘에서 `comment` 만 뺀다(EP-APR-06).
 *
 * 목록을 손으로 적지 않고 enum 에서 깎아 내는 이유는 D-05 와 같다: 결정 어휘가 늘면
 * 여기도 함께 늘어야 하고, 손으로 적은 목록은 그때 조용히 옛 어휘로 남는다.
 */
const BULK_DECISIONS = approvalDecision.enumValues.filter((d) => d !== 'comment');

/**
 * 대기의 첫째 키 — **누를 수 있는 것이 먼저**다(2026-09-25 · REQ-API-184 · 사람 결정 D2).
 *
 * 질문은 멤버 누구나 답하므로 늘 0 이고, 결재는 서버 판정(`can_approve`)이 거짓일 때만 1 이다.
 * 잠긴 카드는 목록에서 빠지지 않는다 — 요청자가 스스로 거둘(거절) 길이고 이유가 카드에
 * 적힌다(REQ-API-137). 다만 **뒤로 간다**: 잠긴 카드가 요청 시각 순으로 한가운데 끼면, 누를 수
 * 있는 것을 다 처리해도 첫 쪽이 누를 수 없는 것으로 차 있었다.
 */
function lockRank(row: Record<string, unknown>): 0 | 1 {
  return row['subject_type'] !== 'question' && row['can_approve'] === false ? 1 : 0;
}

/**
 * 대기 목록의 두 소스(결재 · 질문)를 **같은 키로** 세운다 — `(잠김, 시각 ASC, id ASC)`.
 *
 * `cursor_at` 은 DB 가 준 텍스트라 사전순 비교가 곧 시각순이다(같은 타임존·같은 형식).
 * 시각이 같으면 `id` 가 가른다 — uuidv7 이라 그 순서가 삽입 순서다.
 */
function compareByCursor(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const al = lockRank(a);
  const bl = lockRank(b);
  if (al !== bl) return al - bl;
  const at = String(a['cursor_at'] ?? '');
  const bt = String(b['cursor_at'] ?? '');
  if (at !== bt) return at < bt ? -1 : 1;
  return String(a['id']) < String(b['id']) ? -1 : 1;
}

/** 일괄 결정의 항목별 결과 — **200 이 전부 성공을 뜻하지 않는다**(REQ-API-164) */
export interface BulkDecisionResult {
  id: string;
  ok: boolean;
  code?: NervErrorCode;
  /** `already_decided`·`stale_approval`·`bulk_quorum` 등 — 화면이 이 값으로 문장을 고른다 */
  kind?: string | null;
  /**
   * 사람에게 보일 문장의 **재료**다. 렌더는 로케일을 아는 표면이 한다 — 도메인 서비스는
   * 요청 로케일을 모르고, 알아야 한다면 판정과 표현이 한 자리에 섞인다(D-05).
   */
  descriptor?: Message;
  quorum?: { given: number; required: number; satisfied: boolean };
}

export interface InboxCard extends Record<string, unknown> {
  id: string;
  subject_type: string;
  subject_id: string;
  /** 카드 제목 — 대상 리소스의 표시 키 */
  subject_key: string | null;
  requested_by: string;
  requested_at: string;
  /** 요약이 아니라 **원문**이다(§6.4) */
  body_md: string | null;
  /** 지시자≠승인자 — 이 카드를 내가 승인할 수 있는가 */
  self_requested: boolean;
  /** 지시자≠승인자 규칙과 그 완화(소규모·admin)를 서버가 판정한 결과 */
  can_approve: boolean;
  /**
   * **왜 못 누르는가**(2026-09-07 · REQ-API-137). 잠긴 단추에 이유가 없으면 사람은 화면이
   * 고장 났다고 읽는다 — `author`·`session_owner`·`self_requested`·`missing_role`·
   * `not_in_role_queue`·`not_assignee`·`already_approved` 중 하나이고, 누를 수 있으면 NULL 이다.
   */
  can_approve_reason: string | null;
  /** 직군 슬롯(있으면) — 이 카드가 어느 역할 큐의 것인가 */
  assignee_role: string | null;
  /** stale 판정용 — 결정 시점에 내용이 바뀌었는지 본다 */
  content_hash: string | null;
}

/** 받은 요청 한 쪽 — §1.6 봉투(EP-APR-01) */
export interface InboxPage {
  items: Record<string, unknown>[];
  next_cursor: string | null;
  /** 같은 조건의 **전체 수**(REQ-API-166) — 잠긴 카드까지 */
  total: number;
  /**
   * 그중 **내가 누를 수 있는 것**(질문 + `can_approve` 가 참인 결재 · REQ-API-184). 대기 목록에만
   * 온다 — 처리됨에는 누를 것이 없다(없는 값은 없는 것으로 온다 · `can_approve` 와 같은 규율).
   */
  actionable_total?: number;
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly events: EventService,
    private readonly specs: SpecService,
    private readonly auth: AuthService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * 지정 승인자가 있으면 그 사람(또는 admin), 없으면 **역할 큐**다.
   *
   * 역할 큐는 `approval:decide` 를 가진 역할이고(정본: `ROLE_SCOPES`), 그 목록을 여기서
   * 다시 적지 않는다 — 역할이 늘거나 권한이 바뀌면 두 벌 중 하나만 고쳐지기 때문이다.
   */
  private async assertMayDecide(
    projectId: string,
    userId: string,
    assigneeUserId: string | null,
    assigneeRole: string | null,
  ): Promise<void> {
    const roles = await this.auth.assertMembership(userId, projectId);
    if (assigneeUserId !== null) {
      if (assigneeUserId === userId || roles.includes('admin')) return;
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.approval.not_assignee'), {
        kind: 'not_assignee',
        roles,
      });
    }
    // **직군 슬롯**(2026-09-07 · REQ-API-138). 매트릭스의 ○ 는 "지정 시" 라는 뜻이고, 그 지정이
    // 이 열이다 — 슬롯에 역할이 적혀 있으면 그 역할(또는 admin)만 내린다. planner 라고 해서
    // designer 자리의 결재를 대신 내리면 직군 교차라는 게이트의 뜻이 사라진다.
    if (assigneeRole !== null) {
      if ((roles as readonly string[]).includes(assigneeRole) || roles.includes('admin')) return;
      throw new NervError(
        NERV_ERROR.FORBIDDEN,
        msg('error.approval.not_in_role_queue', { role: assigneeRole }),
        { kind: 'not_in_role_queue', role: assigneeRole, roles },
      );
    }
    if (scopesForRoles(roles).has('approval:decide')) return;
    throw new NervError(
      NERV_ERROR.FORBIDDEN,
      msg('error.auth.scope_missing', { scope: 'approval:decide' }),
      {
        kind: 'missing_scope',
        required: ['approval:decide'],
        roles,
      },
    );
  }

  /**
   * 결정을 **대상에 적용한다** — 결재 행을 고치는 것만으로는 아무 일도 일어나지 않는다.
   *
   * 지금 아는 대상은 `spec_version` 하나다. `question` 은 전용 경로(`questions.answer`)가
   * 이미 상태를 옮기고, `plan`·`gate_bypass` 는 결재 자체가 사실이라 옮길 상태가 없다.
   * **모르는 대상은 조용히 넘어간다** — 여기서 던지면 결정 자체가 롤백되고, 그건 "결재는
   * 됐는데 문서가 안 움직였다" 보다 더 나쁜 자리다.
   */
  private async applyToSubject(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    emit: Parameters<Parameters<EventService['transact']>[0]>[1],
    input: { projectId: string; userId: string; decision: ApprovalDecision; comment?: string },
    approval: { subject_type: string; subject_id: string; submitted_at?: string | null },
  ): Promise<{ given: number; required: number; satisfied: boolean } | null> {
    if (approval.subject_type !== 'spec_version') return null;
    if (input.decision === 'approve') {
      // **정족수 집계는 직렬화한다**(2026-09-07 · REQ-API-140). 두 승인이 동시에 들어오면
      // 각자 "나까지 1건" 을 세고 **아무도 전이하지 않는** 경합이 생긴다 — 대상 행을 먼저
      // 잠가 한 줄로 세운다. 잠그는 것이 결재 행이 아니라 문서인 이유는, 세는 대상이
      // 그 문서의 슬롯 전부이기 때문이다.
      await tx.execute(
        sql`SELECT id FROM spec_version WHERE id = ${approval.subject_id} FOR UPDATE`,
      );
      const { rows: counted } = await tx.execute<{ required: number; given: number }>(
        quorumSql(approval.subject_id, approval.submitted_at ?? null),
      );
      const required = counted[0]?.required ?? 1;
      const given = counted[0]?.given ?? 0;
      if (given < required) {
        // **아직 확정이 아니다.** 이 자리가 없던 동안 첫 승인이 문서를 approved 로 옮겼고,
        // T3 의 "서로 다른 2인" 은 문서에만 적혀 있는 약속이었다(실측 3건 모두 1인 승인).
        return { given, required, satisfied: false };
      }
      await this.specs.approveInTxForApproval(tx, emit, {
        projectId: input.projectId,
        specVersionId: approval.subject_id,
        approverUserId: input.userId,
      });
      return { given, required, satisfied: true };
    }
    // **`comment` 도 문서를 움직인다** — 되돌려 놓는다(2026-09-02).
    //
    // 예전에는 "말만 남기는 결정" 이라 대상을 건드리지 않았다. 그런데 결정이 적히는
    // 순간 카드는 받은 요청에서 사라지고(`decision IS NULL` 만 보인다) 재결정은
    // `already_decided` 로 막힌다. 문서는 `in_review` 에 남는데 그 상태는 편집 불가이고
    // (D-02: 가변 구간은 draft 하나뿐) 제출도 draft 만 받으므로, **고칠 수도 다시 낼 수도
    // 없는 문서**가 된다 — 검토자가 "한 가지만 확인해 주세요" 를 누른 대가치고는 무겁다.
    //
    // 3.5 §2.5 는 이 결정을 "comment + 승인자가 직접 draft 편집 → 재제출" 로 그린다.
    // 그러려면 편집 가능한 상태여야 한다. 거절과 다른 것은 **뜻**이지 상태가 아니다 —
    // 이벤트는 `spec.rejected` 가 아니라 코멘트로 남는다.
    if (input.decision === 'reject' || input.decision === 'comment') {
      await this.specs.rejectInTxForApproval(tx, emit, {
        projectId: input.projectId,
        specVersionId: approval.subject_id,
        reviewerUserId: input.userId,
        comment: input.comment ?? '',
        ...(input.decision === 'comment' ? { asComment: true } : {}),
      });
    }
    return null;
  }

  /**
   * EP-APR-05 프로젝트 소속 받은 요청 — **전역과 같은 목록을 프로젝트로 좁힌 것**이다.
   *
   * 예전에는 자기 질의를 따로 들고 있었고, 그래서 **같은 질문에 다른 답**을 냈다
   * (실측 2026-09-24 · 결재 3 + 질문 2 를 심고 나란히 부른 결과):
   *
   *   ① **질문을 싣지 않았다** — 전표는 "그 프로젝트의 받은 요청(**결재 + 질문**)" 이라
   *      적는데 결재만 왔다. S7 이 프로젝트 안에서 읽는 곳이라면서 전역과 다른 목록을
   *      보여 주고 있었다.
   *   ② **보관한 프로젝트의 결재를 계속 내보냈다.** 2026-08-27 에 전역 쪽에서 고친 그
   *      결함이(치운 프로젝트를 사람이 계속 결재하도록 두면 받은 요청을 못 믿게 된다)
   *      이 표면에는 오지 않았다 — 보관 뒤 전역 0건 · 여기 3건.
   *   ③ **열이 달라 카드를 그릴 수 없었다.** `waiting_seconds`(카드의 필수 표기 —
   *      얼마나 기다렸나)·`project_slug`(링크)·`spec_key`·`spec_title` 이 없고 제목은
   *      `subject_key` 라는 다른 이름으로 왔다.
   *
   * 판정이 두 벌이면 언젠가 한쪽만 고쳐진다(D-05) — 실제로 셋 다 그렇게 벌어졌다.
   * 그래서 질의를 없애고 **전역 표면을 프로젝트로 좁혀 부른다.** 이 표면이 따로 있는
   * 이유는 주소뿐이다(프로젝트 안에서 읽는 곳).
   */
  async inbox(input: {
    projectId: string;
    userId: string;
    /** 사람 전용 게이트의 축 — 전역 경로(EP-APR-01)와 같은 규칙이다(D-05 · REQ-API-123) */
    actor: Actor;
    state?: string | null;
    cursor?: string | null;
    limit?: string | number | null;
  }): Promise<InboxPage> {
    return this.inboxGlobal({
      actor: input.actor,
      userId: input.userId,
      state: input.state ?? null,
      projectId: input.projectId,
      cursor: input.cursor ?? null,
      limit: input.limit ?? null,
    });
  }

  /**
   * EP-APR-01 전역 받은 요청 — **내 결정을 기다리는 것만** 센다(spec-workflow §6.6 원칙 3).
   *
   * 프로젝트를 가로지르는 이유는 사람의 하루가 프로젝트로 나뉘어 있지 않기 때문이다.
   * 승인 3유형(스펙 승인·플랜·질문)이 한 줄에 섞여 나오고, 각 카드는 **얼마나 기다렸는지**를
   * 들고 온다 — 대기 시간이 보이지 않으면 승인은 조용히 늦어진다(P4).
   */
  async inboxGlobal(input: {
    /** 사람 전용 게이트의 축 — 판정은 표면이 아니라 여기다(D-05 · REQ-API-111) */
    actor: Actor;
    userId: string;
    /** 어휘는 `APPROVAL_INBOX_STATES` — 판정은 아래에서 한다(REQ-API-126) */
    state?: string | null;
    projectSlug?: string | null;
    /**
     * 프로젝트를 **id 로** 좁힌다 — 프로젝트 소속 받은 요청(EP-APR-05)이 이 축으로 들어온다.
     * slug 와 나란히 두는 이유: 전역 표면은 사람이 고른 slug 를 받고, 프로젝트 표면은
     * 가드가 이미 해소한 id 를 쥐고 있다(다시 해소하면 조직 경계 판정이 두 벌이 된다).
     */
    projectId?: string | null;
    /** 불투명 커서(§1.6) — 해독되지 않으면 처음부터다 */
    cursor?: string | null;
    limit?: string | number | null;
  }): Promise<InboxPage> {
    assertHuman(input.actor, 'inbox', '/inbox');
    const decided =
      assertVocab([input.state ?? 'pending'], APPROVAL_INBOX_STATES, 'state')[0] === 'decided';
    const limit = pageLimit(input.limit ?? undefined);
    const stateFilter = decided ? sql`a.decision IS NOT NULL` : sql`a.decision IS NULL`;
    /**
     * **두 탭은 다른 질문에 답한다**(2026-09-24 · 사람 결정 · REQ-API-165).
     *
     * 한 `WHERE` 절이 둘을 겸하는 동안 처리됨 탭은 **결정이 문서를 움직인 순간 그 기록을
     * 잃었다**: 승인하면 `approved`, 거절하면 `draft` 라 `sv.status = 'in_review'` 에서
     * 함께 탈락했다. 살아남는 것은 문서를 안 움직인 것(T3 첫 승인)과 스펙이 아닌 것뿐이고,
     * 그 줄은 **대기 탭을 위해 쓴 것**이다(거절로 draft 가 된 문서의 남은 슬롯은 대기가
     * 아니다). 실측 2026-09-24: 넷을 결정하니 둘이 사라졌다.
     *
     * `eligibleSql` 도 같다 — 그것은 "이 카드가 **내 큐인가**" 를 묻는 식이라 결정된 카드에
     * 물으면 엉뚱한 답이 나온다. 남이 낸 면제가 내 처리됨에 뜨고 내가 끝낸 것은 빠졌다.
     * 처리됨이 답해야 하는 질문은 하나다 — **내가 결정한 것**(빈 상태 문구가 그렇게 적고,
     * 매뉴얼도 "지워지지 않으므로 나중에도 읽을 수 있습니다" 라고 약속한다).
     */
    const scopeFilter = decided
      ? sql`a.decided_by_user_id = ${input.userId}`
      : sql`${eligibleSql(input.userId)}
         -- **거절로 draft 가 된 문서의 남은 슬롯은 대기가 아니다**(2026-09-07). 슬롯이
         -- 여럿인 결재에서 하나가 reject 되면 문서는 draft 로 돌아가는데, 결정되지 않은
         -- 나머지 슬롯은 그대로 남아 있다 — 그것을 대기 목록에 두면 이미 끝난 라운드를
         -- 사람이 계속 결재하게 된다.
         AND (sv.id IS NULL OR sv.status = 'in_review')`;
    /**
     * **정렬 방향이 탭마다 다르다** — 그리고 그 방향이 상한과 맞물려 결함이었다.
     *
     * 대기는 **오래 기다린 것이 위**다(REQ-WEB-024 — 그러지 않으면 오래된 요청이 새 요청
     * 밑에 묻힌다). 그런데 질의는 `requested_at DESC LIMIT 100` 으로 **가장 최근 100건**을
     * 집고 화면이 그것을 다시 오래된 순으로 세웠다. 실측 2026-09-24(120건 · 0~119시간 전):
     * **가장 오래 기다린 20건이 목록에서 통째로 빠졌다.** 화면이 존재하는 이유를 상한이
     * 정확히 뒤집고 있었고, 카드가 없으니 배지도 그것을 세지 않았다 — 나흘 묵은 결재가
     * 존재 자체로 안 보였다. 여기서 방향을 바로잡고 커서로 잇는다.
     *
     * 처리됨은 반대다 — **방금 결정한 것이 위**여야 한다(그 목록은 기록이고, 기록은 최근
     * 것부터 읽는다).
     */
    //
    // 대기의 **첫째 키는 누를 수 있는가**다(2026-09-25 · REQ-API-184) — 잠긴 카드는 뒤로 간다.
    // `can_approve` 는 위 SELECT 의 열 이름이다(대기 행에서는 늘 참·거짓 — 자격(`eligibleSql`)이
    // 참인 행만 오고 나머지 항은 NULL 을 만들지 않는다).
    const orderBy = decided
      ? sql`a.decided_at DESC, a.id DESC`
      : sql`can_approve DESC, a.requested_at ASC, a.id ASC`;
    /**
     * **커서는 (정렬 키, id) 다**(§1.6 · REQ-API-124). 시각 하나로 seek 하면 같은 시각의
     * 행이 쪽 경계에 걸릴 때 남은 것이 어느 쪽에도 나오지 않는다 — 한 트랜잭션이 슬롯을
     * 여럿 세우는 T3 제출이 정확히 그 모양이라(같은 `requested_at`) 여기서는 드문 일이
     * 아니다. `id` 는 uuidv7 이라 같은 순간 안에서도 삽입 순서다.
     *
     * 시각은 **DB 가 준 텍스트 그대로** 싣는다(§1.6 · 2026-09-10). `Date` 로 왕복시키면
     * µs 가 ms 로 잘려 동률 판정(`=`)이 조용히 깨진다.
     */
    const cursor = decodeCursor(input.cursor ?? undefined);
    const cursorAt = cursorTimestamp(cursor?.[0]);
    const cursorRowId = cursorId(cursor?.[1]);
    const seekable = cursorAt !== null && cursorRowId !== null;
    // 대기 커서의 셋째 칸 — 잠긴 구역에 들어섰는가. 칸이 없는 옛 커서는 앞 구역으로 읽는다
    const cursorLocked = !decided && cursor?.[2] === 1;
    const approvalSeek = !seekable
      ? sql``
      : decided
        ? sql` AND (a.decided_at, a.id) < (${cursorAt}::timestamptz, ${cursorRowId}::uuid)`
        : sql` AND (NOT COALESCE(${canApproveExpr(input.userId)}, false), a.requested_at, a.id)
                 > (${cursorLocked}::boolean, ${cursorAt}::timestamptz, ${cursorRowId}::uuid)`;
    // 질문은 늘 앞 구역이다 — 잠긴 구역에 들어선 커서 뒤에는 질문이 남아 있지 않다
    const questionSeek = !seekable
      ? sql``
      : cursorLocked
        ? sql` AND false`
        : sql` AND (q.asked_at, q.id) > (${cursorAt}::timestamptz, ${cursorRowId}::uuid)`;
    /**
     * **결정된 카드에는 판정을 싣지 않는다**(2026-09-24).
     *
     * 이 넷은 "내가 이것을 누를 수 있는가" 에 답하는 값이고 처리됨 카드에는 누를 것이
     * 없다 — 단추도 체크박스도 그리지 않는다(REQ-WEB-133). 그런데 `can_approve` 계열은
     * 카드마다 상관 서브쿼리를 넷 세우고, 그중 `otherApproverCountSql` 은 멤버십을 훑는다.
     * 아무도 읽지 않는 값을 목록 길이만큼 계산하고 있었다.
     *
     * 빼는 것이지 `false` 로 채우는 것이 아니다 — 거짓 값은 "누를 수 없다" 라는 **판정**으로
     * 읽히고, 화면의 폴백(`typeof card.can_approve === 'boolean'`)이 그것을 그대로 믿는다.
     * 없는 값은 없는 것으로 온다.
     *
     * `content_hash` 도 같다: stale 승인 차단(§2.3)이 결정 시점에 쓰는 지문이라 끝난
     * 카드에는 쓸 곳이 없다. 정족수 둘은 **남긴다** — T3 를 하나 승인하고 둘째를 기다리는
     * 중이라면 그 카드의 `1/2 승인` 은 처리됨에서도 사실이다.
     */
    const verdictColumns = decided
      ? sql``
      : sql`${canApproveSql(input.userId)},
             ${canApproveReasonSql(input.userId)},
             -- 일괄 판정도 **서버가 한다**(REQ-API-163). 화면이 "정족수 1 이고 면제가
             -- 아니면 저위험" 을 다시 구현하면 두 벌이 되고, admin 완화가 낀 규칙은 두 벌이
             -- 되는 순간 한쪽만 고쳐진다 — can_approve 가 서버 판정인 이유와 같은 자리다.
             ${canBulkApproveSql(input.userId)},
             ${bulkBlockReasonSql(input.userId)},
             encode(sv.content_hash, 'hex') AS content_hash,`;
    const projectFilter =
      input.projectSlug != null
        ? sql` AND p.slug = ${input.projectSlug}`
        : input.projectId != null
          ? sql` AND p.id = ${input.projectId}`
          : sql``;
    /**
     * FROM 과 WHERE 를 조각으로 뽑는다 — 목록과 **총계가 같은 조건을 봐야** 하기 때문이다.
     *
     * 배지와 목록이 어긋나면 지울 수 없는 숫자가 남는다(알림 배지에서 이미 겪은 자리 ·
     * REQ-WEB-035). 손으로 두 번 적으면 언젠가 한쪽만 고쳐진다.
     */
    const approvalFrom = sql`FROM approval a
        JOIN project p ON p.id = a.project_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN agent_session owner ON owner.id = sv.author_session_id`;
    const memberOfProject = sql`EXISTS (
           SELECT 1 FROM membership m
            WHERE m.user_id = ${input.userId} AND m.org_id = p.org_id
              AND (m.project_id IS NULL OR m.project_id = p.id)
         )`;
    const approvalWhere = sql`WHERE ${stateFilter}${projectFilter}
         -- **보관한 프로젝트의 결재는 여기 오지 않는다**(2026-08-27 · 사람 보고).
         -- 목록에는 보이는데 누르면 아무 일도 일어나지 않았다 — 치운 프로젝트를
         -- 사람이 계속 결재하도록 두는 것은 받은 요청을 못 믿게 만드는 가장 빠른 길이다.
         AND p.archived_at IS NULL
         -- 대기는 **내 큐**(지정·역할 슬롯·기본 큐 · REQ-API-137) · 처리됨은 **내가 결정한 것**
         AND ${scopeFilter}
         AND ${memberOfProject}`;
    const questionFrom = sql`FROM question q
        JOIN project p ON p.id = q.project_id`;
    const questionWhere = sql`WHERE q.status = 'open'${projectFilter}
         -- 승인 카드와 **같은 조건**이다. 한쪽만 걸렀더니 보관한 프로젝트의 질문
         -- 카드가 받은 요청에 그대로 남았다(실측 2026-08-27) — 받은 요청은 한 목록이므로
         -- 두 갈래가 같은 규칙을 써야 그 목록이 한 가지 뜻을 갖는다.
         AND p.archived_at IS NULL
         AND ${memberOfProject}`;

    const { rows: approvals } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.requested_at, a.decided_at, a.is_bypass,
             -- 커서가 이 값을 그대로 싣는다 — 표시용 열과 **따로 뽑는다**: 드라이버가 주는
             -- 표시 값의 정밀도에 커서를 매달면, 그 정밀도가 바뀌는 날 동률 판정이 깨진다
             ${decided ? sql`a.decided_at` : sql`a.requested_at`}::text AS cursor_at,
             p.slug AS project_slug, p.name AS project_name, p.id AS project_id,
             -- **어느 조직의 일인가**(2026-09-24 · REQ-API-170). 이 목록은 조직을 가로지르는데
             -- 조직을 싣지 않아, 두 조직에 같은 slug 가 있으면 화면이 둘을 가를 수 없었다
             (SELECT o.slug FROM organization o WHERE o.id = p.org_id) AS org_slug,
             (SELECT o.name FROM organization o WHERE o.id = p.org_id) AS org_name,
             u.display_name AS requested_by,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             a.assignee_role::text AS assignee_role,
             -- **결정에 남긴 말**(2026-09-24 · REQ-WEB-133). 거절 사유는 필수인데
             -- (REQ-WEB-022) 그 문장이 목록 어디에도 실리지 않아, 처리됨 탭에서 가장
             -- 궁금한 한 줄 — "내가 왜 거절했더라" — 을 읽을 길이 없었다.
             a.comment_md,
             ${verdictColumns}
             ${quorumColumnsSql()},
             s.key AS spec_key, s.title AS spec_title, sv.version_no,
             -- **무엇을 · 누가 · 왜**(2026-09-24 — UI/UX 검토 · REQ-API-177). 카드는 종류 이름과 대기
             -- 시간만 말했다 — 플랜·발견 카드는 대상조차 가리키지 않았고(critical 하향 승인이 무엇을
             -- 내리는지 모른 채 켜져 있었다), 스펙 카드는 몇 번째 버전인지·무엇이 왜 바뀌었는지·어느
             -- 세션이 이 결재 때문에 멈춰 있는지를 말하지 않았다. 이미 있는 행에서 잇기만 한다
             sv.change_summary_md,
             rs.hostname AS requested_hostname, rs.agent_type::text AS requested_agent_type,
             (rs.state = 'awaiting_input') AS session_waiting,
             pt.key AS task_key, pt.title AS task_title,
             CASE WHEN a.subject_type = 'finding' THEN a.subject_id END AS finding_id,
             f.title AS finding_title, f.severity::text AS finding_severity,
             -- 게이트 티어는 요청 이벤트의 payload 에 남는다(스펙 제출이 판정한 그 값).
             -- **근거도 함께 온다**(2026-09-26 · REQ-API-188 · spec-workflow §6.4) — 4축 합계 ·
             -- 축별 점수 · 티어를 올린 신호. 이 칸이 생기기 전의 요청에는 티어만 있다(칸은 NULL)
             gate.payload->>'gate_tier' AS gate_tier,
             (gate.payload->>'gate_score')::int AS gate_score,
             gate.payload->'gate_axes' AS gate_axes,
             gate.payload->'gate_signals' AS gate_signals,
             -- 신호의 근거 — 재시도 신호가 가리키는 에스컬레이션(2026-09-26 · REQ-API-189)
             gate.payload->'gate_evidence' AS gate_evidence,
             extract(epoch FROM (now() - a.requested_at))::int AS waiting_seconds
        ${approvalFrom}
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN agent_session rs ON rs.id = a.requested_by_session_id
   LEFT JOIN task pt ON pt.id = a.subject_id AND a.subject_type = 'plan'
   LEFT JOIN finding f ON f.id = a.subject_id AND a.subject_type = 'finding'
   LEFT JOIN LATERAL (
          SELECT e.payload FROM event e
           WHERE e.type = ${NERV_EVENT.APPROVAL_REQUESTED} AND e.subject_id = a.id
             AND e.payload ? 'gate_tier'
           ORDER BY e.occurred_at DESC
           LIMIT 1) gate ON true
       ${approvalWhere}${approvalSeek}
       ORDER BY ${orderBy}
       LIMIT ${limit + 1}
    `);

    if (decided) {
      const { rows: counted } = await this.db.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total ${approvalFrom} ${approvalWhere}
      `);
      return this.page(approvals, limit, counted[0]?.total ?? 0, false);
    }

    // 질문 카드 — 승인과 같은 줄에 선다. 에이전트가 답을 기다리며 멈춰 있고(awaiting_input),
    // 세션 신원 3요소와 경과 시간이 카드의 필수 표기다(REQ-WEB-008).
    const { rows: questions } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT q.id, 'question' AS subject_type, q.id AS subject_id, NULL::text AS decision,
             q.asked_at AS requested_at, q.asked_at::text AS cursor_at,
             q.title, q.body_md, q.options, q.urgency::text AS urgency,
             p.slug AS project_slug, p.name AS project_name, p.id AS project_id,
             -- **어느 조직의 일인가**(2026-09-24 · REQ-API-170). 이 목록은 조직을 가로지르는데
             -- 조직을 싣지 않아, 두 조직에 같은 slug 가 있으면 화면이 둘을 가를 수 없었다
             (SELECT o.slug FROM organization o WHERE o.id = p.org_id) AS org_slug,
             (SELECT o.name FROM organization o WHERE o.id = p.org_id) AS org_name,
             u.display_name AS requested_by,
             se.hostname, se.agent_type::text AS agent_type, se.external_session_id,
             -- 답을 보낸 뒤 **그 세션으로 가는 길**(2026-09-26 · REQ-WEB-239) — 잘못 답했으면 거두는 길은
             -- 없고(에이전트가 1초 안에 받는다) 그 세션에 지시로 고쳐 말한다
             q.agent_session_id AS session_id,
             -- **출처는 카드의 절반이다.** 사람은 에이전트의 요약이 아니라 원문을 보고
             -- 판단하므로, 어느 문서·작업·발견에서 온 질문인지가 카드에 있어야 한다
             t.key AS task_key, s.key AS spec_key, q.finding_id, q.escalate::text AS escalate,
             extract(epoch FROM (now() - q.asked_at))::int AS waiting_seconds
        ${questionFrom}
        JOIN agent_session se ON se.id = q.agent_session_id
        JOIN "user" u ON u.id = se.user_id
   LEFT JOIN task t ON t.id = q.task_id
   LEFT JOIN spec s ON s.id = q.spec_id
       ${questionWhere}${questionSeek}
       ORDER BY q.asked_at ASC, q.id ASC
       LIMIT ${limit + 1}
    `);

    /**
     * **누를 수 있는 수를 따로 센다**(2026-09-25 · REQ-API-184 · 사람 결정 D2). 헤더 배지와 홈의
     * 인사("결정 N건이 밀려 있어요")가 `total` 을 쓰는 동안, 그 수에는 **내가 승인할 수 없는
     * 카드**가 섞였다 — 내 에이전트가 올린 스펙 · 내가 쓴 초안 · T3 에서 이미 승인하고 남은 칸.
     * 할 수 있는 것을 다 처리해도 숫자가 0 이 되지 않았고, 배지는 "내가 막고 있는 것" 을 뜻하지
     * 않게 됐다. 판정은 목록의 `can_approve` 와 **같은 식**이다(두 벌이면 한쪽만 고쳐진다).
     */
    const { rows: counted } = await this.db.execute<{
      total: number;
      actionable_total: number;
    }>(sql`
      SELECT (SELECT count(*) ${approvalFrom} ${approvalWhere})::int
           + (SELECT count(*) ${questionFrom} ${questionWhere})::int AS total,
             (SELECT count(*) ${approvalFrom} ${approvalWhere}
                AND ${canApproveExpr(input.userId)})::int
           + (SELECT count(*) ${questionFrom} ${questionWhere})::int AS actionable_total
    `);

    /**
     * 두 소스를 **같은 키로** 병합한다 — 둘 다 `(시각 ASC, id ASC)` 로 뽑혔으므로 합쳐
     * 다시 세우면 한 목록이 된다. 각각 `limit + 1` 을 가져왔으니 합친 것이 `limit` 보다
     * 많으면 다음 쪽이 있고, 아니면 양쪽이 다 바닥난 것이다.
     */
    const merged = [...approvals, ...questions].sort(compareByCursor);
    return {
      ...this.page(merged, limit, counted[0]?.total ?? 0, true),
      actionable_total: counted[0]?.actionable_total ?? 0,
    };
  }

  /**
   * 목록을 §1.6 봉투로 접는다 — **총계를 함께 주는 이유**가 있다.
   *
   * 쪽을 나누는 순간 "목록 길이 = 전체 수" 가 깨지는데, 받은 요청은 그 수를 세 자리에서
   * 쓴다(헤더 배지 · 홈의 인사 · "받은 요청 전체 N건"). 별도 엔드포인트로 세면 출처가
   * 둘이 되고, 배지와 목록이 어긋나면 지울 수 없는 숫자가 남는다(REQ-WEB-035 가 알림에서
   * 적어 둔 그 교훈이다). 같은 질의에서 같은 조건으로 센다.
   *
   * `cursor_at` 은 **응답에서 걷는다**: 커서는 불투명해야 하고(§1.6), 조각을 내보이면
   * 클라이언트가 그것을 읽기 시작하면서 구조가 사실상 계약이 된다.
   */
  private page(
    rows: Record<string, unknown>[],
    limit: number,
    total: number,
    /** 대기 목록이면 커서가 잠긴 구역에 들어섰는지를 셋째 칸으로 싣는다(REQ-API-184) */
    lockAware: boolean,
  ): InboxPage {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const next =
      rows.length > limit && last !== undefined
        ? encodeCursor([
            String(last['cursor_at']),
            String(last['id']),
            ...(lockAware ? [lockRank(last)] : []),
          ])
        : null;
    for (const row of items) delete row['cursor_at'];
    return { items, next_cursor: next, total };
  }

  /** EP-APR-02 — 카드 하나의 전량(대상 원문 포함). 결정 화면이 이걸로 렌더한다. */
  async detail(input: {
    approvalId: string;
    userId: string;
    /** 사람 전용 게이트의 축 — 판정은 표면이 아니라 여기다(D-05 · REQ-API-111) */
    actor: Actor;
  }): Promise<Record<string, unknown>> {
    assertHuman(input.actor, 'inbox', '/inbox');
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.project_id, a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.comment_md, a.requested_at, a.decided_at,
             a.is_bypass, a.bypass_reason,
             p.slug AS project_slug, u.display_name AS requested_by,
             -- 누가 결정했는가 — 받은 요청이 "찾던 카드는 이미 처리됐다" 를 말할 때 쓴다(REQ-WEB-204)
             (SELECT du.display_name FROM "user" du WHERE du.id = a.decided_by_user_id) AS decided_by,
             (a.requested_by_user_id = ${input.userId}) AS self_requested,
             a.assignee_role::text AS assignee_role,
             ${canApproveSql(input.userId)},
             ${canApproveReasonSql(input.userId)},
             ${quorumColumnsSql()},
             s.key AS spec_key, s.title AS spec_title, sv.version_no, sv.body_md,
             sv.change_summary_md, encode(sv.content_hash, 'hex') AS content_hash
        FROM approval a
        JOIN project p ON p.id = a.project_id
        JOIN "user" u ON u.id = a.requested_by_user_id
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN agent_session owner ON owner.id = sv.author_session_id
       WHERE a.id = ${input.approvalId}
         AND EXISTS (
           SELECT 1 FROM membership m
            WHERE m.user_id = ${input.userId} AND m.org_id = p.org_id
              AND (m.project_id IS NULL OR m.project_id = p.id)
         )
    `);
    const approval = rows[0];
    if (approval === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.not_found'), {
        kind: 'not_found',
        approval_id: input.approvalId,
      });
    }
    return approval;
  }

  /** 결정 경로가 프로젝트를 스스로 찾을 수 있게 — 전역 라우트는 경로에 프로젝트가 없다. */
  async projectOfApproval(approvalId: string): Promise<string> {
    const { rows } = await this.db.execute<{ project_id: string }>(
      sql`SELECT project_id FROM approval WHERE id = ${approvalId}`,
    );
    const projectId = rows[0]?.project_id;
    if (projectId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.not_found'), {
        kind: 'not_found',
        approval_id: approvalId,
      });
    }
    return projectId;
  }

  /**
   * EP-QST-01 — 질문 목록(프로젝트 소속). 기본은 `open` 이다.
   *
   * **어휘 판정이 여기 있다**(REQ-API-126). 예전에는 표면이 `status === 'answered' ? … : 'open'`
   * 로 접어, `?status=cancelled` 가 **열린 질문 목록을 200 으로** 돌려줬다 — REQ-API-109 가
   * 만든 상태를 조회할 길이 없으면서 물어본 쪽은 걸러진 목록이라고 믿는다.
   * 시그니처를 `string` 으로 넓히는 것이 요점이다: 리터럴 유니온은 컴파일러를 막지
   * **호출자(HTTP·MCP)를 막지 않는다.**
   */
  async questions(input: {
    projectId: string;
    status?: string | null;
  }): Promise<Record<string, unknown>[]> {
    const status = assertVocab(
      [input.status ?? 'open'],
      questionStatus.enumValues,
      'status',
    )[0] as string;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT q.id, q.title, q.body_md, q.options, q.urgency::text AS urgency,
             q.status::text AS status, q.answer_key, q.answer_md, q.asked_at, q.answered_at,
             se.hostname, se.agent_type::text AS agent_type, se.external_session_id,
             u.display_name AS asked_by, t.key AS task_key, s.key AS spec_key,
             q.finding_id, q.escalate::text AS escalate,
             extract(epoch FROM (now() - q.asked_at))::int AS waiting_seconds
        FROM question q
        JOIN agent_session se ON se.id = q.agent_session_id
        JOIN "user" u ON u.id = se.user_id
   LEFT JOIN task t ON t.id = q.task_id
   LEFT JOIN spec s ON s.id = q.spec_id
       WHERE q.project_id = ${input.projectId} AND q.status = ${status}::question_status
       ORDER BY q.asked_at DESC
    `);
    return rows;
  }

  /**
   * EP-APR-03 결정 — **사람 전용**이다.
   *
   * stale 승인 차단이 여기 있다: 카드를 연 시점의 content_hash 를 함께 받아 결정 시점의 것과
   * 비교한다. 다르면 거부한다 — 사람이 본 것과 승인되는 것이 달라지는 순간이 승인 게이트가
   * 형식이 되는 지점이다(승인 만료 윈도우·스테일 승인 거부 — agent-integration §2.2 근거).
   */
  async decide(input: {
    /** 사람 전용 게이트의 축 — 판정은 표면이 아니라 여기다(D-05 · REQ-API-111) */
    actor: Actor;
    projectId: string;
    approvalId: string;
    userId: string;
    decision: ApprovalDecision;
    comment?: string;
    /** 카드를 연 시점의 내용 지문. 없으면 검사하지 않는다(코멘트 결정 등) */
    seenContentHash?: string | null;
    /**
     * 일괄의 한 건인가(EP-APR-06). **감사가 셀 수 있어야 하는 사실**이라 결정 이벤트에 싣는다 —
     * 일괄 승인은 본문을 열지 않고 누르는 조작이고, 그것이 얼마나 일어나는지 셀 수 없으면
     * 반사적 승인(OWASP ASI09 가 지목한 consent fatigue)은 감사에서 단건과 구별되지 않는다.
     */
    batchId?: string;
  }): Promise<{
    decision: ApprovalDecision;
    subject_type: string;
    subject_id: string;
    /** 정족수 — 스펙 승인에만 있다. `satisfied: false` 면 **아직 확정이 아니다** */
    quorum?: { given: number; required: number; satisfied: boolean };
  }> {
    // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
    const decision = assertVocab([input.decision], approvalDecision.enumValues, 'decision')[0];
    assertHuman(input.actor, 'inbox_decide', '/inbox');
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        id: string;
        subject_type: string;
        subject_id: string;
        requested_by_user_id: string;
        requested_by_session_id: string | null;
        assignee_user_id: string | null;
        assignee_role: string | null;
        decision: string | null;
        content_hash: string | null;
        author_user_id: string | null;
        author_owner_user_id: string | null;
        subject_status: string | null;
        submitted_at: string | null;
      }>(sql`
        SELECT a.id, a.subject_type::text AS subject_type, a.subject_id,
               a.requested_by_user_id, a.requested_by_session_id,
               a.assignee_user_id, a.assignee_role::text AS assignee_role,
               a.decision::text AS decision,
               encode(sv.content_hash, 'hex') AS content_hash,
               sv.author_user_id, owner.user_id AS author_owner_user_id,
               sv.status::text AS subject_status, sv.submitted_at::text AS submitted_at
          FROM approval a
     LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
     LEFT JOIN agent_session owner ON owner.id = sv.author_session_id
         WHERE a.id = ${input.approvalId} AND a.project_id = ${input.projectId}
         FOR UPDATE OF a
      `);
      const approval = rows[0];
      if (approval === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.not_found'), {
          kind: 'not_found',
        });
      }
      // **이 결재를 내릴 수 있는 사람인가**(EP-APR-03 "지정 승인자·해당 역할 큐").
      //
      // 예전에는 이 문이 "사람인가" 하나였다 — 전역 경로(`/api/v1/approvals/...`)라
      // 프로젝트 가드가 소속을 채우지 않고 지나가고, 서비스는 멤버십만 확인했다.
      // 그래서 `viewer` 도 스펙 승인을 확정할 수 있었다(그 다음은 문서가 approved 다).
      await this.assertMayDecide(
        input.projectId,
        input.userId,
        approval.assignee_user_id,
        approval.assignee_role,
      );

      if (approval.decision !== null) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.already_decided'), {
          kind: 'already_decided',
          decision: approval.decision,
        });
      }

      // stale 승인 차단 — 사람이 본 것과 승인되는 것이 같아야 한다
      if (
        input.seenContentHash != null &&
        approval.content_hash !== null &&
        input.seenContentHash !== approval.content_hash
      ) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.content_changed'), {
          kind: 'stale_approval',
          seen: input.seenContentHash,
          current: approval.content_hash,
        });
      }

      // **지시자≠승인자는 세 축이다**(2026-09-07 · REQ-API-136 · spec-workflow §2.3).
      //
      // 요청자만 비교하던 동안 구멍이 하나 있었다: 작성자가 남에게 제출을 부탁하면 요청자는
      // 그 남이 되고, 작성자는 자기 초안을 자기 손으로 승인할 수 있었다. 에이전트가 쓴
      // 초안도 같다 — 그 세션의 소유자가 승인하면 사람이 검토한 것이 아니라 자기가 시킨
      // 것을 자기가 통과시킨 것이다(D-01 이 막으려는 바로 그것).
      //
      // approve 에만 적용한다 — 코멘트·거절은 요청자도 작성자도 할 수 있다.
      const selfKind = selfKindOf(approval, input.userId);
      if (input.decision === 'approve' && selfKind !== null) {
        await this.assertSelfApprovalAllowed(tx, input.projectId, input.userId, approval, selfKind);
      }
      const selfApprove = selfKind !== null && input.decision === 'approve';

      // **한 사람은 한 번**(2026-09-07 · REQ-API-140). 정족수가 "서로 다른 사용자 2인" 인데
      // 같은 사람이 슬롯 둘을 채우면 그 게이트는 이름만 남는다. 라운드 경계는
      // `submitted_at` 이라, 거절 뒤 다시 제출하면 옛 승인은 세지 않는다.
      if (input.decision === 'approve') {
        const { rows: mine } = await tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM approval prev
           WHERE prev.subject_type = ${approval.subject_type}
             AND prev.subject_id = ${approval.subject_id}
             AND prev.decision = 'approve' AND prev.decided_by_user_id = ${input.userId}
             AND NOT prev.is_bypass
             AND (${approval.submitted_at}::timestamptz IS NULL
                  OR prev.decided_at >= ${approval.submitted_at}::timestamptz)
        `);
        if ((mine[0]?.n ?? 0) > 0) {
          throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.approval.already_approved'), {
            kind: 'already_approved',
            subject_id: approval.subject_id,
          });
        }
      }

      await tx.execute(sql`
        UPDATE approval
           SET decision = ${decision}::approval_decision,
               comment_md = ${input.comment ?? null},
               decided_at = now(),
               assignee_user_id = COALESCE(assignee_user_id, ${input.userId}),
               -- **누른 사람은 여기 남는다**(2026-09-24 · 마이그레이션 0029). 바로 위의
               -- assignee_user_id 로 겸할 수 없다: 지정 카드를 admin 이 대신 결정하면
               -- COALESCE 가 지정된 사람을 지키므로 그 열은 **결정자가 아닌 사람**을
               -- 가리킨 채 남는다. 처리됨 탭이 그 열을 읽는 동안 admin 은 자기가 내린
               -- 결정을 못 보고, 지정된 사람은 자기가 내리지 않은 결정을 봤다.
               decided_by_user_id = ${input.userId}
         WHERE id = ${input.approvalId}
      `);

      // **결정은 대상을 움직여야 한다**(2026-08-31 — 사람 보고 · REQ-API-063).
      //
      // 예전에는 여기서 결재 행만 고치고 끝냈다. 그래서 받은편지함에서 스펙을 거절하면
      // 결재는 사라지는데(`decision IS NOT NULL`) **문서는 `in_review` 에 갇혔다** —
      // 가변 구간은 draft 하나뿐이라(D-02) 고칠 수도, 다시 제출할 수도 없는 상태다.
      // 실측(sudoku 2026-08-31): 거절 2건, 둘 다 `in_review` 로 남아 있었다.
      //
      // **같은 트랜잭션이다.** 웹이 두 번 부르게 하면 그 사이의 실패가 정확히 이 상태를
      // 다시 만들고, 판정이 표면으로 새어 나간다(D-05).
      const quorum = await this.applyToSubject(tx, emit, input, approval);

      // **결정을 요청한 세션에게 돌려준다**(2026-09-07 · REQ-API-133 · FR-11).
      //
      // 이 자리는 오래 결재 행만 고쳤다. 그래서 A3 승인을 기다리는 에이전트는 승인이 나도
      // **영영 듣지 못했다** — 서버→세션 방향의 보장 채널은 하트비트 하나인데(§2.4) 결재
      // 결정이 거기 실리지 않았기 때문이다. 실데이터 결재 11건 중 4건이 세션 기원이었다.
      //
      // 깨우는 조건이 둘 더 있다: **다른 대기 사유가 남아 있으면 깨우지 않는다.** 열린
      // blocking 질문이나 아직 결정되지 않은 다른 결재가 있으면 그 세션은 여전히 사람을
      // 기다리는 중이고, 여기서 `active` 로 돌려놓으면 S5 는 일하고 있는 세션으로 그린다.
      if (approval.requested_by_session_id !== null) {
        await tx.execute(sql`
          UPDATE agent_session SET state = 'active'
           WHERE id = ${approval.requested_by_session_id}
             AND state = 'awaiting_input'
             AND NOT EXISTS (
               SELECT 1 FROM question q
                WHERE q.agent_session_id = ${approval.requested_by_session_id}
                  AND q.status = 'open' AND q.urgency = 'blocking'
             )
             AND NOT EXISTS (
               SELECT 1 FROM approval a2
                WHERE a2.requested_by_session_id = ${approval.requested_by_session_id}
                  AND a2.id <> ${input.approvalId} AND a2.decision IS NULL
                  -- **닫힌 라운드의 형제 슬롯은 기다림이 아니다**(2026-09-26). T3 의 한 슬롯이 거절되면 문서는
                  -- 초안으로 가고 다른 슬롯은 결정 없이 남는다 — 그 슬롯이 세션을 붙잡아 거절을 받고도
                  -- awaiting_input 에 머물렀다. 문서가 검토 중이 아닌 스펙 슬롯은 세지 않는다
                  AND NOT EXISTS (
                    SELECT 1 FROM spec_version sv2
                     WHERE a2.subject_type = 'spec_version' AND sv2.id = a2.subject_id
                       AND sv2.status <> 'in_review'
                  )
             )
        `);
      }

      // 요청의 그림자 알림을 함께 닫는다 — 받은 요청 배지만 줄고 알림 배지는 남던 자리(REQ-API-176)
      await closeRequestNotifications(tx, 'approval', input.approvalId);

      await emit({
        // **결재는 결재다**(2026-09-07 · REQ-API-128). 대상이 질문이든 스펙이든 이 자리가
        // 남기는 사실은 "결재가 결정됐다" 이고, 질문에 답한 사실은 `QuestionService` 가
        // 자기 자리에서 남긴다 — 하나의 이름이 둘을 가리키면 어느 쪽도 셀 수 없다.
        type: NERV_EVENT.APPROVAL_DECIDED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: input.approvalId,
        actorUserId: input.userId,
        isAgent: false,
        toState: input.decision,
        // **자기 승인은 그 사실을 남긴다.** 규칙의 예외를 허용하는 것과 그것을 감추는 것은
        // 다른 일이다 — 감사가 나중에 "이 결재는 한 사람이 양쪽에 섰다" 를 셀 수 있어야 한다.
        payload: {
          decision: input.decision,
          subject_type: approval.subject_type,
          subject_id: approval.subject_id,
          ...(selfApprove ? { self_approved: true, self_kind: selfKind } : {}),
          ...(input.batchId === undefined ? {} : { bulk: true, batch_id: input.batchId }),
        },
      });

      return {
        decision: input.decision,
        subject_type: approval.subject_type,
        subject_id: approval.subject_id,
        ...(quorum === null ? {} : { quorum }),
      };
    });
  }

  /**
   * EP-APR-06 — **일괄 결정**(2026-09-22 · REQ-API-162~164 · 사람 결정).
   *
   * **판정을 두 벌로 만들지 않는다**(D-05). 이 메서드가 하는 일은 자격을 한 번 묻고
   * `decide()` 를 건마다 그대로 부르는 것뿐이다 — 지시자≠승인자·정족수·역할 큐·stale
   * 차단은 전부 그 안에 있고, 여기서 다시 판정하면 언젠가 한쪽만 고쳐진다.
   *
   * 규율 넷:
   *   ① **건마다 제 트랜잭션.** 한 건의 실패가 나머지를 되돌리면 안 된다. 그래서 일괄의
   *      응답은 "성공/실패" 가 아니라 **항목별 결과**이고, 200 이 전부 성공을 뜻하지 않는다.
   *   ② **순차로 돈다.** 같은 대상의 슬롯이 섞여 들어오면 병렬은 `FOR UPDATE` 로 서로를
   *      기다린다. 상한(`BULK_DECISION_LIMIT`)이 그 시간을 잡는다.
   *   ③ **`seen_content_hash` 는 건마다 간다.** 일괄이 이 검사를 건너뛰면 일괄 승인은
   *      stale 승인 차단(OWASP ASI09 방어)의 구멍이 된다.
   *   ④ **승인·거절만이다.** 화면이 내는 조작이 그 둘이고, 일괄 `comment` 는 아무도
   *      요청하지 않은 셋째 경로다(그것도 카드를 대기에서 치운다).
   */
  async decideBulk(input: {
    actor: Actor;
    userId: string;
    decision: ApprovalDecision;
    comment?: string;
    items: { id: string; seenContentHash?: string | null }[];
  }): Promise<{
    ok: true;
    batch_id: string;
    decided: number;
    failed: number;
    results: BulkDecisionResult[];
  }> {
    // 어휘의 정본은 `approval_decision` 이고, 일괄은 **그중 둘**이다(위 규율 ④).
    const decision = assertVocab([input.decision], BULK_DECISIONS, 'decision')[0] as
      'approve' | 'reject';
    assertHuman(input.actor, 'inbox_decide', '/inbox');

    // **못 생긴 id 하나가 배치를 죽이지 않게.** uuid 가 아닌 값을 그대로 넘기면 Postgres 가
    // 22P02 로 질의 전체를 거절한다 — 그 한 건만 `not_found` 로 떨어뜨리고 나머지는 돈다.
    const isUuid = (v: string): boolean =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const ids = [...new Set(input.items.map((item) => item.id))].filter(isUuid);

    // 자격은 **목록과 같은 식**으로 한 번에 묻는다(`canBulkApproveSql`). 멤버십 조건도
    // `detail()` 과 같다 — 못 보는 프로젝트의 결재는 여기서도 없는 것이다.
    const eligible = new Map<string, { projectId: string; canBulk: boolean; reason: string }>();
    if (ids.length > 0) {
      const { rows } = await this.db.execute<{
        id: string;
        project_id: string;
        can_bulk_approve: boolean;
        bulk_block_reason: string | null;
      }>(sql`
        SELECT a.id, a.project_id,
               ${canBulkApproveSql(input.userId)},
               ${bulkBlockReasonSql(input.userId)}
          FROM approval a
     LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
     LEFT JOIN agent_session owner ON owner.id = sv.author_session_id
         WHERE a.id IN (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
           AND EXISTS (
             SELECT 1 FROM membership m
              JOIN project p ON p.id = a.project_id
              WHERE m.user_id = ${input.userId} AND m.org_id = p.org_id
                AND (m.project_id IS NULL OR m.project_id = p.id)
           )
      `);
      for (const row of rows)
        eligible.set(row.id, {
          projectId: row.project_id,
          canBulk: row.can_bulk_approve,
          reason: row.bulk_block_reason ?? 'bulk_not_eligible',
        });
    }

    const batchId = newId();
    const results: BulkDecisionResult[] = [];
    for (const item of input.items) {
      const row = eligible.get(item.id);
      if (row === undefined) {
        results.push({
          id: item.id,
          ok: false,
          code: NERV_ERROR.PRECONDITION,
          kind: 'not_found',
          descriptor: msg('error.approval.not_found'),
        });
        continue;
      }
      // **거절은 일괄 자격을 묻지 않는다.** 서버가 막는 것은 승인뿐이고(EP-APR-03),
      // 저위험 조건은 "본문을 안 읽고 통과시키는" 승인에만 뜻이 있다. 거절은 문서를
      // 되돌리는 쪽이라 같은 위험을 만들지 않는다.
      if (decision === 'approve' && !row.canBulk) {
        results.push({
          id: item.id,
          ok: false,
          code: NERV_ERROR.FORBIDDEN,
          kind: row.reason,
          descriptor: msg('error.approval.bulk_not_eligible'),
        });
        continue;
      }
      try {
        const decided = await this.decide({
          actor: input.actor,
          projectId: row.projectId,
          approvalId: item.id,
          userId: input.userId,
          decision,
          batchId,
          ...(input.comment === undefined ? {} : { comment: input.comment }),
          ...(item.seenContentHash == null ? {} : { seenContentHash: item.seenContentHash }),
        });
        results.push({
          id: item.id,
          ok: true,
          ...(decided.quorum === undefined ? {} : { quorum: decided.quorum }),
        });
      } catch (error) {
        if (!(error instanceof NervError)) throw error;
        results.push({
          id: item.id,
          ok: false,
          code: error.code,
          kind: typeof error.details['kind'] === 'string' ? error.details['kind'] : null,
          descriptor: error.descriptor,
        });
      }
    }

    const decided = results.filter((r) => r.ok).length;
    // **일괄이 일어났다는 사실 자체를 남긴다.** 건별 이벤트에도 `batch_id` 가 붙지만,
    // 전부 실패한 배치는 건별 이벤트가 하나도 없어 감사에서 사라진다 — 반사적 승인을
    // 세려면 "몇 건을 한 번에 눌렀나" 가 성공 여부와 별개로 남아야 한다.
    this.logger.log(
      `일괄 결정 ${batchId} — ${decision} ${decided}/${results.length} (user ${input.userId})`,
    );
    return {
      ok: true,
      batch_id: batchId,
      decided,
      failed: results.length - decided,
      results,
    };
  }

  /**
   * **하트비트 역채널에 실을 결재 결정**(2026-09-07 · REQ-API-133).
   *
   * 질문 답변과 같은 창(1시간)·같은 상한(10건)이고, 같은 규율이다: **전달로 소멸하지
   * 않는다.** 하트비트는 유실될 수 있는 호출이라 한 번 실어 보내고 지우면 그 결정은
   * 아무도 모르는 결정이 된다 — 창이 닫힐 때까지 매번 다시 싣고, 중복 처리는 에이전트가
   * 멱등으로 감당한다(`question_answered` 가 이미 그 규약이다).
   *
   * 이 채널이 없던 동안 `NERV_APPROVAL_REQUIRED` 는 "하트비트로 확인하라" 는 다음 행동을
   * 주면서 정작 하트비트에 그 결과를 싣지 않았다 — 있는 것처럼 말하는 채널이 없는 채널보다
   * 나쁘다.
   */
  async pendingDecisionsFor(sessionId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT 'approval_decided' AS kind, a.id AS approval_id,
             a.subject_type::text AS subject_type, a.subject_id,
             a.decision::text AS decision, a.comment_md,
             a.decided_at::text AS decided_at, u.display_name AS decided_by,
             COALESCE(s.key, t.key, f.title) AS subject_key
        FROM approval a
   -- 결정자는 **누른 사람**이다(2026-09-26) — 지정자로 읽던 동안 admin 이 대신 결정한 카드는 에이전트에게
   -- 지정자의 이름으로 갔다
   LEFT JOIN "user" u ON u.id = COALESCE(a.decided_by_user_id, a.assignee_user_id)
   LEFT JOIN spec_version sv ON sv.id = a.subject_id AND a.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN task t ON t.id = a.subject_id AND a.subject_type = 'plan'
   LEFT JOIN finding f ON f.id = a.subject_id AND a.subject_type = 'finding'
       WHERE a.requested_by_session_id = ${sessionId}
         AND a.decision IS NOT NULL
         AND a.decided_at > now() - interval '1 hour'
       ORDER BY a.decided_at DESC LIMIT 10
    `);
    return rows;
  }

  /**
   * EP-APR-04 게이트 면제 — **면제도 결재 레코드다**(FR-10).
   * 사유가 없으면 CHECK 가 막는다(4.3 §2.8). 기록되지 않는 면제는 면제가 아니라 구멍이다.
   *
   * **사람 전용이고 판정은 여기다**(REQ-API-123). 역할 문턱(`@RequireRole`)만으로는 막히지
   * 않는다 — PAT 도 소유자의 멤버십 역할로 그 문턱을 지난다(`project-access.guard.ts`).
   * 게이트가 사유 검사보다 앞이라 에이전트 호출은 DB 를 한 번도 건드리지 않는다.
   */
  async bypass(input: {
    projectId: string;
    subjectType: 'spec_version' | 'change_request' | 'plan' | 'question' | 'gate_bypass';
    subjectId: string;
    userId: string;
    reason: string;
    actor: Actor;
  }): Promise<{ approval_id: string }> {
    assertHuman(input.actor, 'bypass');
    if (input.reason.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.approval.waiver_reason_required'), {
        kind: 'bypass_reason_required',
      });
    }
    return this.events.transact(async (tx, emit) => {
      const approvalId = newId();
      await tx.execute(sql`
        INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                              decision, decided_at, decided_by_user_id, is_bypass, bypass_reason)
        VALUES (${approvalId}, ${input.projectId}, ${input.subjectType}::approval_subject_type,
                -- 면제는 **낸 사람이 곧 결정한 사람**이다 — 묻지 않고 지나가는 것이 면제다
                ${input.subjectId}, ${input.userId}, 'approve', now(), ${input.userId},
                true, ${input.reason})
      `);
      await emit({
        type: NERV_EVENT.GATE_BYPASSED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: approvalId,
        actorUserId: input.userId,
        isAgent: input.actor.isAgent,
        payload: { reason: input.reason },
      });
      return { approval_id: approvalId };
    });
  }

  /** 승인 요청 생성 — SpecService 가 부르는 것과 같은 재사용 규칙을 쓴다. */
  async request(input: {
    projectId: string;
    subjectType: 'spec_version' | 'change_request' | 'plan' | 'question';
    subjectId: string;
    requestedByUserId: string;
    /**
     * **누가 기다리고 있는가**(2026-09-07 · REQ-API-133). 이 값이 비어 있으면 결정이 나도
     * 돌려줄 곳이 없다 — 하트비트 역채널은 이 열로 수신자를 찾는다.
     */
    requestedBySessionId?: string | null;
    assigneeUserId?: string | null;
    /**
     * **직군 슬롯**(2026-09-07 · REQ-API-138). 매트릭스의 ○ 는 "지정 시" 라는 뜻이고 이 열이
     * 그 지정이다 — 이 값이 있으면 그 역할(과 admin)만 이 카드를 내린다.
     */
    assigneeRole?: string | null;
  }): Promise<{ approval_id: string; reused: boolean }> {
    return this.events.transact(async (tx, emit) => {
      const { rows: existing } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM approval
         WHERE project_id = ${input.projectId} AND subject_type = ${input.subjectType}::approval_subject_type
           AND subject_id = ${input.subjectId} AND decision IS NULL
      `);
      const found = existing[0]?.id;
      if (found !== undefined) return { approval_id: found, reused: true };

      const approvalId = newId();
      await tx.execute(sql`
        INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                              requested_by_session_id, assignee_user_id, assignee_role)
        VALUES (${approvalId}, ${input.projectId}, ${input.subjectType}::approval_subject_type,
                ${input.subjectId}, ${input.requestedByUserId},
                ${input.requestedBySessionId ?? null}, ${input.assigneeUserId ?? null},
                ${input.assigneeRole ?? null}::member_role)
      `);
      await emit({
        type: NERV_EVENT.APPROVAL_REQUESTED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: approvalId,
        actorUserId: input.requestedByUserId,
        isAgent: false,
      });
      return { approval_id: approvalId, reused: false };
    });
  }

  /** 콘텐츠 지문 — 카드가 보여준 것과 승인되는 것이 같은지 판정하는 축이다. */
  static hashOf(body: string): string {
    return createHash('sha256').update(body, 'utf8').digest('hex');
  }

  /**
   * 자기가 요청한 결재를 자기가 승인할 수 있는가 — **두 가지 완화**가 있다.
   *
   * ① **소규모**: 프로젝트에 사람이 하나뿐이면 규칙이 성립하지 않는다. 둘째 사람이 없는데
   *    "둘째 사람이 승인하라" 는 것은 요구가 아니라 막다른 길이다.
   * ② **admin**(2026-08-30 — 사람 결정): 조직·프로젝트를 책임지는 사람은 자기 요청을
   *    스스로 결재할 수 있다. 지시자≠승인자 규칙이 막으려는 것은 **에이전트가 자기 산출물을
   *    통과시키는 것**이고(D-01), 사람 admin 이 자기 판단에 서명하는 것은 다른 일이다 —
   *    admin 이 없으면 그 프로젝트의 어떤 결재도 끝나지 않는 상황이 생긴다.
   *
   * 둘 다 **감사에 남는다**: 이벤트 페이로드의 `self_approved` 가 그 자리다.
   * 예외를 허용하는 것과 그것을 감추는 것은 다른 일이다.
   */
  private async assertSelfApprovalAllowed(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    projectId: string,
    userId: string,
    approval: { requested_by_user_id: string; author_user_id: string | null },
    selfKind: 'requester' | 'author' | 'session_owner',
  ): Promise<void> {
    // **소규모 완화의 축은 멤버 수가 아니라 승인 가능한 사람 수다**(2026-09-07 · §2.3 문장
    // 그대로: "승인 가능한 다른 역할이 없으면 자동 완화"). 멤버를 세면 viewer 다섯이 있는
    // 프로젝트에서 완화가 꺼지고, 그 다섯 중 누구도 결재를 내릴 수 없어 문서가 갇힌다.
    // 조직 단위 멤버십은 **그 조직의 것만** 센다(REQ-API-125).
    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT m.user_id)::int AS n FROM membership m
        JOIN project p ON p.id = ${projectId}
       WHERE m.org_id = p.org_id
         AND (m.project_id = p.id OR m.project_id IS NULL)
         AND m.role::text IN (${sql.join(
           DECIDER_ROLES.map((r) => sql`${r}`),
           sql`, `,
         )})
         AND m.user_id <> ${userId}
         AND m.user_id <> ${approval.requested_by_user_id}
         AND (${approval.author_user_id}::uuid IS NULL OR m.user_id <> ${approval.author_user_id})
    `);
    if ((rows[0]?.n ?? 0) === 0) {
      this.logger.warn(`소규모 완화 — 자기 승인을 허용한다(감사 기록됨) user=${userId}`);
      return;
    }

    // 프로젝트 멤버십과 **조직 단위 멤버십**을 함께 본다 — 조직 admin 만 가진 사람은
    // 프로젝트 행이 없어서 한 행 판정에서는 아무 역할도 없는 사람이 된다(2026-08-24 와 같은 함정).
    const { rows: admin } = await tx.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM membership
       WHERE user_id = ${userId} AND role = 'admin'
         AND (project_id = ${projectId}
              OR (project_id IS NULL
                  AND org_id = (SELECT org_id FROM project WHERE id = ${projectId})))
       LIMIT 1
    `);
    if (admin[0]?.ok === true) {
      this.logger.warn(`admin 자기 승인 — 허용한다(감사 기록됨) user=${userId}`);
      return;
    }

    // 축마다 다른 문장을 준다 — "요청자는 승인할 수 없습니다" 를 작성자에게 보이면
    // 그 사람은 자기가 요청하지 않았다는 것을 알기 때문에 화면이 틀렸다고 읽는다.
    const key =
      selfKind === 'author'
        ? 'error.auth.self_approve_author'
        : selfKind === 'session_owner'
          ? 'error.auth.self_approve_session_owner'
          : 'error.auth.self_approve';
    throw new NervError(NERV_ERROR.FORBIDDEN, msg(key), {
      kind: 'self_approval',
      self_kind: selfKind,
      // 막다른 길에 세우지 않는다 — 누가 할 수 있는지 말한다
      allowed_roles: DECIDER_ROLES,
    });
  }
}
