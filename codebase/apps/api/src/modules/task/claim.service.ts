// 원자적 클레임 · scope 겹침 검사 · 리스 (D-04 · FR-06)
// 알고리즘 정본: docs/03-proposal/spec-workflow.md §4.3~4.5 · 상수 정본: @nerv/schema
//
// **Phase 0 의 핵심 검증 대상이다.** 종료 게이트가 이 파일을 직접 가리킨다 —
// 두 호스트·세 세션 90분 동시 작업에서 중복 클레임 0건, 겹침 경고 10/10 검출·오탐 0.
// 그래서 동시성은 mock 으로 검증하지 않는다(codebase.md §4.3): 트랜잭션·행 잠금·부분 인덱스가
// 실제로 도는 DB 를 상대로만 의미가 있다.
//
// 이 기능이 존재하는 이유는 clemvion 이 이것을 **의도적으로 삭제**했기 때문이다 —
// plan_coherence 체커가 spec 동시수정을 검출했으나 "병렬 작업이 다른 머신·세션이면 로컬에
// 안 보여 신뢰할 수 없다"는 이유로 제거됐다(#576). 서버는 모든 세션의 선언을 본다.

import { Injectable, Logger } from '@nestjs/common';
import { msg, newId, LEASE_TTL_SECONDS, NERV_ERROR } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { sqlArray, sqlSeconds } from '../../common/sql-array.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { toDate } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

export interface ClaimScope {
  /** 이 작업이 건드릴 스펙 */
  specIds: string[];
  /** 이 작업이 건드릴 파일 */
  fileGlobs: string[];
}

/** 겹침 위험도 — 차단은 좁게, 경고는 넓게(spec-workflow §4.4 severity_of) */
export type OverlapSeverity = 'block' | 'warn' | 'info';

export interface Overlap {
  claimId: string;
  sessionId: string | null;
  taskId: string;
  userId: string;
  /** 상대가 누구의 어느 머신인지 — 경고에 반드시 실린다(agent-integration §2.4) */
  hostname: string | null;
  specHit: string[];
  fileHit: [string, string][];
  severity: OverlapSeverity;
}

interface ActiveClaimRow extends Record<string, unknown> {
  claim_id: string;
  task_id: string;
  session_id: string | null;
  user_id: string;
  hostname: string | null;
  scope_spec_ids: string[];
  scope_file_globs: string[];
  source_spec_version_id: string | null;
  source_requirement_id: string | null;
}

@Injectable()
export class ClaimService {
  private readonly logger = new Logger(ClaimService.name);

  /** Task 클레임 리스와 초안 편집 리스가 같은 상수를 쓴다(D-04 · scope.md §3.5) */
  readonly leaseTtlSeconds = LEASE_TTL_SECONDS;

  /**
   * 만료 리스 회수 — 비교 대상을 "살아있는" 클레임으로 좁히기 위해 겹침 검사보다 먼저 돈다
   * (spec-workflow §4.3 단계 1). 워커의 lease-reaper 잡도 같은 메서드를 쓴다.
   *
   * @returns 회수된 클레임 수
   */
  async reclaimExpired(tx: Tx, projectId?: string): Promise<number> {
    const scope = projectId === undefined ? sql`` : sql` AND c.project_id = ${projectId}`;

    // 회수는 두 단계다: 클레임을 expired 로 닫고, 그 Task 를 ready 로 되돌린다.
    // 산출물·Activity 는 보존한다(spec-workflow §4.5 회수 동작).
    const { rows } = await tx.execute<{ task_id: string }>(sql`
      WITH expired AS (
        UPDATE claim c
           SET status = 'expired', released_at = now(), release_reason = 'expired'
         WHERE c.status = 'active' AND c.lease_expires_at <= now()${scope}
        RETURNING c.task_id
      )
      UPDATE task t
         SET status = 'ready', delegate_session_id = NULL
        FROM expired e
       WHERE t.id = e.task_id AND t.status IN ('claimed', 'in_progress')
      RETURNING t.id AS task_id
    `);
    return rows.length;
  }

