// Task 도메인 서비스 — 상태 전이 · 위임 명세 · 클레임 조율
// 메서드 이름은 docs/04-mvp/api.md §4 대응표의 "내부 서비스 메서드" 열과 1:1 이다.
// REST 컨트롤러와 MCP 도구가 이 클래스의 같은 인스턴스를 거친다(D-05) — 판정은 여기 한 곳이다.

import { Injectable, Logger } from '@nestjs/common';
import { LEASE_TTL_SECONDS, NERV_ERROR, NERV_EVENT } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb, toDate } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError, NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import { ClaimService } from './claim.service.js';
import type { ClaimScope, Overlap } from './claim.service.js';

export interface ClaimInput {
  projectId: string;
  taskId: string;
  /** 사람이 직접 잡으면 null */
  sessionId: string | null;
  userId: string;
  scope: ClaimScope;
  leaseSeconds?: number;
}

export interface ClaimResult {
  claimId: string;
  leaseExpiresAt: Date;
  /** warn·info 겹침 — 통과시키되 양쪽에 알린다(spec-workflow §4.4 단계 3) */
  warnings: Overlap[];
  /** 같은 세션의 재호출이면 기존 클레임을 그대로 돌려준다(멱등, 리스 연장 없음) */
  replayed: boolean;
}

export interface ReadyCandidate extends Record<string, unknown> {
  id: string;
  key: string;
  title: string;
  priority: string;
  goal_md: string;
  output_format_md: string;
  tools_sources_md: string;
  boundaries_md: string;
  source_spec_version_id: string | null;
  baseline_id: string | null;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly claims: ClaimService,
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * ready 큐 — **질의 결과이지 문서가 아니다**(spec-workflow §4.2).
   * clemvion 에서 백로그 조망을 담당하던 인덱스 문서가 부패해 삭제된 것이 이 설계의 근거다.
   *
   * ready(task) ⟺ 승인된 기준 버전 + 위임 명세 4요소 + 선행 의존 전부 done + blocked_reason 없음
   */
  async next(input: { projectId: string; limit?: number }): Promise<ReadyCandidate[]> {
    const limit = Math.min(input.limit ?? 10, 50);
    const { rows } = await this.db.execute<ReadyCandidate>(sql`
      SELECT t.id, t.key, t.title, t.priority::text AS priority,
             t.goal_md, t.output_format_md, t.tools_sources_md, t.boundaries_md,
             t.source_spec_version_id, t.baseline_id
        FROM task t
        LEFT JOIN spec_version sv ON sv.id = t.source_spec_version_id
       WHERE t.project_id = ${input.projectId}
         AND t.status = 'ready'
         AND t.blocked_reason IS NULL
         -- 위임 명세 4요소 — CHECK 가 이미 막지만 질의에서도 확인한다(방어적)
         AND t.goal_md IS NOT NULL AND t.output_format_md IS NOT NULL
         AND t.tools_sources_md IS NOT NULL AND t.boundaries_md IS NOT NULL
         -- 기준 버전이 있으면 승인된 것이어야 한다
         AND (t.source_spec_version_id IS NULL OR sv.status = 'approved')
         -- 선행 의존(blocks)이 전부 done
         AND NOT EXISTS (
           SELECT 1 FROM task_dependency d
             JOIN task dep ON dep.id = d.depends_on_task_id
            WHERE d.task_id = t.id AND d.kind = 'blocks' AND dep.status <> 'done'
         )
         -- 이미 활성 클레임이 있으면 후보가 아니다
         AND NOT EXISTS (
           SELECT 1 FROM claim c WHERE c.task_id = t.id AND c.status = 'active'
         )
       ORDER BY t.priority ASC, t.created_at ASC
       LIMIT ${limit}
    `);
    return rows;
  }

