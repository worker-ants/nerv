// 스펙 도메인 서비스 — 상태 전이·게이트 판정의 단일 구현 (D-05 · REQ-CB-003)
//
// SpecVersion 은 **불변 스냅샷**이다. 가변인 구간은 draft 하나뿐이고, in_review 진입 시점에
// 본문이 동결된다(spec-workflow §1.2) — DB 트리거가 그것을 최종 강제한다(4.3 §2.13).
// 승인된 버전을 고치는 유일한 경로는 새 draft 를 만드는 것이다.
//
// 에이전트는 **draft 까지만** 만들 수 있다. spec:approve 는 어떤 자율성 설정에서도 사람 전용이고
// 카탈로그에 대응 도구가 처음부터 없다(agent-integration §2.1 원칙 3).

import { Injectable, Logger } from '@nestjs/common';
import { LEASE_TTL_SECONDS, NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { InjectDb, toDate } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError, NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import { decideGate, inferAxes } from './gate-tier.js';
import type { GateDecision } from './gate-tier.js';
import { SpecCheckService } from './spec-check.service.js';
import type { CheckResult } from './spec-check.service.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

export interface SpecTreeNode extends Record<string, unknown> {
  id: string;
  key: string;
  title: string;
  type: string;
  parent_id: string | null;
  sort_key: string;
  doc_status: string | null;
  version_no: number | null;
}

export interface DraftUpsertInput {
  projectId: string;
  /** 기존 스펙에 이어쓰기면 지정. 없으면 새 스펙을 만든다 */
  specId?: string | null;
  /** 새 스펙 생성 시의 메타 — 기존 spec 에 다른 값이 오면 409(api.md §4) */
  key?: string;
  title?: string;
  type?: string;
  parentId?: string | null;
  bodyMd: string;
  /** 낙관적 동시성 — 불일치는 409. 리스의 최후 방어선이다(§1.2) */
  baseVersionId?: string | null;
  userId: string;
  sessionId?: string | null;
}

@Injectable()
export class SpecService {
  private readonly logger = new Logger(SpecService.name);

  /** 초안 편집 리스 TTL — Task 클레임 리스와 **같은 상수**다(D-04 문서 축 확장) */
  readonly draftLeaseTtlSeconds = LEASE_TTL_SECONDS;

  constructor(
    private readonly events: EventService,
    private readonly checks: SpecCheckService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /** nerv_spec_tree · EP-SPEC-01 */
  async tree(input: { projectId: string; includeArchived?: boolean }): Promise<SpecTreeNode[]> {
    const archived = input.includeArchived === true ? sql`` : sql` AND s.archived_at IS NULL`;
    const { rows } = await this.db.execute<SpecTreeNode>(sql`
      SELECT s.id, s.key, s.title, s.type::text AS type, s.parent_id, s.sort_key,
             sv.status::text AS doc_status, sv.version_no
        FROM spec s
   LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE s.project_id = ${input.projectId}${archived}
       ORDER BY s.sort_key, s.key
    `);
    return rows;
  }

  /** nerv_spec_get · EP-SPEC-03 — 기준 버전 지정 조회를 지원한다(agent-integration §2.4) */
  async get(input: {
    projectId: string;
    specKey: string;
    versionNo?: number | null;
  }): Promise<Record<string, unknown>> {
    const pick =
      input.versionNo == null
        ? sql`sv.id = s.current_version_id`
        : sql`sv.spec_id = s.id AND sv.version_no = ${input.versionNo}`;

    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT s.id AS spec_id, s.key, s.title, s.type::text AS type, s.archived_at,
             sv.id AS version_id, sv.version_no, sv.status::text AS doc_status, sv.body_md,
             sv.superseded_by_version_id
        FROM spec s JOIN spec_version sv ON ${pick}
       WHERE s.project_id = ${input.projectId} AND s.key = ${input.specKey}
    `);
    const spec = rows[0];
    if (spec === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '스펙을 찾을 수 없습니다.', {
        kind: 'not_found',
        spec: input.specKey,
      });
    }

    const { rows: requirements } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT ref, statement_md, priority::text AS priority, impl_status::text AS impl_status
        FROM requirement WHERE spec_id = ${spec['spec_id'] as string} AND removed_in_version_id IS NULL
       ORDER BY ref
    `);

    return {
      ...spec,
      requirements,
      // 기준 버전이 이미 지나간 판이면 표시한다 — 재브리핑의 신호다(§2.4)
      basis_superseded: spec['superseded_by_version_id'] !== null,
    };
  }

  /**
   * nerv_spec_draft_upsert · EP-SPEC-07·08.
   *
   * 세 가지가 이 메서드 안에 있다: **초안 편집 리스**(D-04 문서 축 확장) ·
   * **base_version 409**(낙관적 동시성) · **불변 스냅샷 규칙**(draft 밖은 못 고친다).
   * 리스는 1차 사전 조정이고 409 가 데이터 유실의 최후 방어선이다 — 역할이 달라 둘 다 있다.
   */
  async draftUpsert(input: DraftUpsertInput): Promise<Record<string, unknown>> {
    return this.events.transact(async (tx, emit) => {
      let specId = input.specId ?? null;
      let created = false;

      if (specId === null) {
        if (input.key === undefined || input.title === undefined || input.type === undefined) {
          throw new NervError(
            NERV_ERROR.PRECONDITION,
            '새 스펙에는 key·title·type 이 필요합니다.',
            {
              kind: 'missing_meta',
            },
          );
        }
        specId = newId();
        await tx.execute(sql`
          INSERT INTO spec (id, project_id, parent_id, type, key, title)
          VALUES (${specId}, ${input.projectId}, ${input.parentId ?? null}, ${input.type}::spec_type,
                  ${input.key}, ${input.title})
        `);
        created = true;
      }

      const draft = await this.currentDraft(tx, specId);

      // 편집 리스 — 같은 사용자면 자동 인계, 다른 사용자면 하드 차단(§1.2)
      if (draft !== null) {
        await this.assertDraftLease(draft, input.userId);
      }

      // base_version 전제조건 — 불일치는 409. 리스가 뚫려도 여기서 막힌다
      if (input.baseVersionId != null && draft !== null && draft.id !== input.baseVersionId) {
        throw new NervError(NERV_ERROR.PRECONDITION, '기준 버전이 현재 초안과 다릅니다.', {
          kind: 'base_version',
          expected: draft.id,
          received: input.baseVersionId,
        });
      }

      const hash = createHash('sha256').update(input.bodyMd, 'utf8').digest('hex');
      const leaseExpires = new Date(Date.now() + this.draftLeaseTtlSeconds * 1000);

      if (draft !== null) {
        // 무변경 저장은 새 버전을 만들지 않는다 — content_hash 가 그것을 판정한다
        await tx.execute(sql`
          UPDATE spec_version
             SET body_md = ${input.bodyMd}, content_hash = decode(${hash}, 'hex'),
                 edit_lease_user_id = ${input.userId},
                 edit_lease_session_id = ${input.sessionId ?? null},
                 edit_lease_expires_at = ${leaseExpires.toISOString()}
           WHERE id = ${draft.id}
        `);
        return {
          spec_id: specId,
          spec_version_id: draft.id,
          version_no: draft.version_no,
          created: false,
        };
      }

      const { rows: last } = await tx.execute<{ max: number | null }>(
        sql`SELECT max(version_no) AS max FROM spec_version WHERE spec_id = ${specId}`,
      );
      const versionNo = Number(last[0]?.max ?? 0) + 1;
      const versionId = newId();

      await tx.execute(sql`
        INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash,
                                  author_user_id, author_session_id, base_version_id,
                                  edit_lease_user_id, edit_lease_session_id, edit_lease_expires_at)
        VALUES (${versionId}, ${specId}, ${versionNo}, 'draft', ${input.bodyMd},
                decode(${hash}, 'hex'), ${input.userId}, ${input.sessionId ?? null},
                ${input.baseVersionId ?? null}, ${input.userId}, ${input.sessionId ?? null},
                ${leaseExpires.toISOString()})
      `);
      if (created) {
        await tx.execute(
          sql`UPDATE spec SET current_version_id = ${versionId} WHERE id = ${specId}`,
        );
      }

      await emit({
        type: NERV_EVENT.SPEC_DRAFT_CREATED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: versionId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        toState: 'draft',
      });

      return { spec_id: specId, spec_version_id: versionId, version_no: versionNo, created: true };
    });
  }

  /**
   * nerv_spec_submit_review · EP-SPEC-10 (A3 — 사람 승인 필요).
   *
   * 제출은 **본문을 동결한다**. 게이트 티어를 산출해 T0·T1 은 자동 통과시키고
   * T2·T3 은 승인 대기로 보낸다(D-06). 자동 통과 경로가 없으면 "버그 하나에 16개 인수 기준"
   * 비판을 그대로 실현하는 도구가 된다(§2.4).
   */
  async submitReview(input: {
    projectId: string;
    specVersionId: string;
    userId: string;
    sessionId?: string | null;
  }): Promise<{ status: string; gate: GateDecision; approval_id: string | null }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        id: string;
        spec_id: string;
        status: string;
        spec_type: string;
      }>(sql`
        SELECT sv.id, sv.spec_id, sv.status::text AS status, s.type::text AS spec_type
          FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
         FOR UPDATE OF sv
      `);
      const version = rows[0];
      if (version === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, '초안을 찾을 수 없습니다.', {
          kind: 'not_found',
        });
      }
      if (version.status !== 'draft') {
        throw new NervError(NERV_ERROR.PRECONDITION, `draft 가 아닙니다(${version.status}).`, {
          kind: 'not_draft',
          status: version.status,
        });
      }

      // 사전 검토 — block 이 있으면 제출 자체가 막힌다(§1.2 전이 가드).
      // clemvion 의 "쓰기 직전 consistency-check 의무"가 여기로 옮겨 온 것이다.
      const check = await this.checks.check({
        projectId: input.projectId,
        specVersionId: input.specVersionId,
      });
      if (check.verdict === 'block') {
        throw new NervError(NERV_ERROR.PRECONDITION, '사전 검토에서 차단 항목이 발견됐습니다.', {
          kind: 'precheck_blocked',
          findings: check.findings.filter((f) => f.severity === 'block'),
        });
      }

      const gate = await this.assessGate(tx, version.spec_id, version.spec_type);

      // 제출 = 본문 동결. 트리거가 이후 UPDATE 를 막는다(4.3 §2.13)
      await tx.execute(sql`
        UPDATE spec_version
           SET status = 'in_review', submitted_at = now(),
               edit_lease_user_id = NULL, edit_lease_session_id = NULL, edit_lease_expires_at = NULL
         WHERE id = ${input.specVersionId}
      `);
      await emit({
        type: NERV_EVENT.SPEC_SUBMITTED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: input.specVersionId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        fromState: 'draft',
        toState: 'in_review',
        payload: { gate_tier: gate.tier, gate_score: gate.score },
      });

      if (gate.autoPass) {
        // T0·T1 — 승인 없이 approved. T1 은 24시간 이의제기 창이 열린다
        await this.approveInTx(tx, emit, {
          projectId: input.projectId,
          specVersionId: input.specVersionId,
          specId: version.spec_id,
          approverUserId: null,
          gate,
        });
        return { status: 'approved', gate, approval_id: null };
      }

      // T2·T3 — 승인 대기. pending Approval 을 재사용해 카드 중복을 막는다(§2.5)
      const approvalId = await this.ensurePendingApproval(tx, {
        projectId: input.projectId,
        specVersionId: input.specVersionId,
        requestedByUserId: input.userId,
        requestedBySessionId: input.sessionId ?? null,
      });
      await emit({
        type: NERV_EVENT.APPROVAL_REQUESTED,
        projectId: input.projectId,
        subjectType: 'approval',
        subjectId: approvalId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        payload: { gate_tier: gate.tier, required_approvers: gate.requiredApprovers },
      });

      return { status: 'in_review', gate, approval_id: approvalId };
    });
  }

  /**
   * 승인 — **사람 전용**이다(A4). 지시자≠승인자를 여기서 강제한다(D-06 · §2.3).
   * 소규모 완화(멤버 2인 미만이면 차단 대신 감사 이벤트)는 정본이 정한 예외다.
   */
  async approve(input: {
    projectId: string;
    specVersionId: string;
    approverUserId: string;
  }): Promise<{ status: string }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        spec_id: string;
        status: string;
        author_user_id: string;
        spec_type: string;
      }>(sql`
        SELECT sv.spec_id, sv.status::text AS status, sv.author_user_id, s.type::text AS spec_type
          FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
         FOR UPDATE OF sv
      `);
      const version = rows[0];
      if (version === undefined || version.status !== 'in_review') {
        throw new NervError(NERV_ERROR.PRECONDITION, 'in_review 상태가 아닙니다.', {
          kind: 'not_in_review',
          status: version?.status ?? null,
        });
      }

      await this.assertDifferentApprover(tx, input, version.author_user_id);

      const gate = await this.assessGate(tx, version.spec_id, version.spec_type);
      await this.approveInTx(tx, emit, {
        projectId: input.projectId,
        specVersionId: input.specVersionId,
        specId: version.spec_id,
        approverUserId: input.approverUserId,
        gate,
      });
      return { status: 'approved' };
    });
  }

  /** 거절 — in_review → draft. 리스는 다시 열린다. */
  async reject(input: {
    projectId: string;
    specVersionId: string;
    reviewerUserId: string;
    comment: string;
  }): Promise<{ status: string }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        UPDATE spec_version SET status = 'draft', submitted_at = NULL
         WHERE id = ${input.specVersionId} AND status = 'in_review'
        RETURNING id
      `);
      if (rows.length === 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, 'in_review 상태가 아닙니다.', {
          kind: 'not_in_review',
        });
      }
      await emit({
        type: NERV_EVENT.SPEC_REJECTED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: input.specVersionId,
        actorUserId: input.reviewerUserId,
        fromState: 'in_review',
        toState: 'draft',
        payload: { comment: input.comment },
      });
      return { status: 'draft' };
    });
  }

  /** nerv_spec_search · EP-SPEC-02 — 하이브리드 파이프라인은 E09-S10 */
  search(): never {
    throw new NotImplementedYetError('E09-S10', '하이브리드 검색');
  }

  /**
   * nerv_spec_check · EP-SPEC-09 — 사전 검토 5검사기.
   * 제출 게이트이면서 **셀프서비스**다: 초안 저장 후·제출 전 아무 때나 부를 수 있다(§2.1).
   */
  check(input: { projectId: string; specVersionId: string }): Promise<CheckResult> {
    return this.checks.check(input);
  }

  resolveComment(): never {
    throw new NotImplementedYetError('E10-S03', '코멘트 해소');
  }

  updateMeta(): never {
    throw new NotImplementedYetError('E09-S08', '스펙 메타 수정');
  }

  relations(): never {
    throw new NotImplementedYetError('E09-S12', '관계 조회');
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────

  private async currentDraft(
    tx: Tx,
    specId: string,
  ): Promise<{
    id: string;
    version_no: number;
    edit_lease_user_id: string | null;
    edit_lease_expires_at: unknown;
  } | null> {
    const { rows } = await tx.execute<{
      id: string;
      version_no: number;
      edit_lease_user_id: string | null;
      edit_lease_expires_at: unknown;
    }>(sql`
      SELECT id, version_no, edit_lease_user_id, edit_lease_expires_at
        FROM spec_version WHERE spec_id = ${specId} AND status = 'draft'
       ORDER BY version_no DESC LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /**
   * 초안 편집 리스 — 같은 사용자면 자동 인계, 다른 사용자면 NERV_DRAFT_LEASED(§1.2).
   * 만료된 리스는 비어 있는 것과 같다.
   */
  private async assertDraftLease(
    draft: { edit_lease_user_id: string | null; edit_lease_expires_at: unknown },
    userId: string,
  ): Promise<void> {
    const holder = draft.edit_lease_user_id;
    if (holder === null) return;
    const expires =
      draft.edit_lease_expires_at === null ? null : toDate(draft.edit_lease_expires_at);
    if (expires !== null && expires.getTime() <= Date.now()) return; // 만료 — 비어 있다
    if (holder === userId) return; // 같은 사용자 — 표면 간 자동 인계

    throw new NervError(NERV_ERROR.DRAFT_LEASED, '다른 사용자가 이 초안을 편집 중입니다.', {
      kind: 'draft_leased',
      holder_user_id: holder,
      expires_at: expires?.toISOString() ?? null,
    });
  }

  /** 게이트 4축 추정 — 참조 수·파생 Task 수를 실제로 센다. */
  private async assessGate(tx: Tx, specId: string, specType: string): Promise<GateDecision> {
    const { rows } = await tx.execute<{
      referencing: number;
      tasks: number;
      requirements: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM spec_relation WHERE to_spec_id = ${specId}) AS referencing,
        (SELECT count(*)::int FROM task t JOIN spec_version sv ON sv.id = t.source_spec_version_id
          WHERE sv.spec_id = ${specId}) AS tasks,
        (SELECT count(*)::int FROM requirement WHERE spec_id = ${specId}) AS requirements
    `);
    const counts = rows[0] ?? { referencing: 0, tasks: 0, requirements: 0 };

    return decideGate(
      inferAxes({
        specType,
        requirementsAdded: 0,
        requirementsRemoved: 0,
        requirementsModified: counts.requirements > 0 ? 1 : 0,
        bodyChanged: true,
        referencingSpecs: counts.referencing,
        derivedTasks: counts.tasks,
      }),
    );
  }

  /** 승인 확정 — 이전 approved 를 superseded 로 밀고 참조 전파 신호를 낸다. */
  private async approveInTx(
    tx: Tx,
    emit: (
      input: Parameters<Parameters<EventService['transact']>[0]>[1] extends (i: infer I) => unknown
        ? I
        : never,
    ) => Promise<unknown>,
    input: {
      projectId: string;
      specVersionId: string;
      specId: string;
      approverUserId: string | null;
      gate: GateDecision;
    },
  ): Promise<void> {
    // 같은 Spec 의 이전 approved 를 superseded 로 (서버 자동 전이 — §1.2)
    const { rows: superseded } = await tx.execute<{ id: string }>(sql`
      UPDATE spec_version
         SET status = 'superseded', superseded_by_version_id = ${input.specVersionId}
       WHERE spec_id = ${input.specId} AND status = 'approved' AND id <> ${input.specVersionId}
      RETURNING id
    `);

    await tx.execute(sql`
      UPDATE spec_version
         SET status = 'approved', approved_at = now(), approved_by_user_id = ${input.approverUserId}
       WHERE id = ${input.specVersionId}
    `);
    await tx.execute(
      sql`UPDATE spec SET current_version_id = ${input.specVersionId} WHERE id = ${input.specId}`,
    );

    await emit({
      type: NERV_EVENT.SPEC_APPROVED,
      projectId: input.projectId,
      subjectType: 'spec_version',
      subjectId: input.specVersionId,
      actorUserId: input.approverUserId,
      isAgent: false,
      fromState: 'in_review',
      toState: 'approved',
      payload: { gate_tier: input.gate.tier, auto_passed: input.gate.autoPass },
    });

    for (const old of superseded) {
      await emit({
        type: NERV_EVENT.SPEC_SUPERSEDED,
        projectId: input.projectId,
        subjectType: 'spec_version',
        subjectId: old.id,
        actorUserId: input.approverUserId,
        isAgent: false,
        fromState: 'approved',
        toState: 'superseded',
      });

      // 기준 버전이 지나간 Task 에 재브리핑 플래그를 세운다(spec-workflow §3.3)
      const { rows: rebriefed } = await tx.execute<{ id: string }>(sql`
        UPDATE task SET rebrief_required_at = now()
         WHERE source_spec_version_id = ${old.id} AND status NOT IN ('done', 'blocked')
        RETURNING id
      `);
      for (const task of rebriefed) {
        await emit({
          type: NERV_EVENT.TASK_REBRIEF_REQUIRED,
          projectId: input.projectId,
          subjectType: 'task',
          subjectId: task.id,
          isAgent: false,
        });
      }
    }

    // 참조 전파 — 이 스펙을 참조하는 문서에 재검토 신호(§3.3)
    const { rows: referencing } = await tx.execute<{ from_spec_id: string }>(
      sql`SELECT from_spec_id FROM spec_relation WHERE to_spec_id = ${input.specId}`,
    );
    for (const ref of referencing) {
      await emit({
        type: NERV_EVENT.SPEC_RECHECK_REQUESTED,
        projectId: input.projectId,
        subjectType: 'spec',
        subjectId: ref.from_spec_id,
        isAgent: false,
        payload: { because_of: input.specId },
      });
    }
  }

  /**
   * 지시자≠승인자 (D-06 · §2.3).
   * **CHECK 로 내리지 않은 이유**가 여기 있다 — 소규모 완화가 있어서다: 멤버가 2인 미만이면
   * 차단 대신 통과시키고 감사 이벤트를 남긴다. 하드 제약이면 1인 팀이 아무것도 승인할 수 없다.
   */
  private async assertDifferentApprover(
    tx: Tx,
    input: { projectId: string; approverUserId: string },
    authorUserId: string,
  ): Promise<void> {
    if (input.approverUserId !== authorUserId) return;

    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT user_id)::int AS n FROM membership
       WHERE project_id = ${input.projectId} OR project_id IS NULL
    `);
    const members = rows[0]?.n ?? 1;
    if (members < 2) {
      this.logger.warn(`소규모 완화 — 멤버 ${members}인이라 자기 승인을 허용한다(감사 기록됨)`);
      return;
    }
    throw new NervError(NERV_ERROR.FORBIDDEN, '작성자는 자기 스펙을 승인할 수 없습니다.', {
      kind: 'self_approval',
      author_user_id: authorUserId,
    });
  }

  /** pending Approval 재사용 — 같은 초안을 다시 제출해도 카드가 늘지 않는다(§2.5). */
  private async ensurePendingApproval(
    tx: Tx,
    input: {
      projectId: string;
      specVersionId: string;
      requestedByUserId: string;
      requestedBySessionId: string | null;
    },
  ): Promise<string> {
    const { rows: existing } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM approval
       WHERE project_id = ${input.projectId} AND subject_type = 'spec_version'
         AND subject_id = ${input.specVersionId} AND decision IS NULL
    `);
    const found = existing[0]?.id;
    if (found !== undefined) return found;

    const approvalId = newId();
    await tx.execute(sql`
      INSERT INTO approval (id, project_id, subject_type, subject_id,
                            requested_by_user_id, requested_by_session_id)
      VALUES (${approvalId}, ${input.projectId}, 'spec_version', ${input.specVersionId},
              ${input.requestedByUserId}, ${input.requestedBySessionId})
    `);
    return approvalId;
  }
}