  /**
   * 스펙 트리 폐포 — 조상·자손까지 확장한다(spec-workflow §4.4 단계 2-a).
   * 부모 문서를 고치는 작업과 자식 문서를 고치는 작업은 서로 모르는 채 충돌할 수 있다.
   */
  async specClosure(tx: Tx, specIds: string[]): Promise<Set<string>> {
    if (specIds.length === 0) return new Set();
    const { rows } = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE seed AS (
        SELECT id, parent_id FROM spec WHERE id = ANY(${sqlArray(specIds, 'uuid')})
      ),
      up AS (
        SELECT s.id, s.parent_id FROM seed s
        UNION
        SELECT p.id, p.parent_id FROM spec p JOIN up ON p.id = up.parent_id
      ),
      down AS (
        SELECT s.id FROM seed s
        UNION
        SELECT c.id FROM spec c JOIN down ON c.parent_id = down.id
      )
      SELECT id FROM up UNION SELECT id FROM down
    `);
    return new Set(rows.map((r) => r.id));
  }

  /**
   * 겹침 판정 — 활성 클레임 전체와 두 축(스펙·파일)으로 교집합을 계산한다.
   *
   * ※ **해석 하나를 명시한다.** spec-workflow §4.4 의 severity_of 는 차단 조건을
   *   `both_tasks_mutate_spec(t_new, c_old)` 로 적었는데, "Task 가 스펙을 개정한다"를
   *   판정할 필드가 데이터 모델에 없다. 여기서는 **선언된 spec_ids 의 직접 교집합**을
   *   그것으로 읽는다 — `claim.scope_spec_ids` 의 정의가 "이 작업이 건드릴 스펙"(4.3 §2.5)
   *   이므로 같은 스펙을 둘이 직접 선언했다면 그것이 곧 "동시 개정" 선언이다.
   *   트리 폐포로만 만나는 경우(한쪽이 다른 쪽의 조상·자손)는 경고다 — 그래야
   *   §4.4 가 block 과 warn 을 나눈 것이 의미를 갖는다. 문서에 정의가 생기면 이 함수만 바뀐다.
   */
  async detectOverlaps(
    tx: Tx,
    input: {
      projectId: string;
      sessionId: string | null;
      scope: ClaimScope;
      sourceRequirementId?: string | null;
    },
  ): Promise<Overlap[]> {
    const active = await this.activeClaims(tx, input.projectId, input.sessionId);
    if (active.length === 0) return [];

    const declared = new Set(input.scope.specIds);
    const closure = await this.specClosure(tx, input.scope.specIds);

    const overlaps: Overlap[] = [];
    for (const other of active) {
      const otherDeclared = new Set(other.scope_spec_ids ?? []);
      const otherClosure = await this.specClosure(tx, other.scope_spec_ids ?? []);

      const directHit = [...declared].filter((id) => otherDeclared.has(id));
      const closureHit = [...closure].filter((id) => otherClosure.has(id));
      const fileHit = await this.globHits(tx, input.scope.fileGlobs, other.scope_file_globs ?? []);

      if (closureHit.length === 0 && fileHit.length === 0) continue;

      const sameRequirement =
        input.sourceRequirementId != null &&
        other.source_requirement_id != null &&
        input.sourceRequirementId === other.source_requirement_id;

      const severity: OverlapSeverity =
        directHit.length > 0
          ? 'block'
          : closureHit.length > 0
            ? 'warn'
            : sameRequirement
              ? 'warn'
              : 'info';

      overlaps.push({
        claimId: other.claim_id,
        sessionId: other.session_id,
        taskId: other.task_id,
        userId: other.user_id,
        hostname: other.hostname,
        specHit: closureHit,
        fileHit,
        severity,
      });
    }
    return overlaps;
  }

  /** 살아있는 클레임만 — 만료·죽은 세션은 호출 전에 회수돼 있어야 한다. */
  private async activeClaims(
    tx: Tx,
    projectId: string,
    excludeSessionId: string | null,
  ): Promise<ActiveClaimRow[]> {
    const exclude =
      excludeSessionId === null
        ? sql``
        : sql` AND (c.agent_session_id IS NULL OR c.agent_session_id <> ${excludeSessionId})`;

    const { rows } = await tx.execute<ActiveClaimRow>(sql`
      SELECT c.id AS claim_id, c.task_id, c.agent_session_id AS session_id, c.user_id,
             s.hostname, c.scope_spec_ids, c.scope_file_globs,
             t.source_spec_version_id, t.source_requirement_id
        FROM claim c
        JOIN task t ON t.id = c.task_id
   LEFT JOIN agent_session s ON s.id = c.agent_session_id
       WHERE c.project_id = ${projectId}
         AND c.status = 'active'
         AND c.released_at IS NULL
         AND c.lease_expires_at > now()
         AND (s.id IS NULL OR s.state IN ('pending', 'active', 'awaiting_input'))${exclude}
    `);
    return rows;
  }

  /**
   * glob 교차 — 파일시스템을 읽지 않고 패턴만으로 판정한다.
   * 판정 함수는 DB 에 있다(nerv_glob_overlap — 4.3 §2.13). 보수적이다: 과검출은 경고로
   * 끝나지만 미검출은 사고다.
   */
  private async globHits(tx: Tx, mine: string[], theirs: string[]): Promise<[string, string][]> {
    if (mine.length === 0 || theirs.length === 0) return [];
    const { rows } = await tx.execute<{ a: string; b: string }>(sql`
      SELECT a, b FROM unnest(${sqlArray(mine, 'text')}) AS a
      CROSS JOIN unnest(${sqlArray(theirs, 'text')}) AS b
      WHERE nerv_glob_overlap(a, b)
    `);
    return rows.map((r) => [r.a, r.b] as [string, string]);
  }

  /** 리스 연장 — 하트비트가 부른다. 만료된 리스는 되살리지 않는다. */
  async renewLease(tx: Tx, claimId: string, ttlSeconds = this.leaseTtlSeconds): Promise<Date> {
    const { rows } = await tx.execute<{ lease_expires_at: unknown }>(sql`
      UPDATE claim
         SET lease_expires_at = now() + ${sqlSeconds(ttlSeconds)},
             last_heartbeat_at = now()
       WHERE id = ${claimId} AND status = 'active' AND lease_expires_at > now()
      RETURNING lease_expires_at
    `);
    const row = rows[0];
    if (row === undefined) {
      throw new NervError(NERV_ERROR.LEASE_EXPIRED, msg('error.claim.lease_expired'), {
        claim_id: claimId,
      });
    }
    return toDate(row.lease_expires_at);
  }

  /** 새 클레임 행. 부분 unique(claim_task_active_uq)가 최종 방어선이다. */
  async insertClaim(
    tx: Tx,
    input: {
      projectId: string;
      taskId: string;
      sessionId: string | null;
      userId: string;
      scope: ClaimScope;
      ttlSeconds: number;
    },
  ): Promise<{ claimId: string; leaseExpiresAt: Date }> {
    const claimId = newId();
    const specArray = sqlArray(input.scope.specIds, 'uuid');
    const globArray = sqlArray(input.scope.fileGlobs, 'text');

    const { rows } = await tx.execute<{ lease_expires_at: unknown }>(sql`
      INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status,
                         scope_spec_ids, scope_file_globs, lease_expires_at)
      VALUES (${claimId}, ${input.projectId}, ${input.taskId}, ${input.sessionId}, ${input.userId},
              'active', ${specArray}, ${globArray},
              now() + ${sqlSeconds(input.ttlSeconds)})
      RETURNING lease_expires_at
    `);
    const row = rows[0];
    // eslint-disable-next-line no-restricted-syntax -- 내부 불변식 — 사람에게 보이지 않는다(REQ-CB-022)
    if (row === undefined) throw new Error('클레임 삽입이 행을 돌려주지 않았습니다');
    return { claimId, leaseExpiresAt: toDate(row.lease_expires_at) };
  }
}
