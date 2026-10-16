// 변경 요청(CR) — 승인본 위의 초안을 감싼 제안 (2026-10-16 · 사람 결정 D1 · D2)
//   정본: spec-workflow §3.1~3.5 · data-model §2.3 · api.md §2.2d(EP-CR-01~04) · EP-SPEC-31 · REQ-API-327 ~ 331
//
// **결재는 지금처럼 스펙 버전이 받는다.** 승인 판정의 진실은 SpecVersion 이고(§3.5), 게이트 로직(티어 · 정족수 · 만료 ·
// 바로 승인 · 일괄 승인)을 CR 에 한 벌 더 만들지 않는다. CR 이 드는 것은 그 초안이 **무엇을 바꾸려는 제안인지**와 그 제안의
// 진행이다 — 열림 → 검토 중 → 승인 · 거절 · 철회.
//
// 전이는 두 갈래다.
//   - **문서 축을 따라 움직이는 것**(열림 · 검토 중 · 다시 열림 · 승인) — SpecService 가 같은 트랜잭션에서 아래 훅을 부른다.
//     문서 축의 전이가 일어나는 자리는 그대로이고, CR 은 그 거울이다.
//   - **CR 만의 행위**(거절 · 철회) — 이 서비스의 표면이다. 둘 다 초안을 버린다(`discarded`) — 초안이 남으면 다음 저장에서
//     CR 이 다시 열리고, "이 제안은 하지 않는다" 가 사실이 되지 못한다.
//
// 영향 미리보기(§3.3)도 여기 한 곳이다 — CR 상세 · 받은 요청의 CR 카드 · EP-SPEC-31 이 같은 함수를 부르고, 승인되는 순간
// 고른 제안을 할 때도 같은 함수로 다시 센다. 미리보기와 승인 때의 판정이 두 벌이면 "보여 준 것과 한 것" 이 갈라진다.

import { Injectable } from '@nestjs/common';
import {
  CR_REJECT_ROLES,
  msg,
  NERV_ERROR,
  NERV_EVENT,
  NERV_EVENT_PHASE2,
  newId,
  requirementsOf,
  text,
} from '@nerv/schema';
import type { CrActions } from '@nerv/schema';
import { displayKey } from '@nerv/schema/keys';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { entityRef } from '../../common/entity-ref.js';
import { sqlArray } from '../../common/sql-array.js';
import { assertHuman } from '../../common/human-only.js';
import type { Actor } from '../../common/human-only.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertVocab } from '../../common/query-vocab.js';
import { EventService } from '../event/event.service.js';
import type { EventInput } from '../event/event.service.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];
type Db = Tx | NervDb;
/** 트랜잭션 안의 이벤트 예약 — 부르는 쪽마다 반환 타입이 조금 다르다(봉투 · unknown). 여기서는 반환을 쓰지 않는다 */
type EmitFn = (input: EventInput) => Promise<unknown>;
/** 고른 제안의 한 모양 — 빠진 칸이 없다 */
type PlannedActions = { derive: string[]; reverify: string[]; cancel: string[] };

/** CR 상태 — 어휘의 정본은 enum `change_request_status` 다 */
const CR_STATUSES = ['open', 'in_review', 'approved', 'rejected', 'withdrawn'] as const;

/** 파생 작업 제목의 상한 — 목록 한 줄에 들어가는 길이(작업 제목에 따로 상한은 없다) */
const DERIVED_TITLE_MAX = 120;

/** 작업이 이 CR 의 승인으로 받는 일 — 미리보기와 승인이 같은 판정을 쓴다 */
export type TaskEffect = 'rebrief' | 'reverify' | 'cancel' | 'stop' | 'none';

interface ImpactTaskRow extends Record<string, unknown> {
  id: string;
  key: string;
  title: string;
  status: string;
  requirement_ref: string | null;
  source_spec_version_id: string | null;
  baseline_id: string | null;
  claim_id: string | null;
  claim_user_id: string | null;
  claim_user_name: string | null;
  claim_session_id: string | null;
  hostname: string | null;
  agent_type: string | null;
}

/** 영향 미리보기(EP-SPEC-31 · CR 상세) — 승인 전에 세 축이 어떻게 움직일지 */
export interface SpecImpact extends Record<string, unknown> {
  spec_key: string;
  version_no: number;
  /** 견준 승인본의 번호 — 승인본이 없는 첫 초안이면 null(그때는 전부 더해진 것이다) */
  base_version_no: number | null;
  delta: {
    added: { ref: string; statement: string }[];
    modified: { ref: string; before: string; after: string }[];
    removed: { ref: string; statement: string }[];
  };
  tasks: {
    key: string;
    title: string;
    status: string;
    requirement_ref: string | null;
    effect: TaskEffect;
    claimed: boolean;
  }[];
  claims: {
    task_key: string;
    requirement_ref: string | null;
    user_id: string;
    user_name: string | null;
    session_id: string | null;
    hostname: string | null;
    agent_type: string | null;
    /** 바뀌거나 빠진 요구사항의 작업인가 — 승인하면 이 세션의 사람에게 critical 알림이 간다 */
    affected: boolean;
  }[];
  referencing: { key: string; title: string; kinds: string[] }[];
  suggestions: {
    derive: { ref: string; statement: string; title: string }[];
    reverify: { ref: string; statement: string; done_tasks: string[] }[];
    cancel: { task_key: string; title: string; ref: string; status: string }[];
  };
  counts: {
    added: number;
    modified: number;
    removed: number;
    tasks: number;
    claims: number;
    affected_claims: number;
    referencing: number;
  };
}

/** 변경 요청 한 줄(EP-CR-01 · 02) — 받은 요청 · 문서 응답이 같은 모양의 일부를 쓴다 */
export interface ChangeRequestRow extends Record<string, unknown> {
  id: string;
  key: string;
  status: string;
}

/** 승인 때 한 일 — `cr.approved` payload 가 든다 */
interface AppliedActions {
  created: { key: string; kind: 'derive' | 'reverify'; ref: string }[];
  archived: string[];
  skipped: { kind: 'derive' | 'reverify' | 'cancel'; value: string }[];
}

/** 게이트 티어 → CR 의 위험도(2026-10-16 · 사람 결정 D1) — 자동 통과(T0 · T1)가 저위험이다(D-06) */
export function riskOfTier(tier: string): 'low' | 'normal' | 'high' {
  if (tier === 'T3') return 'high';
  if (tier === 'T2') return 'normal';
  return 'low';
}