  /**
   * 위임 명세 4요소 검증 — backlog·blocked 밖으로 나가려면 전부 채워져야 한다(§4.1).
   * CHECK 제약이 DB 에서 막지만, 거부 사유를 **누락 요소 이름으로** 돌려주는 것은 여기 몫이다.
   */
  assertDelegationSpec(task: {
    goal_md: string | null;
    output_format_md: string | null;
    tools_sources_md: string | null;
    boundaries_md: string | null;
  }): void {
    const missing = (
      [
        ['goal_md', '목표'],
        ['output_format_md', '산출물 형식'],
        ['tools_sources_md', '도구·출처'],
        ['boundaries_md', '경계'],
      ] as const
    )
      .filter(([field]) => {
        const value = task[field];
        return value === null || value.trim() === '';
      })
      .map(([field, label]) => ({ field, label }));

    if (missing.length > 0) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        `위임 명세 4요소가 비어 있습니다: ${missing.map((m) => m.label).join(', ')}`,
        { kind: 'delegation_spec_incomplete', missing },
      );
    }
  }

  /**
   * 원자적 클레임 — spec-workflow §4.3 의사코드의 직역.
   *
   *   0) 대상 행 FOR UPDATE 잠금        — 중복 클레임을 DB 레벨에서 차단
   *   1) 만료 리스 회수                  — 비교 대상을 살아있는 클레임으로 좁힌다
   *   2) 두 축(스펙·파일)으로 겹침 계산
   *   3) block 이 하나라도 있으면 롤백
   *   4) 조건부 UPDATE ... WHERE status='ready' — 경쟁에서 진 쪽은 affected=0 으로 판별
   *
   * 4단계가 핵심이다. FOR UPDATE 로 직렬화하더라도 조건부 UPDATE 가 없으면 먼저 커밋한 쪽의
   * 전이를 두 번째가 덮어쓴다. 이 두 겹 + 부분 unique(claim_task_active_uq)가 "중복 클레임 0건"이다.
   */
  async claim(input: ClaimInput): Promise<ClaimResult> {
    const ttl = input.leaseSeconds ?? LEASE_TTL_SECONDS;

    return this.events.transact(async (tx, emit) => {
      // 0) 대상 행 잠금
      const { rows: taskRows } = await tx.execute<{
        id: string;
        status: string;
        project_id: string;
        source_requirement_id: string | null;
        goal_md: string | null;
        output_format_md: string | null;
        tools_sources_md: string | null;
        boundaries_md: string | null;
      }>(sql`SELECT * FROM task WHERE id = ${input.taskId} FOR UPDATE`);

      const task = taskRows[0];
      if (task === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, 'Task 를 찾을 수 없습니다.', {
          kind: 'not_found',
          task_id: input.taskId,
        });
      }

      // 같은 세션의 재호출은 기존 클레임을 그대로 돌려준다(멱등 — agent-integration §2.3)
      const existing = await this.findOwnActiveClaim(tx, input.taskId, input.sessionId);
      if (existing !== null) {
        return {
          claimId: existing.claim_id,
          leaseExpiresAt: existing.lease_expires_at,
          warnings: [],
          replayed: true,
        };
      }

      // 1) 만료 리스 회수 — **상태 검사보다 먼저** 한다.
      //
      // spec-workflow §4.3 의사코드는 status 검사(0) 뒤에 회수(1)를 둔다. 그 순서면 리스가
      // 막 만료된 Task 는 여전히 'claimed' 이라 not_ready 로 거부되고, 워커의 lease-reaper 가
      // 돌 때까지 아무도 잡을 수 없다 — 워커가 지연되거나 죽어 있으면 그대로 멈춘다.
      // D-13 의 "사람 개입 0회"는 그 창을 허용하지 않으므로 회수를 앞으로 당긴다.
      // 회수 자체는 이 트랜잭션 안에서 일어나므로 원자성은 그대로다.
      await this.claims.reclaimExpired(tx, task.project_id);

      const { rows: fresh } = await tx.execute<{ status: string }>(
        sql`SELECT status::text AS status FROM task WHERE id = ${input.taskId}`,
      );
      const status = fresh[0]?.status ?? task.status;
      if (status !== 'ready') {
        throw new NervError(NERV_ERROR.PRECONDITION, `Task 가 ready 가 아닙니다(${status}).`, {
          kind: 'not_ready',
          status,
        });
      }
      this.assertDelegationSpec(task);

      // 2) 겹침 계산
      const overlaps = await this.claims.detectOverlaps(tx, {
        projectId: task.project_id,
        sessionId: input.sessionId,
        scope: input.scope,
        sourceRequirementId: task.source_requirement_id,
      });

      // 3) 차단 판정 — 같은 스펙 문서를 두 세션이 동시 개정하는 경우로 한정
      const blocking = overlaps.filter((o) => o.severity === 'block');
      if (blocking.length > 0) {
        // 차단도 사실이므로 기록한다. 롤백되므로 이 이벤트는 별도 트랜잭션에서 남긴다.
        this.logger.warn(`클레임 차단 — task=${input.taskId} 겹침 ${blocking.length}건`);
        throw new NervError(
          NERV_ERROR.CONFLICT_SCOPE,
          '같은 스펙 문서를 다른 세션이 이미 잡고 있습니다.',
          { kind: 'scope_conflict', overlaps: blocking.map(toDetail) },
        );
      }

      // 4) 조건부 전이 — 경쟁에서 진 세션은 여기서 0행으로 판별된다
      const { rows: updated } = await tx.execute<{ id: string }>(sql`
        UPDATE task
           SET status = 'claimed',
               assignee_user_id = COALESCE(assignee_user_id, ${input.userId}),
               delegate_session_id = ${input.sessionId}
         WHERE id = ${input.taskId} AND status = 'ready'
        RETURNING id
      `);
      if (updated.length === 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, '다른 세션이 먼저 클레임했습니다.', {
          kind: 'lost_race',
        });
      }

      const claim = await this.claims.insertClaim(tx, {
        projectId: task.project_id,
        taskId: input.taskId,
        sessionId: input.sessionId,
        userId: input.userId,
        scope: input.scope,
        ttlSeconds: ttl,
      });

      await emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId: task.project_id,
        subjectType: 'task',
        subjectId: input.taskId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId,
        isAgent: input.sessionId !== null,
        fromState: 'ready',
        toState: 'claimed',
      });

      // warn 은 통과시키되 양쪽 세션·담당자에게 알린다(§4.4 단계 3 이후)
      for (const overlap of overlaps.filter((o) => o.severity === 'warn')) {
        await emit({
          type: NERV_EVENT.CLAIM_CONFLICT_WARN,
          projectId: task.project_id,
          subjectType: 'claim',
          subjectId: claim.claimId,
          actorUserId: input.userId,
          actorSessionId: input.sessionId,
          isAgent: input.sessionId !== null,
          payload: { overlap: toDetail(overlap) },
        });
      }

      return {
        claimId: claim.claimId,
        leaseExpiresAt: claim.leaseExpiresAt,
        warnings: overlaps.filter((o) => o.severity !== 'block'),
        replayed: false,
      };
    });
  }

  /**
   * 하트비트 — 리스 연장 + **서버 → 세션 방향의 유일한 보장된 채널**이다(agent-integration §2.4).
   * 질문 답변·steer/stop 지시가 여기 실린다. Claude 의 channel capability 는 향상이고
   * 하트비트가 정본이다(Codex 에는 채널이 없다).
   */
  async heartbeat(input: {
    claimId: string;
    leaseSeconds?: number;
  }): Promise<{ leaseExpiresAt: Date; pending: unknown[] }> {
    return this.db.transaction(async (tx) => {
      const leaseExpiresAt = await this.claims.renewLease(tx, input.claimId, input.leaseSeconds);
      // pending 역채널(질문 답변·steer/stop)은 E13-S02 가 채운다.
      return { leaseExpiresAt, pending: [] };
    });
  }

  /** 클레임 해제 — reason 에 따라 Task 를 ready 로 회수하거나 그대로 둔다. */
  async release(input: {
    claimId: string;
    reason: 'done' | 'handoff' | 'abandon';
    userId: string;
  }): Promise<{ taskStatus: string }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        task_id: string;
        project_id: string;
        agent_session_id: string | null;
      }>(sql`
        UPDATE claim
           SET status = 'released', released_at = now(),
               release_reason = ${input.reason === 'done' ? 'done' : 'manual'}
         WHERE id = ${input.claimId} AND status = 'active'
        RETURNING task_id, project_id, agent_session_id
      `);
      const claim = rows[0];
      if (claim === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, '활성 클레임이 아닙니다.', {
          kind: 'not_active',
          claim_id: input.claimId,
        });
      }

      // done 이 아니면 Task 를 ready 로 되돌린다 — 산출물·Activity 는 보존한다(§4.5)
      let taskStatus = 'unchanged';
      if (input.reason !== 'done') {
        const { rows: t } = await tx.execute<{ status: string }>(sql`
          UPDATE task SET status = 'ready', delegate_session_id = NULL
           WHERE id = ${claim.task_id} AND status IN ('claimed', 'in_progress')
          RETURNING status::text AS status
        `);
        taskStatus = t[0]?.status ?? 'unchanged';
      }

      await emit({
        type: NERV_EVENT.CLAIM_RELEASED,
        projectId: claim.project_id,
        subjectType: 'claim',
        subjectId: input.claimId,
        actorUserId: input.userId,
        actorSessionId: claim.agent_session_id,
        isAgent: claim.agent_session_id !== null,
        payload: { reason: input.reason },
      });

      return { taskStatus };
    });
  }

  /** nerv_task_update · EP-TASK-09 — done 게이트 판정의 단일 지점 */
  transition(): never {
    throw new NotImplementedYetError('E09-S05', 'Task 상태 전이·done 게이트');
  }

  private async findOwnActiveClaim(
    tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
    taskId: string,
    sessionId: string | null,
  ): Promise<{ claim_id: string; lease_expires_at: Date } | null> {
    if (sessionId === null) return null;
    const { rows } = await tx.execute<{ claim_id: string; lease_expires_at: unknown }>(sql`
      SELECT id AS claim_id, lease_expires_at FROM claim
       WHERE task_id = ${taskId} AND agent_session_id = ${sessionId}
         AND status = 'active' AND lease_expires_at > now()
    `);
    const row = rows[0];
    return row === undefined
      ? null
      : { claim_id: row.claim_id, lease_expires_at: toDate(row.lease_expires_at) };
  }
}

/** 겹침을 에러·이벤트 페이로드용으로 평평하게 — 상대 사용자·hostname·scope 를 그대로 싣는다. */
function toDetail(o: Overlap): Record<string, unknown> {
  return {
    claim_id: o.claimId,
    session_id: o.sessionId,
    task_id: o.taskId,
    user_id: o.userId,
    hostname: o.hostname,
    severity: o.severity,
    overlap: { spec_ids: o.specHit, file_globs: o.fileHit },
  };
}