@Injectable()
export class ChangeRequestService {
  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  // ── CR 만의 행위 — 거절 · 철회 ────────────────────────────────────────────────────────

  /**
   * EP-CR-03 — **변경 요청 거절**(2026-10-16 · 사람 결정 D1 · REQ-API-328). planner · admin 이 사람으로만 한다. 사유가
   * 필수다. 그 초안을 버린다(`discarded`) — 문서는 승인본 상태로 돌아가고, 다음 저장은 새 초안 · 새 CR 이다.
   *
   * **검토 중인 CR 은 거절하지 않는다** — 그 초안에는 결재가 걸려 있고, 결재를 두고 초안을 버리면 받은 요청에 대상이 사라진
   * 카드가 남는다. 결재에서 거절하면 초안으로 돌아오고 CR 이 다시 열린다 — 그 뒤에 거절한다.
   */
  async reject(input: {
    projectId: string;
    ref: string;
    actor: Actor;
    roles: readonly string[];
    reason: string;
  }): Promise<Record<string, unknown>> {
    assertHuman(input.actor, 'cr_reject', await crWebUrl(this.db, input.projectId, input.ref));
    if (!input.roles.some((r) => (CR_REJECT_ROLES as readonly string[]).includes(r))) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.cr.reject_role'), {
        kind: 'role_required',
        allowed_roles: CR_REJECT_ROLES,
      });
    }
    return this.close({
      projectId: input.projectId,
      ref: input.ref,
      to: 'rejected',
      userId: input.actor.userId,
      sessionId: null,
      isAgent: false,
      reason: input.reason,
    });
  }

  /**
   * EP-CR-04 — **철회**(REQ-API-328). 그 CR 을 연 사람이나 초안의 작성자가 초안을 스스로 버린다. 역할을 보지 않는다 — 자기
   * 제안을 거두는 일이다. 에이전트 토큰도 그 사람의 것이면 받는다(초안 저장과 같은 권한 `spec:draft`).
   */
  async withdraw(input: {
    projectId: string;
    ref: string;
    userId: string;
    sessionId: string | null;
    isAgent: boolean;
    reason: string | null;
  }): Promise<Record<string, unknown>> {
    return this.close({
      projectId: input.projectId,
      ref: input.ref,
      to: 'withdrawn',
      userId: input.userId,
      sessionId: input.sessionId,
      isAgent: input.isAgent,
      reason: input.reason,
    });
  }

  private close(input: {
    projectId: string;
    ref: string;
    to: 'rejected' | 'withdrawn';
    userId: string;
    sessionId: string | null;
    isAgent: boolean;
    reason: string | null;
  }): Promise<Record<string, unknown>> {
    return this.events.transact(async (tx, emit) => {
      const cr = await this.lockedCr(tx, input.projectId, input.ref);
      if (
        input.to === 'withdrawn' &&
        input.userId !== cr.created_by_user_id &&
        input.userId !== cr.author_user_id
      ) {
        throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.cr.withdraw_not_author'), {
          kind: 'not_author',
          cr: cr.key,
        });
      }
      if (cr.status === 'in_review') {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.cr.in_review'), {
          kind: 'cr_in_review',
          cr: cr.key,
          approval_id: cr.approval_id,
          web_url: await crWebUrl(tx, input.projectId, cr.key),
        });
      }
      if (cr.status !== 'open') {
        throw new NervError(
          NERV_ERROR.PRECONDITION,
          msg('error.cr.not_open', { status: cr.status }),
          {
            kind: 'cr_closed',
            cr: cr.key,
            status: cr.status,
          },
        );
      }
      // **초안을 버린다** — 지우지 않는다. 리스는 초안에만 남을 수 있다(`spec_version_lease_draft_only_ck`) — 함께 비운다
      const { rows: discarded } = await tx.execute<{ id: string }>(sql`
        UPDATE spec_version
           SET status = 'discarded',
               edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
         WHERE id = ${cr.proposed_version_id} AND status = 'draft'
        RETURNING id
      `);
      if (discarded.length === 0) {
        // 열린 CR 의 초안이 초안이 아니다 — 문서 축과 CR 이 어긋났다. 아무것도 바꾸지 않는다
        throw new NervError(
          NERV_ERROR.PRECONDITION,
          msg('error.cr.not_open', { status: cr.version_status }),
          {
            kind: 'cr_closed',
            cr: cr.key,
            status: cr.version_status,
          },
        );
      }
      await tx.execute(sql`
        UPDATE change_request SET status = ${input.to}::change_request_status, decided_at = now()
         WHERE id = ${cr.id}
      `);
      const reason = (input.reason ?? '').trim();
      await emit({
        type:
          input.to === 'rejected' ? NERV_EVENT_PHASE2.CR_REJECTED : NERV_EVENT_PHASE2.CR_WITHDRAWN,
        projectId: input.projectId,
        subjectType: 'change_request',
        subjectId: cr.id,
        subjectKey: cr.key,
        actorUserId: input.userId,
        actorSessionId: input.sessionId,
        isAgent: input.isAgent,
        fromState: 'open',
        toState: input.to,
        payload: {
          spec_id: cr.spec_id,
          spec_key: cr.spec_key,
          spec_version_id: cr.proposed_version_id,
          version_no: Number(cr.version_no),
          discarded: true,
          ...(reason === '' ? {} : { reason }),
          // 알림의 받는 사람 — CR 을 연 사람과 초안의 작성자(행위자는 라우팅이 뺀다)
          notify_user_ids: [...new Set([cr.created_by_user_id, cr.author_user_id])],
        },
      });
      return {
        ...(await this.rowOf(tx, input.projectId, cr.id)),
        discarded_version_no: Number(cr.version_no),
      };
    });
  }

  // ── 읽기 ──────────────────────────────────────────────────────────────────────

  /** EP-CR-01 — 프로젝트의 변경 요청. `status`(쉼표 목록)와 `spec`(키 또는 UUID)으로 좁힌다. 최근에 연 것이 위다 */
  async list(input: {
    projectId: string;
    status?: string | null;
    spec?: string | null;
  }): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const statuses =
      input.status == null || input.status === ''
        ? null
        : assertVocab(
            input.status.split(',').map((s) => s.trim()),
            CR_STATUSES,
            'status',
          );
    const spec = entityRef(input.spec);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      ${this.selectRows()}
       WHERE cr.project_id = ${input.projectId}
         ${statuses === null ? sql`` : sql`AND cr.status::text = ANY(${sqlArray(statuses, 'text')})`}
         ${spec.key !== null ? sql`AND s.key = ${spec.key}` : sql``}
         ${spec.id !== null ? sql`AND s.id = ${spec.id}::uuid` : sql``}
       ORDER BY cr.created_at DESC, cr.id DESC
    `);
    const items = rows.map((row) => this.withUrl(row));
    return { items, total: items.length };
  }

  /** EP-CR-02 — 단건. 키든 UUID 든 받는다(§1.4b). 영향 미리보기를 함께 준다 — CR 상세가 한 번에 그린다 */
  async get(input: { projectId: string; ref: string }): Promise<Record<string, unknown>> {
    const ref = entityRef(input.ref);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      ${this.selectRows()}
       WHERE cr.project_id = ${input.projectId}
         AND ${ref.id !== null ? sql`cr.id = ${ref.id}::uuid` : sql`cr.key = ${ref.key ?? ''}`}
    `);
    const row = rows[0];
    if (row === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.cr.not_found'), {
        kind: 'not_found',
        cr: input.ref,
      });
    }
    const impact = await changeRequestImpact(this.db, {
      projectId: input.projectId,
      specId: String(row['spec_id']),
      baseVersionId: String(row['base_version_id']),
      proposedVersionId: String(row['proposed_version_id']),
    });
    // 승인된 CR 이면 그때 한 일 — 지금 다시 세면 그 뒤에 생긴 작업이 섞인다. 기록은 `cr.approved` 가 든다
    const { rows: outcome } = await this.db.execute<{
      payload: Record<string, unknown> | null;
    }>(sql`
      SELECT payload FROM event
       WHERE project_id = ${input.projectId} AND subject_type = 'change_request'
         AND subject_id = ${String(row['id'])}
         AND type IN (${NERV_EVENT_PHASE2.CR_APPROVED}, ${NERV_EVENT_PHASE2.CR_REJECTED}, ${NERV_EVENT_PHASE2.CR_WITHDRAWN})
       ORDER BY occurred_at DESC LIMIT 1
    `);
    const done = outcome[0]?.payload ?? null;
    return {
      ...this.withUrl(row),
      impact,
      ...(done === null
        ? {}
        : {
            outcome: {
              created_tasks: done['created_tasks'] ?? [],
              archived_tasks: done['archived_tasks'] ?? [],
              skipped: done['skipped'] ?? [],
              reason: done['reason'] ?? null,
            },
          }),
    };
  }

  /**
   * EP-SPEC-31 — **영향 미리보기**(REQ-API-329). 초안 · 검토 중인 버전이 승인되면 세 축이 어떻게 움직일지. CR 이 있으면 그
   * 기준(승인본)과 견주고, 없으면 그 문서의 최신 승인본(없으면 첫 승인 — 전부 더해진 것)과 견준다.
   */
  async impactOfVersion(input: { projectId: string; specVersionId: string }): Promise<SpecImpact> {
    const ref = entityRef(input.specVersionId);
    if (ref.id === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.version_not_found'), {
        kind: 'not_found',
        spec_version_id: input.specVersionId,
      });
    }
    const { rows } = await this.db.execute<{
      id: string;
      spec_id: string;
      base_version_id: string | null;
    }>(sql`
      SELECT sv.id, sv.spec_id,
             coalesce(cr.base_version_id,
                      (SELECT a.id FROM spec_version a
                        WHERE a.spec_id = sv.spec_id AND a.status = 'approved' AND a.id <> sv.id
                        ORDER BY a.version_no DESC LIMIT 1)) AS base_version_id
        FROM spec_version sv
        JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN change_request cr ON cr.proposed_version_id = sv.id
       WHERE s.project_id = ${input.projectId}
         AND sv.id = ${ref.id}::uuid
    `);
    const version = rows[0];
    if (version === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.version_not_found'), {
        kind: 'not_found',
        spec_version_id: input.specVersionId,
      });
    }
    return changeRequestImpact(this.db, {
      projectId: input.projectId,
      specId: version.spec_id,
      baseVersionId: version.base_version_id,
      proposedVersionId: version.id,
    });
  }

  // ── 안쪽 ──────────────────────────────────────────────────────────────────────

  /** 거절 · 철회가 잠그고 읽는 CR 한 줄 */
  private async lockedCr(
    tx: Tx,
    projectId: string,
    refValue: string,
  ): Promise<{
    id: string;
    key: string;
    status: string;
    spec_id: string;
    spec_key: string;
    proposed_version_id: string;
    version_no: number;
    version_status: string;
    created_by_user_id: string;
    author_user_id: string;
    approval_id: string | null;
  }> {
    const ref = entityRef(refValue);
    const { rows } = await tx.execute<{
      id: string;
      key: string;
      status: string;
      spec_id: string;
      spec_key: string;
      proposed_version_id: string;
      version_no: number;
      version_status: string;
      created_by_user_id: string;
      author_user_id: string;
      approval_id: string | null;
    }>(sql`
      SELECT cr.id, cr.key, cr.status::text AS status, cr.spec_id, s.key AS spec_key,
             cr.proposed_version_id, sv.version_no, sv.status::text AS version_status,
             cr.created_by_user_id, sv.author_user_id,
             (SELECT a.id FROM approval a
               WHERE a.subject_type = 'spec_version' AND a.subject_id = sv.id AND a.decision IS NULL
               ORDER BY a.requested_at DESC LIMIT 1) AS approval_id
        FROM change_request cr
        JOIN spec s ON s.id = cr.spec_id
        JOIN spec_version sv ON sv.id = cr.proposed_version_id
       WHERE cr.project_id = ${projectId}
         AND ${ref.id !== null ? sql`cr.id = ${ref.id}::uuid` : sql`cr.key = ${ref.key ?? ''}`}
         FOR UPDATE OF cr, sv
    `);
    const cr = rows[0];
    if (cr === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.cr.not_found'), {
        kind: 'not_found',
        cr: refValue,
      });
    }
    return cr;
  }

  /** 목록 · 단건의 열 — 한 벌이다 */
  private selectRows(): ReturnType<typeof sql> {
    return sql`
      SELECT cr.id, cr.key, cr.status::text AS status, cr.risk::text AS risk, cr.origin::text AS origin,
             cr.title, cr.rationale_md, cr.planned_actions, cr.created_at, cr.decided_at,
             cr.spec_id, s.key AS spec_key, s.title AS spec_title, s.archived_at AS spec_archived_at,
             cr.base_version_id, b.version_no AS base_version_no,
             cr.proposed_version_id, sv.version_no AS proposed_version_no,
             sv.status::text AS proposed_status, encode(sv.content_hash, 'hex') AS content_hash,
             -- 철회할 수 있는 사람 — CR 을 연 사람과 초안의 작성자(화면이 단추를 그릴 때 쓴다 · 판정은 서버다)
             sv.author_user_id,
             cr.created_by_user_id, u.display_name AS created_by_name,
             se.hostname AS created_hostname, se.agent_type::text AS created_agent_type,
             p.slug AS project_slug,
             -- 그 버전의 게이트 티어 — 검토 요청 때 정해진다(초안이면 아직 없다 · REQ-API-290 과 같은 규칙)
             (SELECT e.payload->>'gate_tier' FROM event e
               WHERE e.type = ${NERV_EVENT.SPEC_SUBMITTED} AND e.subject_id = cr.proposed_version_id
                 AND e.payload ? 'gate_tier'
               ORDER BY e.occurred_at DESC LIMIT 1) AS gate_tier,
             -- 그 버전의 대기 결재 — CR 상세의 결재 단추는 이 결재로 간다(같은 결재를 두 곳에 만들지 않는다)
             (SELECT a.id FROM approval a
               WHERE a.subject_type = 'spec_version' AND a.subject_id = cr.proposed_version_id
                 AND a.decision IS NULL
               ORDER BY a.assignee_role NULLS FIRST, a.requested_at, a.id LIMIT 1) AS approval_id
        FROM change_request cr
        JOIN spec s ON s.id = cr.spec_id
        JOIN project p ON p.id = cr.project_id
        JOIN spec_version sv ON sv.id = cr.proposed_version_id
        JOIN spec_version b ON b.id = cr.base_version_id
        JOIN "user" u ON u.id = cr.created_by_user_id
   LEFT JOIN agent_session se ON se.id = cr.created_by_session_id`;
  }

  private async rowOf(tx: Db, projectId: string, id: string): Promise<Record<string, unknown>> {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      ${this.selectRows()}
       WHERE cr.project_id = ${projectId} AND cr.id = ${id}
    `);
    return this.withUrl(rows[0] ?? {});
  }

  private withUrl(row: Record<string, unknown>): Record<string, unknown> {
    const slug = String(row['project_slug'] ?? '');
    const key = String(row['key'] ?? '');
    return {
      ...row,
      planned_actions: normalizeActions((row['planned_actions'] ?? {}) as CrActions),
      web_url: webPath(`/p/${slug}/crs/${key}`),
    };
  }
}

// ── 문서 축을 따라가는 전이와 영향 — SpecService · ApprovalService 가 같은 트랜잭션에서 부른다 ──────────────
//
// 클래스 밖의 함수로 둔다: 트랜잭션과 `emit` 을 받아 그 안에서만 일하고, 부르는 서비스의 생성자를 늘리지 않는다
// (TaskService 의 `recomputeImplStatus` 와 같은 모양이다).

/**
 * **승인본 위에 새 초안이 생겼다 → CR 을 연다**(REQ-API-327). 승인본이 없는 첫 초안은 CR 이 아니다(고칠 약속이 아직 없다).
 * 초안 저장(EP-SPEC-08 · `nerv_spec_draft_upsert`)과 되돌리기(EP-SPEC-30)가 새 초안을 만든 뒤 부른다. 임포트는 부르지
 * 않는다 — 원본의 상태를 그대로 옮기는 우회 경로라 제안이 없다(4.7 §3.4).
 */
export async function openChangeRequestInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    specId: string;
    versionId: string;
    userId: string;
    sessionId: string | null;
    changeSummary: string | null;
  },
): Promise<ChangeRequestRow | null> {
  const { rows: bases } = await tx.execute<{ id: string; version_no: number }>(sql`
    SELECT id, version_no FROM spec_version
     WHERE spec_id = ${input.specId} AND status = 'approved'
     ORDER BY version_no DESC LIMIT 1
  `);
  const base = bases[0];
  if (base === undefined) return null;
  // **진실은 문서 축이다**(§3.5) — 열린 CR 의 초안이 이미 초안 · 검토 중이 아니면(문서 축의 전이를 거치지 않은 길: 임포트 ·
  // 손으로 고친 데이터) 그 CR 을 버전의 상태에 맞춰 닫는다. 맞추지 않으면 "문서마다 열린 CR 하나" 가 새 초안을 막는다
  await tx.execute(sql`
    UPDATE change_request cr
       SET status = CASE WHEN sv.status IN ('approved', 'superseded', 'deprecated')
                         THEN 'approved'::change_request_status
                         ELSE 'withdrawn'::change_request_status END,
           decided_at = coalesce(cr.decided_at, now())
      FROM spec_version sv
     WHERE cr.spec_id = ${input.specId} AND cr.status IN ('open', 'in_review')
       AND sv.id = cr.proposed_version_id AND sv.status NOT IN ('draft', 'in_review')
  `);
  const { rows: specs } = await tx.execute<{
    title: string;
    spec_key: string;
    project_key: string;
  }>(sql`
    SELECT s.title, s.key AS spec_key, p.key AS project_key
      FROM spec s JOIN project p ON p.id = s.project_id
     WHERE s.id = ${input.specId} AND p.id = ${input.projectId}
  `);
  const spec = specs[0];
  if (spec === undefined) return null;
  const { rows: versions } = await tx.execute<{ version_no: number }>(
    sql`SELECT version_no FROM spec_version WHERE id = ${input.versionId}`,
  );
  const id = newId();
  const key = displayKey(spec.project_key, 'C', id);
  const summary = (input.changeSummary ?? '').trim();
  await tx.execute(sql`
    INSERT INTO change_request (id, project_id, spec_id, key, base_version_id, proposed_version_id,
                                title, rationale_md, origin, created_by_user_id, created_by_session_id)
    VALUES (${id}, ${input.projectId}, ${input.specId}, ${key}, ${base.id}, ${input.versionId},
            ${spec.title}, ${summary === '' ? null : summary},
            ${input.sessionId === null ? 'human' : 'agent'}::change_origin,
            ${input.userId}, ${input.sessionId})
  `);
  await tx.execute(
    sql`UPDATE spec_version SET change_request_id = ${id} WHERE id = ${input.versionId}`,
  );
  // **진행 중 클레임 영향**(§6.3 `cr.opened`) — 초안이 지금 바꾸거나 뺀 요구사항의 작업을 쥔 세션의 사람. 열린 뒤 초안이 더
  // 바뀌어도 다시 알리지 않는다 — 승인 때(`cr.approved`) 한 번 더 그때의 델타로 센다
  const impact = await changeRequestImpact(tx, {
    projectId: input.projectId,
    specId: input.specId,
    baseVersionId: base.id,
    proposedVersionId: input.versionId,
  });
  await emit({
    type: NERV_EVENT_PHASE2.CR_OPENED,
    projectId: input.projectId,
    subjectType: 'change_request',
    subjectId: id,
    subjectKey: key,
    actorUserId: input.userId,
    actorSessionId: input.sessionId,
    isAgent: input.sessionId !== null,
    toState: 'open',
    payload: {
      spec_id: input.specId,
      spec_key: spec.spec_key,
      spec_version_id: input.versionId,
      base_version_no: Number(base.version_no),
      version_no: Number(versions[0]?.version_no ?? 0),
      claim_user_ids: affectedClaimUsers(impact),
    },
  });
  return { id, key, status: 'open' };
}

/** 초안의 변경 요약을 CR 의 이유 칸에 맞춘다 — 저장이 요약을 줄 때만(주지 않은 저장은 건드리지 않는다) */
export async function syncChangeRequestRationale(
  tx: Tx,
  versionId: string,
  changeSummary: string | undefined,
): Promise<void> {
  if (changeSummary === undefined) return;
  const summary = changeSummary.trim();
  await tx.execute(sql`
    UPDATE change_request SET rationale_md = ${summary === '' ? null : summary}
     WHERE proposed_version_id = ${versionId} AND status = 'open'
  `);
}

/** **검토 요청 → CR 검토 중**(REQ-API-327) — 위험도를 그 판정의 티어에서 채운다 */
export async function changeRequestSubmittedInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    versionId: string;
    tier: string;
    actor: { userId: string; sessionId: string | null };
  },
): Promise<void> {
  const { rows } = await tx.execute<{ id: string; key: string }>(sql`
    UPDATE change_request SET status = 'in_review', risk = ${riskOfTier(input.tier)}::change_risk
     WHERE proposed_version_id = ${input.versionId} AND status = 'open'
    RETURNING id, key
  `);
  const cr = rows[0];
  if (cr === undefined) return;
  await emit({
    type: NERV_EVENT_PHASE2.CR_SUBMITTED,
    projectId: input.projectId,
    subjectType: 'change_request',
    subjectId: cr.id,
    subjectKey: cr.key,
    actorUserId: input.actor.userId,
    actorSessionId: input.actor.sessionId,
    isAgent: input.actor.sessionId !== null,
    fromState: 'open',
    toState: 'in_review',
    payload: { spec_version_id: input.versionId, gate_tier: input.tier },
  });
}

/**
 * **결재가 초안을 돌려보냈다 → CR 은 다시 열림**(REQ-API-327). 거절 · 코멘트 · 만료 모두 그렇다 — 결재의 거절은 "고쳐서
 * 다시 내라" 이지 "이 제안을 하지 않는다" 가 아니다. 그것은 CR 거절(EP-CR-03)이 따로 한다.
 */
export async function changeRequestReturnedInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    versionId: string;
    cause: 'rejected' | 'comment' | 'expired';
    actorUserId: string | null;
  },
): Promise<void> {
  const { rows } = await tx.execute<{ id: string; key: string }>(sql`
    UPDATE change_request SET status = 'open'
     WHERE proposed_version_id = ${input.versionId} AND status = 'in_review'
    RETURNING id, key
  `);
  const cr = rows[0];
  if (cr === undefined) return;
  await emit({
    type: NERV_EVENT_PHASE2.CR_REOPENED,
    projectId: input.projectId,
    subjectType: 'change_request',
    subjectId: cr.id,
    subjectKey: cr.key,
    actorUserId: input.actorUserId,
    isAgent: false,
    fromState: 'in_review',
    toState: 'open',
    payload: { spec_version_id: input.versionId, cause: input.cause },
  });
}

/**
 * **승인 결정이 고른 제안을 CR 에 남긴다**(REQ-API-330). 정족수가 차기 전의 승인(T3 의 첫 자리)이 고른 것도 남아, 둘째
 * 승인자가 카드에서 그냥 승인하면 그것을 한다. 변경 요청이 없는 결재에 오면 400 이다 — 조용히 버리면 부른 쪽은 작업이
 * 만들어질 줄 안다.
 */
export async function planChangeRequestInTx(
  tx: Tx,
  versionId: string,
  actions: CrActions,
): Promise<void> {
  const planned = normalizeActions(actions);
  const { rows } = await tx.execute<{ id: string }>(sql`
    UPDATE change_request SET planned_actions = ${JSON.stringify(planned)}::jsonb
     WHERE proposed_version_id = ${versionId} AND status IN ('open', 'in_review')
    RETURNING id
  `);
  if (rows.length === 0) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.cr.actions_without_cr'), {
      kind: 'invalid_input',
      field: 'cr_actions',
      reason: 'no_change_request',
    });
  }
}

/**
 * **승인 → 세 축**(spec-workflow §3.3 · REQ-API-330). SpecService 가 버전을 승인본으로 옮기고 요구사항을 맞춘 직후, 이전
 * 승인본의 작업에 재브리핑을 걸기 **전에** 부른다 — 보관한 미착수 작업은 재브리핑을 받지 않고, 새로 만든 작업은 새 승인본을
 * 기준으로 삼는다.
 *
 * 이미 도는 것(대체됨 · 요구사항 묘비 · 진행 중 작업의 재브리핑 · 참조 문서 전파)은 SpecService 가 그대로 하고, 여기서
 * 더하는 것은 넷이다: 고른 파생 작업(ADDED) · 고른 재검증 작업(MODIFIED 의 완료 작업) · 고른 미착수 작업 보관(REMOVED) ·
 * 바뀌거나 빠진 요구사항의 작업을 쥔 세션의 사람에게 critical 알림. 진행 중 작업의 중단 확인은 하트비트가 그 요구사항이
 * 빠졌다는 사실(`requirement_removed`)을 그 세션에 전한다(REQ-API-330).
 */
export async function changeRequestApprovedInTx(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    specId: string;
    versionId: string;
    approverUserId: string | null;
    actor: { userId: string | null; sessionId: string | null; isAgent: boolean };
  },
): Promise<void> {
  const { rows } = await tx.execute<{
    id: string;
    key: string;
    base_version_id: string;
    planned_actions: CrActions | null;
    spec_key: string;
    version_no: number;
    base_version_no: number;
  }>(sql`
    SELECT cr.id, cr.key, cr.base_version_id, cr.planned_actions, s.key AS spec_key,
           sv.version_no, b.version_no AS base_version_no
      FROM change_request cr
      JOIN spec s ON s.id = cr.spec_id
      JOIN spec_version sv ON sv.id = cr.proposed_version_id
      JOIN spec_version b ON b.id = cr.base_version_id
     WHERE cr.proposed_version_id = ${input.versionId} AND cr.status IN ('open', 'in_review')
       FOR UPDATE OF cr
  `);
  const cr = rows[0];
  if (cr === undefined) return;
  const impact = await changeRequestImpact(tx, {
    projectId: input.projectId,
    specId: input.specId,
    baseVersionId: cr.base_version_id,
    proposedVersionId: input.versionId,
  });
  // 행위자가 없으면(사람이 승인하지 않은 자동 통과는 제출한 사람이 있다) 만든 작업은 그 사람의 것이다
  const owner = input.approverUserId ?? input.actor.userId;
  const applied =
    owner === null
      ? { created: [], archived: [], skipped: [] }
      : await applyActions(tx, emit, {
          projectId: input.projectId,
          versionId: input.versionId,
          crKey: cr.key,
          specKey: cr.spec_key,
          versionNo: Number(cr.version_no),
          planned: normalizeActions(cr.planned_actions ?? {}),
          impact,
          userId: owner,
          actor: input.actor,
        });
  await tx.execute(sql`
    UPDATE change_request SET status = 'approved', decided_at = now() WHERE id = ${cr.id}
  `);
  await emit({
    type: NERV_EVENT_PHASE2.CR_APPROVED,
    projectId: input.projectId,
    subjectType: 'change_request',
    subjectId: cr.id,
    subjectKey: cr.key,
    actorUserId: input.actor.userId,
    actorSessionId: input.actor.sessionId,
    isAgent: input.actor.isAgent,
    fromState: 'in_review',
    toState: 'approved',
    payload: {
      spec_id: input.specId,
      spec_key: cr.spec_key,
      spec_version_id: input.versionId,
      version_no: Number(cr.version_no),
      base_version_no: Number(cr.base_version_no),
      delta: {
        added: impact.counts.added,
        modified: impact.counts.modified,
        removed: impact.counts.removed,
      },
      created_tasks: applied.created,
      archived_tasks: applied.archived,
      ...(applied.skipped.length === 0 ? {} : { skipped: applied.skipped }),
      claim_user_ids: affectedClaimUsers(impact),
    },
  });
}

/** 버전을 감싼 CR(있으면) — 문서 응답 · 저장 응답 · 받은 요청 카드가 쓴다 */
export async function changeRequestOfVersion(
  db: Db,
  projectId: string,
  versionId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await db.execute<{ id: string; key: string; status: string }>(sql`
    SELECT cr.id, cr.key, cr.status::text AS status FROM change_request cr
     WHERE cr.project_id = ${projectId} AND cr.proposed_version_id = ${versionId}
  `);
  const cr = rows[0];
  if (cr === undefined) return null;
  return { ...cr, web_url: await crWebUrl(db, projectId, cr.key) };
}

/**
 * 영향 — **미리보기와 승인이 같은 판정을 쓴다**(spec-workflow §3.3). 작업의 몫은 이렇게 정한다:
 *
 * | 요구사항 | 작업 상태 | 몫 |
 * | --- | --- | --- |
 * | 빠짐(REMOVED) | `backlog` · `ready` 이고 쥔 세션이 없다 | `cancel` — 보관 제안 |
 * | 빠짐 | 그 밖(쥐었거나 시작했다 · `done` 제외) | `stop` — 중단 확인(하트비트 `requirement_removed`) |
 * | 바뀜(MODIFIED) | `done` | `reverify` — 재검증 작업 제안 |
 * | 그 밖 | 이전 승인본을 기준으로 한 끝나지 않은 작업(`blocked` · 기준선 작업 제외) | `rebrief` — 승인이 재브리핑을 건다(지금 규칙 그대로) |
 *
 * 클레임은 바뀌거나 빠진 요구사항의 작업(요구사항이 없는 작업은 문서 전체가 대상이라 바뀐 것이 있으면 함께)이면 `affected`
 * 다 — 승인하면 그 세션의 사람에게 critical 알림이 간다.
 */
export async function changeRequestImpact(
  db: Db,
  input: {
    projectId: string;
    specId: string;
    baseVersionId: string | null;
    proposedVersionId: string;
  },
): Promise<SpecImpact> {
  const { rows: heads } = await db.execute<{
    spec_key: string;
    version_no: number;
    body_md: string;
    base_version_no: number | null;
    base_md: string | null;
  }>(sql`
    SELECT s.key AS spec_key, sv.version_no, sv.body_md,
           b.version_no AS base_version_no, b.body_md AS base_md
      FROM spec_version sv
      JOIN spec s ON s.id = sv.spec_id
 LEFT JOIN spec_version b ON b.id = ${input.baseVersionId}
     WHERE sv.id = ${input.proposedVersionId}
  `);
  const head = heads[0];
  const before = requirementsOf(head?.base_md ?? '');
  const after = requirementsOf(head?.body_md ?? '');
  const added: { ref: string; statement: string }[] = [];
  const modified: { ref: string; before: string; after: string }[] = [];
  for (const [ref, statement] of after) {
    const old = before.get(ref);
    if (old === undefined) added.push({ ref, statement });
    else if (old !== statement) modified.push({ ref, before: old, after: statement });
  }
  const removed = [...before]
    .filter(([ref]) => !after.has(ref))
    .map(([ref, statement]) => ({ ref, statement }));
  const byRef = (a: { ref: string }, b: { ref: string }): number => a.ref.localeCompare(b.ref);
  added.sort(byRef);
  modified.sort(byRef);
  removed.sort(byRef);
  const modifiedRefs = new Set(modified.map((m) => m.ref));
  const removedRefs = new Set(removed.map((r) => r.ref));
  const changed = modified.length + removed.length > 0;

  // 이 문서의 작업 — 기준 버전이 이 문서의 것이거나 출처 요구사항이 이 문서의 것. 보관한 작업은 세지 않는다(REQ-API-286)
  const { rows: tasks } = await db.execute<ImpactTaskRow>(sql`
    SELECT t.id, t.key, t.title, t.status::text AS status, r.ref AS requirement_ref,
           t.source_spec_version_id, t.baseline_id,
           c.id AS claim_id, c.user_id AS claim_user_id, u.display_name AS claim_user_name,
           c.agent_session_id AS claim_session_id, se.hostname, se.agent_type::text AS agent_type
      FROM task t
 LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
 LEFT JOIN requirement r ON r.id = t.source_requirement_id
 LEFT JOIN claim c ON c.task_id = t.id AND c.status = 'active'
 LEFT JOIN "user" u ON u.id = c.user_id
 LEFT JOIN agent_session se ON se.id = c.agent_session_id
     WHERE t.project_id = ${input.projectId} AND t.archived_at IS NULL
       AND (sv.spec_id = ${input.specId} OR r.spec_id = ${input.specId})
     ORDER BY t.key
  `);

  const effectOf = (t: ImpactTaskRow): TaskEffect => {
    const ref = t.requirement_ref;
    if (ref !== null && removedRefs.has(ref)) {
      if (t.status === 'done') return 'none';
      return (t.status === 'backlog' || t.status === 'ready') && t.claim_id === null
        ? 'cancel'
        : 'stop';
    }
    if (t.status === 'done') return ref !== null && modifiedRefs.has(ref) ? 'reverify' : 'none';
    // 지금 규칙(승인 → 이전 승인본의 작업에 재브리핑) — 기준선 작업과 막힌 작업은 받지 않는다(REQ-API-210)
    if (
      input.baseVersionId !== null &&
      t.source_spec_version_id === input.baseVersionId &&
      t.status !== 'blocked' &&
      t.baseline_id === null
    ) {
      return 'rebrief';
    }
    return 'none';
  };
  const affected = (t: ImpactTaskRow): boolean =>
    t.requirement_ref === null
      ? changed
      : modifiedRefs.has(t.requirement_ref) || removedRefs.has(t.requirement_ref);

  // 더해진 요구사항 가운데 이미 살아 있는 작업이 있는 것(빠졌다가 돌아온 번호)은 파생 제안에서 뺀다
  const covered = new Set(
    tasks.map((t) => t.requirement_ref).filter((r): r is string => r !== null),
  );

  const { rows: referencing } = await db.execute<{
    key: string;
    title: string;
    kinds: string[];
  }>(sql`
    SELECT s.key, s.title, array_agg(DISTINCT r.kind::text ORDER BY r.kind::text) AS kinds
      FROM spec_relation r JOIN spec s ON s.id = r.from_spec_id
     WHERE r.to_spec_id = ${input.specId} AND s.archived_at IS NULL AND s.id <> ${input.specId}
     GROUP BY s.key, s.title
     ORDER BY s.key
  `);

  const claims = tasks
    .filter((t) => t.claim_id !== null && t.claim_user_id !== null)
    .map((t) => ({
      task_key: t.key,
      requirement_ref: t.requirement_ref,
      user_id: t.claim_user_id ?? '',
      user_name: t.claim_user_name,
      session_id: t.claim_session_id,
      hostname: t.hostname,
      agent_type: t.agent_type,
      affected: affected(t),
    }));
  const withEffect = tasks.map((t) => ({ row: t, effect: effectOf(t) }));
  const doneOf = (ref: string): string[] =>
    tasks.filter((t) => t.status === 'done' && t.requirement_ref === ref).map((t) => t.key);

  return {
    spec_key: head?.spec_key ?? '',
    version_no: Number(head?.version_no ?? 0),
    base_version_no: head?.base_version_no == null ? null : Number(head.base_version_no),
    delta: { added, modified, removed },
    tasks: withEffect.map(({ row, effect }) => ({
      key: row.key,
      title: row.title,
      status: row.status,
      requirement_ref: row.requirement_ref,
      effect,
      claimed: row.claim_id !== null,
    })),
    claims,
    referencing: referencing.map((r) => ({ key: r.key, title: r.title, kinds: r.kinds })),
    suggestions: {
      derive: added
        .filter((a) => !covered.has(a.ref))
        .map((a) => ({
          ref: a.ref,
          statement: a.statement,
          title: derivedTitle(a.ref, a.statement),
        })),
      reverify: modified
        .map((m) => ({ ref: m.ref, statement: m.after, done_tasks: doneOf(m.ref) }))
        .filter((m) => m.done_tasks.length > 0),
      cancel: withEffect
        .filter(({ effect }) => effect === 'cancel')
        .map(({ row }) => ({
          task_key: row.key,
          title: row.title,
          ref: row.requirement_ref ?? '',
          status: row.status,
        })),
    },
    counts: {
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      tasks: tasks.length,
      claims: claims.length,
      affected_claims: claims.filter((c) => c.affected).length,
      referencing: referencing.length,
    },
  };
}

/** 고른 제안을 한다 — 승인 때의 영향과 다시 견줘 맞는 것만(나머지는 `skipped` 로 남긴다) */
async function applyActions(
  tx: Tx,
  emit: EmitFn,
  input: {
    projectId: string;
    versionId: string;
    crKey: string;
    specKey: string;
    versionNo: number;
    planned: PlannedActions;
    impact: SpecImpact;
    userId: string;
    actor: { userId: string | null; sessionId: string | null; isAgent: boolean };
  },
): Promise<AppliedActions> {
  const out: AppliedActions = { created: [], archived: [], skipped: [] };
  const { rows: projects } = await tx.execute<{ key: string }>(
    sql`SELECT key FROM project WHERE id = ${input.projectId}`,
  );
  const projectKey = projects[0]?.key ?? '';
  const derive = new Map(input.impact.suggestions.derive.map((d) => [d.ref, d]));
  const reverify = new Map(input.impact.suggestions.reverify.map((r) => [r.ref, r]));
  const cancel = new Map(input.impact.suggestions.cancel.map((c) => [c.task_key, c]));

  const createTask = async (task: {
    kind: 'derive' | 'reverify';
    ref: string;
    title: string;
    goal: string;
    body: string;
  }): Promise<void> => {
    const { rows: reqs } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM requirement WHERE project_id = ${input.projectId} AND ref = ${task.ref}
    `);
    const id = newId();
    const key = displayKey(projectKey, 'T', id);
    await tx.execute(sql`
      INSERT INTO task (id, project_id, key, title, body_md, status, source_spec_version_id,
                        source_requirement_id, goal_md)
      VALUES (${id}, ${input.projectId}, ${key}, ${task.title}, ${task.body}, 'backlog',
              ${input.versionId}, ${reqs[0]?.id ?? null}, ${task.goal})
    `);
    await emit({
      type: NERV_EVENT.TASK_CREATED,
      projectId: input.projectId,
      subjectType: 'task',
      subjectId: id,
      subjectKey: key,
      actorUserId: input.actor.userId,
      actorSessionId: input.actor.sessionId,
      isAgent: input.actor.isAgent,
      toState: 'backlog',
      payload: { change_request_key: input.crKey, kind: task.kind, requirement_ref: task.ref },
    });
    out.created.push({ key, kind: task.kind, ref: task.ref });
  };

  for (const ref of input.planned.derive) {
    const suggestion = derive.get(ref);
    if (suggestion === undefined) {
      out.skipped.push({ kind: 'derive', value: ref });
      continue;
    }
    await createTask({
      kind: 'derive',
      ref,
      title: suggestion.title,
      goal: suggestion.statement,
      body: text('agent.cr.task.derive_body', {
        cr: input.crKey,
        ref,
        spec: input.specKey,
        version: input.versionNo,
      }),
    });
  }
  for (const ref of input.planned.reverify) {
    const suggestion = reverify.get(ref);
    if (suggestion === undefined) {
      out.skipped.push({ kind: 'reverify', value: ref });
      continue;
    }
    await createTask({
      kind: 'reverify',
      ref,
      title: text('agent.cr.task.reverify_title', { ref }),
      goal: text('agent.cr.task.reverify_goal', {
        tasks: suggestion.done_tasks.join(', '),
        statement: suggestion.statement,
      }),
      body: text('agent.cr.task.reverify_body', {
        cr: input.crKey,
        ref,
        spec: input.specKey,
        version: input.versionNo,
      }),
    });
  }
  for (const taskKey of input.planned.cancel) {
    const suggestion = cancel.get(taskKey);
    if (suggestion === undefined) {
      out.skipped.push({ kind: 'cancel', value: taskKey });
      continue;
    }
    // 보관 — 사유는 `obsolete`(무엇이 바뀌어 하지 않는가)이고 한 줄 사유가 그 CR 이다. 미착수 · 쥔 세션 없음은 미리보기가 이미
    // 봤다(같은 트랜잭션). 이 작업을 기다리던 의존은 푼다 — 대신할 작업이 없다(보관의 규칙 · REQ-API-286)
    const { rows: archived } = await tx.execute<{ id: string }>(sql`
      UPDATE task
         SET archived_at = now(), archive_reason = 'obsolete'::task_archive_reason,
             archive_note = ${text('agent.cr.task.cancel_note', { cr: input.crKey, ref: suggestion.ref })},
             archived_by_user_id = ${input.userId},
             archived_by_session_id = ${input.actor.isAgent ? input.actor.sessionId : null},
             updated_at = now()
       WHERE project_id = ${input.projectId} AND key = ${taskKey} AND archived_at IS NULL
         AND status IN ('backlog', 'ready')
      RETURNING id
    `);
    const archivedId = archived[0]?.id;
    if (archivedId === undefined) {
      out.skipped.push({ kind: 'cancel', value: taskKey });
      continue;
    }
    const { rows: released } = await tx.execute<{ key: string }>(sql`
      DELETE FROM task_dependency d USING task t
       WHERE d.depends_on_task_id = ${archivedId} AND t.id = d.task_id
      RETURNING t.key
    `);
    await emit({
      type: NERV_EVENT.TASK_ARCHIVED,
      projectId: input.projectId,
      subjectType: 'task',
      subjectId: archivedId,
      subjectKey: taskKey,
      actorUserId: input.actor.userId,
      actorSessionId: input.actor.isAgent ? input.actor.sessionId : null,
      isAgent: input.actor.isAgent,
      payload: {
        reason: 'obsolete',
        change_request_key: input.crKey,
        ...(released.length === 0
          ? {}
          : { dependencies_released: released.map((r) => r.key).sort() }),
      },
    });
    out.archived.push(taskKey);
  }
  return out;
}

/** CR 의 웹 주소 — 키든 UUID 든 받는다. 못 찾으면 받은 요청 */
async function crWebUrl(db: Db, projectId: string, refValue: string): Promise<string> {
  const ref = entityRef(refValue);
  const { rows } = await db.execute<{ slug: string; key: string }>(sql`
    SELECT p.slug, cr.key FROM change_request cr JOIN project p ON p.id = cr.project_id
     WHERE cr.project_id = ${projectId}
       AND ${ref.id !== null ? sql`cr.id = ${ref.id}::uuid` : sql`cr.key = ${ref.key ?? ''}`}
  `);
  const row = rows[0];
  return webPath(row === undefined ? '/inbox' : `/p/${row.slug}/crs/${row.key}`);
}

/** 고른 제안을 한 모양으로 — 빠진 칸은 빈 배열, 같은 값은 한 번 */
export function normalizeActions(actions: CrActions): PlannedActions {
  const uniq = (values: readonly string[] | undefined): string[] => [
    ...new Set((values ?? []).map((v) => v.trim()).filter((v) => v !== '')),
  ];
  return {
    derive: uniq(actions.derive),
    reverify: uniq(actions.reverify),
    cancel: uniq(actions.cancel),
  };
}

/** 바뀌거나 빠진 요구사항의 작업을 쥔 사람 — critical 알림의 받는 사람(행위자는 라우팅이 뺀다) */
function affectedClaimUsers(impact: SpecImpact): string[] {
  return [...new Set(impact.claims.filter((c) => c.affected).map((c) => c.user_id))].sort();
}

/** 파생 작업의 제목 — 요구사항 번호와 문장(한 줄로 접고 자른다) */
function derivedTitle(ref: string, statement: string): string {
  const line = `${ref} ${statement.replace(/\s+/g, ' ').trim()}`;
  return line.length <= DERIVED_TITLE_MAX ? line : `${line.slice(0, DERIVED_TITLE_MAX - 1)}…`;
}

/** 웹 주소 — `NERV_WEB_URL` 이 있으면 절대 주소(REQ-API-177 과 같은 규칙) */
function webPath(path: string): string {
  const base = process.env['NERV_WEB_URL'];
  return base === undefined || base === '' ? path : `${base.replace(/\/$/, '')}${path}`;
}
