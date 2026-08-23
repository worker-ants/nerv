// AgentSession 수명주기 — pending→active↔awaiting_input→complete/error/stale
// 정본: docs/03-proposal/data-model.md §2.5 · FR-07 · D-13
//
// 세션 레지스트리가 서버에 있다는 것이 clemvion 과의 결정적 차이다. clemvion 의 GC reaper 는
// "동시에 열린 다른 세션이 앵커로 쓰는 worktree 의 PR 이 merge 되면 그 세션은 죽는다 —
// 살아있는 세션 앵커 레지스트리가 필요하다"고 한계를 명시했다(spec-workflow §4.5).
// 서버가 모든 세션의 선언을 보면 그 한계는 존재하지 않는다.

import { Injectable, Logger } from '@nestjs/common';
import { msg, newId, NERV_ERROR, NERV_EVENT, SESSION_STALE_SECONDS } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

export type AgentKind = 'claude-code' | 'codex' | 'web' | 'other';

export interface BootstrapInput {
  projectId: string;
  userId: string;
  agentType: AgentKind;
  hostname: string;
  cwd?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  model?: string | null;
  /** 하네스 발급 세션 ID — 훅 페이로드 조인 키이자 멱등 키 */
  externalSessionId?: string | null;
  resumeSessionId?: string | null;
}

export interface ActiveClaimSummary extends Record<string, unknown> {
  claim_id: string;
  task_id: string;
  task_key: string;
  lease_expires_at: string;
  /** 기준 버전·베이스라인 — 구현 컨텍스트가 읽어야 할 스펙을 못박는다(agent-integration §2.4) */
  source_spec_version_id: string | null;
  baseline_id: string | null;
}

/** S5 카드 한 장 — 신원 3요소 + 클레임 + 리스 잔여 + diff (ui-wireframes §3.3) */
export interface SessionCard extends Record<string, unknown> {
  id: string;
  user_name: string;
  hostname: string;
  agent_type: string;
  state: string;
  branch: string | null;
  diff_added: number;
  diff_removed: number;
  last_heartbeat_at: string | null;
  started_at: string;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  claim_id: string | null;
  /** 남은 초 — 카운트다운은 클라이언트 시계가 한다(screens.md §1.4) */
  lease_remaining_seconds: number | null;
  scope_spec_ids: string[];
  scope_file_globs: string[];
}

export interface BootstrapResult {
  session_id: string;
  /** 재호출이면 기존 스냅샷을 그대로 돌려줬다는 표시(멱등) */
  resumed: boolean;
  project: { id: string; key: string; slug: string };
  /** 규약 스펙(convention·vision) 요약 — 세션이 첫 호출로 규약을 읽게 한다 */
  conventions: { id: string; key: string; title: string; type: string }[];
  active_claims: ActiveClaimSummary[];
  gate_policy: Record<string, unknown>;
  constants: { lease_ttl_seconds: number; heartbeat_interval_seconds: number };
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  /** 무활동 초과 시 stale 자동 전이 + 클레임 자동 회수(D-13) */
  readonly staleAfterSeconds = SESSION_STALE_SECONDS;

  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * nerv_bootstrap — 세션 등록 + 컨텍스트 팩.
   *
   * **멱등이다.** 같은 external_session_id·resume_session_id 로 재호출하면 동일 스냅샷을
   * 돌려준다 — 에이전트는 재시작·재연결마다 이것을 첫 도구로 부르기 때문에, 부를 때마다
   * 세션이 늘어나면 보드가 유령 세션으로 뒤덮인다.
   */
  async bootstrap(input: BootstrapInput): Promise<BootstrapResult> {
    const existing = await this.findResumable(input);

    if (existing !== null) {
      return this.pack(existing, input.projectId, true);
    }

    const sessionId = await this.events.transact(async (tx, emit) => {
      const id = newId();
      await tx.execute(sql`
        INSERT INTO agent_session (id, project_id, user_id, agent_type, agent_version, hostname,
                                   cwd, worktree_path, branch, external_session_id, state, model,
                                   last_heartbeat_at)
        VALUES (${id}, ${input.projectId}, ${input.userId}, ${input.agentType}::agent_type, NULL,
                ${input.hostname}, ${input.cwd ?? null}, ${input.worktreePath ?? null},
                ${input.branch ?? null}, ${input.externalSessionId ?? null}, 'active',
                ${input.model ?? null}, now())
      `);

      await emit({
        type: NERV_EVENT.SESSION_STARTED,
        projectId: input.projectId,
        subjectType: 'agent_session',
        subjectId: id,
        actorUserId: input.userId,
        actorSessionId: id,
        isAgent: true,
        toState: 'active',
        payload: { hostname: input.hostname, agent_type: input.agentType },
      });

      return id;
    });

    return this.pack(sessionId, input.projectId, false);
  }

  /** 훅 ingest 와 nerv_session_event 가 **같은 메서드**를 쓴다(api.md §4). */
  async appendActivity(input: {
    sessionId: string;
    projectId: string;
    seq: bigint;
    type: 'thought' | 'action' | 'elicitation' | 'response' | 'error';
    title?: string | null;
    bodyMd?: string | null;
    toolName?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<{ accepted: boolean }> {
    // (session_id, seq) 유일 — 재전송은 조용히 무시한다(멱등, agent-integration §2.3)
    const { rows } = await this.db.execute<{ id: string }>(sql`
      INSERT INTO activity (id, session_id, project_id, seq, type, title, body_md, tool_name, payload)
      VALUES (${newId()}, ${input.sessionId}, ${input.projectId}, ${input.seq.toString()},
              ${input.type}::activity_type, ${input.title ?? null}, ${input.bodyMd ?? null},
              ${input.toolName ?? null}, ${JSON.stringify(input.payload ?? {})}::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    await this.db.execute(
      sql`UPDATE agent_session SET last_heartbeat_at = now() WHERE id = ${input.sessionId}`,
    );
    return { accepted: rows.length > 0 };
  }

  /** 훅이 세션 신원을 조인하는 키 — 하네스가 발급한 external_session_id 다(§3.3). */
  async findByExternalId(projectId: string, externalSessionId: string): Promise<string | null> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM agent_session
       WHERE project_id = ${projectId} AND external_session_id = ${externalSessionId}
       ORDER BY started_at DESC LIMIT 1
    `);
    return rows[0]?.id ?? null;
  }

  /** SessionStart 훅의 additionalContext 재료 — "너는 지금 무엇을 쥐고 있나". */
  async activeClaimSummary(
    sessionId: string,
  ): Promise<{ task_key: string; status: string; lease_expires_at: unknown }[]> {
    const { rows } = await this.db.execute<{
      task_key: string;
      status: string;
      lease_expires_at: unknown;
    }>(sql`
      SELECT t.key AS task_key, t.status::text AS status, c.lease_expires_at
        FROM claim c JOIN task t ON t.id = c.task_id
       WHERE c.agent_session_id = ${sessionId} AND c.status = 'active'
       ORDER BY c.acquired_at
    `);
    return rows;
  }

  /**
   * 훅이 적재하는 Activity — seq 를 서버가 매긴다.
   *
   * MCP `nerv_session_event` 는 에이전트가 seq 를 들고 오지만(멱등 축), 훅은 그렇지 않다.
   * 순서만 지키면 되므로 현재 최대 + 1 을 쓴다 — 훅이 유실돼도 타임라인은 이어진다.
   */
  async appendHookActivity(input: {
    sessionId: string;
    projectId: string;
    type: 'thought' | 'action' | 'elicitation' | 'response' | 'error';
    title: string | null;
    toolName: string | null;
    payload?: Record<string, unknown>;
  }): Promise<{ accepted: boolean }> {
    const { rows } = await this.db.execute<{ next: string }>(
      sql`SELECT coalesce(max(seq), 0) + 1 AS next FROM activity WHERE session_id = ${input.sessionId}`,
    );
    return this.appendActivity({
      sessionId: input.sessionId,
      projectId: input.projectId,
      seq: BigInt(rows[0]?.next ?? '1'),
      type: input.type,
      title: input.title,
      toolName: input.toolName,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    });
  }

  /**
   * SessionEnd — 종료 전이 + **미해제 클레임 회수**.
   *
   * 회수가 이 메서드의 핵심이다: 세션이 끝났는데 클레임이 남으면 그 Task 는 리스 TTL(30분)
   * 동안 아무도 못 잡는다. 끝난 것을 아는 순간 돌려놓는 것이 D-13 의 취지다.
   */
  async finish(input: {
    sessionId: string;
    projectId: string;
    reason: 'complete' | 'error';
    userId: string;
  }): Promise<{ state: string; reclaimed: number }> {
    return this.events.transact(async (tx, emit) => {
      await tx.execute(sql`
        UPDATE agent_session
           SET state = ${input.reason}::session_state, ended_at = now(),
               end_reason = ${input.reason}::session_end_reason
         WHERE id = ${input.sessionId} AND project_id = ${input.projectId}
      `);

      const { rows: released } = await tx.execute<{ id: string; task_id: string }>(sql`
        UPDATE claim SET status = 'released', released_at = now(), release_reason = 'manual'
         WHERE agent_session_id = ${input.sessionId} AND status = 'active'
        RETURNING id, task_id
      `);
      for (const claim of released) {
        await tx.execute(sql`
          UPDATE task SET status = 'ready', delegate_session_id = NULL, updated_at = now()
           WHERE id = ${claim.task_id} AND status IN ('claimed', 'in_progress')
        `);
        await emit({
          type: NERV_EVENT.CLAIM_RELEASED,
          projectId: input.projectId,
          subjectType: 'claim',
          subjectId: claim.id,
          actorUserId: input.userId,
          actorSessionId: input.sessionId,
          isAgent: true,
          payload: { reason: 'session_end' },
        });
      }

      await emit({
        type: input.reason === 'error' ? NERV_EVENT.SESSION_COMPLETE : NERV_EVENT.SESSION_COMPLETE,
        projectId: input.projectId,
        subjectType: 'agent_session',
        subjectId: input.sessionId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId,
        isAgent: true,
        toState: input.reason,
      });

      return { state: input.reason, reclaimed: released.length };
    });
  }

  /**
   * EP-SES-04 — steer/stop. **사람이 달리는 세션에 개입하는 유일한 경로**다(FR-08).
   *
   * 지시는 `activity`(type=elicitation)에 적재한다 — 새 테이블을 만들지 않는 이유는 지시가
   * 곧 세션 타임라인의 사건이기 때문이다. S5 의 Activity 타임라인에 사람의 개입이
   * 에이전트의 행동과 같은 줄에 섞여 보이는 것이 맞다(ui-wireframes §2.5).
   * 전달은 하트비트 역채널이다(agent-integration §2.4) — 서버가 세션에 push 할 경로가 없고,
   * 있더라도 에이전트가 도구 호출 사이에서만 지시를 받을 수 있다.
   *
   * **stop 은 전달을 기다리지 않는다.** 지시가 도달하든 말든 서버가 즉시 클레임을 회수하고
   * Task 를 ready 로 되돌린다 — 세션이 이미 죽어 있어서 하트비트를 못 치는 경우가
   * stop 을 누르는 가장 흔한 이유이기 때문이다(ui-wireframes §4.2).
   */
  async steer(input: {
    projectId: string;
    sessionId: string;
    kind: 'steer' | 'stop';
    message: string;
    userId: string;
  }): Promise<{ ok: true; kind: string; reclaimed: number }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ id: string; user_id: string; state: string }>(sql`
        SELECT id, user_id, state::text AS state FROM agent_session
         WHERE id = ${input.sessionId} AND project_id = ${input.projectId}
      `);
      const session = rows[0];
      if (session === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.session.not_found'), {
          kind: 'not_found',
          session_id: input.sessionId,
        });
      }

      const { rows: seqRow } = await tx.execute<{ next: string }>(
        sql`SELECT coalesce(max(seq), 0) + 1 AS next FROM activity WHERE session_id = ${session.id}`,
      );
      await tx.execute(sql`
        INSERT INTO activity (id, session_id, project_id, seq, type, title, body_md, payload)
        VALUES (${newId()}, ${session.id}, ${input.projectId}, ${seqRow[0]?.next ?? '1'},
                'elicitation', ${input.kind}, ${input.message},
                ${JSON.stringify({ kind: input.kind, delivered: false, by: input.userId })}::jsonb)
      `);

      let reclaimed = 0;
      if (input.kind === 'stop') {
        const { rows: released } = await tx.execute<{ id: string; task_id: string }>(sql`
          UPDATE claim SET status = 'released', released_at = now(), release_reason = 'manual'
           WHERE agent_session_id = ${session.id} AND status = 'active'
          RETURNING id, task_id
        `);
        for (const claim of released) {
          await tx.execute(sql`
            UPDATE task SET status = 'ready', updated_at = now()
             WHERE id = ${claim.task_id} AND status IN ('claimed', 'in_progress')
          `);
          await emit({
            type: NERV_EVENT.CLAIM_RELEASED,
            projectId: input.projectId,
            subjectType: 'claim',
            subjectId: claim.id,
            actorUserId: input.userId,
            isAgent: false,
            payload: { reason: 'stopped_by_human' },
          });
          await emit({
            type: NERV_EVENT.TASK_READY,
            projectId: input.projectId,
            subjectType: 'task',
            subjectId: claim.task_id,
            actorUserId: input.userId,
            isAgent: false,
            toState: 'ready',
          });
        }
        reclaimed = released.length;
      }

      await emit({
        type: NERV_EVENT.SESSION_STEERED,
        projectId: input.projectId,
        subjectType: 'agent_session',
        subjectId: session.id,
        actorUserId: input.userId,
        isAgent: false,
        payload: { kind: input.kind, reclaimed },
      });

      return { ok: true, kind: input.kind, reclaimed };
    });
  }

  /**
   * 하트비트 역채널에 실을 미전달 지시 — 실은 즉시 전달 표시를 남긴다.
   * 두 번 전달하면 에이전트가 같은 지시를 두 번 따른다.
   */
  async takePendingInstructions(sessionId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE activity SET payload = jsonb_set(payload, '{delivered}', 'true')
       WHERE session_id = ${sessionId} AND type = 'elicitation'
         AND payload->>'delivered' = 'false'
      RETURNING payload->>'kind' AS kind, title, body_md AS message
    `);
    return rows;
  }

  /** EP-SES-02 — 실행 컨텍스트·클레임 이력·토큰 사용량. */
  async detail(input: { projectId: string; sessionId: string }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT se.*, se.state::text AS state, se.agent_type::text AS agent_type,
             u.display_name AS user_display_name, t.key AS current_task_key
        FROM agent_session se
        JOIN "user" u ON u.id = se.user_id
   LEFT JOIN task t ON t.id = se.current_task_id
       WHERE se.project_id = ${input.projectId}
         AND (se.id::text = ${input.sessionId} OR se.external_session_id = ${input.sessionId})
    `);
    const session = rows[0];
    if (session === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.session.not_found'), {
        kind: 'not_found',
        session_id: input.sessionId,
      });
    }
    const { rows: claims } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.status::text AS status, c.acquired_at, c.released_at,
             c.release_reason::text AS release_reason, t.key AS task_key, t.title AS task_title
        FROM claim c JOIN task t ON t.id = c.task_id
       WHERE c.agent_session_id = ${session['id'] as string}
       ORDER BY c.acquired_at DESC
    `);
    return { ...session, claims };
  }

  /** EP-SES-03 — seq 순 타임라인. */
  async timeline(input: {
    projectId: string;
    sessionId: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.seq, a.type::text AS type, a.title, a.body_md, a.tool_name, a.payload,
             a.created_at
        FROM activity a JOIN agent_session se ON se.id = a.session_id
       WHERE se.project_id = ${input.projectId}
         AND (se.id::text = ${input.sessionId} OR se.external_session_id = ${input.sessionId})
       ORDER BY a.seq DESC
       LIMIT ${Math.min(input.limit ?? 200, 500)}
    `);
    return rows.reverse();
  }

  /**
   * 무활동 세션의 stale 전이 + 클레임 회수 — 워커의 session-stale 잡이 부른다(D-13).
   * "죽은 세션 정리를 사람이 감시하지 않게" 하는 것이 이 잡의 목적이다.
   */
  async markStale(): Promise<number> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ id: string; project_id: string; user_id: string }>(sql`
        UPDATE agent_session
           SET state = 'stale', ended_at = now(), end_reason = 'stale'
         WHERE state IN ('pending', 'active', 'awaiting_input')
           AND coalesce(last_heartbeat_at, started_at)
               < now() - ${sql.raw(`interval '${SESSION_STALE_SECONDS} seconds'`)}
        RETURNING id, project_id, user_id
      `);

      for (const session of rows) {
        await emit({
          type: NERV_EVENT.SESSION_STALE,
          projectId: session.project_id,
          subjectType: 'agent_session',
          subjectId: session.id,
          actorUserId: session.user_id,
          actorSessionId: session.id,
          isAgent: true,
          toState: 'stale',
        });
      }
      return rows.length;
    });
  }

  /**
   * S5 세션 보드 — EP-SES-01. **읽기 전용 축소판**이 Phase 0 범위다(steer/stop 은 E08-S06).
   *
   * 카드가 반드시 실어야 하는 것은 신원 3요소(사용자·hostname·에이전트 종류)와
   * 하트비트·리스 잔여·diff 다(ui-wireframes §3.3). 그중 hostname 이 P8("누구의 어느 머신인가")의
   * 핵심 필드라 NOT NULL 이고, 없는 세션은 화면이 렌더링하지 않는다(REQ-WEB-019).
   *
   * 리스 잔여는 서버가 남은 초를 주고 카운트다운은 클라이언트 시계가 한다(screens.md §1.4) —
   * 매초 서버에 묻지 않기 위해서다.
   */
  async board(input: { projectId: string; states?: string[] }): Promise<SessionCard[]> {
    const stateFilter =
      input.states === undefined || input.states.length === 0
        ? sql``
        : sql` AND s.state = ANY(${sql.raw(`ARRAY[${input.states.map((v) => `'${v}'`).join(',')}]::session_state[]`)})`;

    const { rows } = await this.db.execute<SessionCard>(sql`
      SELECT s.id, u.display_name AS user_name, s.hostname,
             s.agent_type::text AS agent_type, s.state::text AS state,
             s.branch, s.diff_added, s.diff_removed,
             s.last_heartbeat_at::text AS last_heartbeat_at,
             s.started_at::text AS started_at,
             t.id AS task_id, t.key AS task_key, t.title AS task_title,
             c.id AS claim_id,
             GREATEST(0, EXTRACT(EPOCH FROM (c.lease_expires_at - now()))::int) AS lease_remaining_seconds,
             coalesce(c.scope_spec_ids, '{}')::text[]  AS scope_spec_ids,
             coalesce(c.scope_file_globs, '{}')::text[] AS scope_file_globs
        FROM agent_session s
        JOIN "user" u ON u.id = s.user_id
   LEFT JOIN claim c ON c.agent_session_id = s.id AND c.status = 'active'
   LEFT JOIN task t ON t.id = c.task_id
       WHERE s.project_id = ${input.projectId}${stateFilter}
       ORDER BY s.last_heartbeat_at DESC NULLS LAST, s.started_at DESC
       LIMIT 200
    `);
    return rows;
  }

  /** 요약 스트립 — 상태별 집계(screens.md §2.6) */
  async boardSummary(projectId: string): Promise<Record<string, number>> {
    const { rows } = await this.db.execute<{ state: string; n: number }>(sql`
      SELECT state::text AS state, count(*)::int AS n
        FROM agent_session WHERE project_id = ${projectId} GROUP BY state
    `);
    return Object.fromEntries(rows.map((r) => [r.state, r.n]));
  }

  async requireSession(sessionId: string, projectId: string): Promise<void> {
    const { rows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM agent_session WHERE id = ${sessionId} AND project_id = ${projectId}`,
    );
    if (rows.length === 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.session.not_found'), {
        kind: 'not_found',
        session_id: sessionId,
      });
    }
  }

  private async findResumable(input: BootstrapInput): Promise<string | null> {
    if (input.resumeSessionId != null) {
      const { rows } = await this.db.execute<{ id: string }>(
        sql`SELECT id FROM agent_session WHERE id = ${input.resumeSessionId} AND project_id = ${input.projectId}`,
      );
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.session.resume_not_found'), {
          kind: 'not_found',
          session_id: input.resumeSessionId,
        });
      }
      return id;
    }
    if (input.externalSessionId != null) {
      const { rows } = await this.db.execute<{ id: string }>(sql`
        SELECT id FROM agent_session
         WHERE project_id = ${input.projectId} AND external_session_id = ${input.externalSessionId}
      `);
      return rows[0]?.id ?? null;
    }
    return null;
  }

  /** 컨텍스트 팩 — 세션이 첫 호출로 받아야 할 것들. */
  private async pack(
    sessionId: string,
    projectId: string,
    resumed: boolean,
  ): Promise<BootstrapResult> {
    const { rows: projectRows } = await this.db.execute<{
      id: string;
      key: string;
      slug: string;
      gate_policy: Record<string, unknown>;
    }>(sql`SELECT id, key, slug, gate_policy FROM project WHERE id = ${projectId}`);
    const project = projectRows[0];
    if (project === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
        kind: 'not_found',
      });
    }

    // 규약 스펙 — convention·vision 타입만. 세션이 규약을 모른 채 시작하지 않게 한다.
    const { rows: conventions } = await this.db.execute<{
      id: string;
      key: string;
      title: string;
      type: string;
    }>(sql`
      SELECT id, key, title, type::text AS type FROM spec
       WHERE project_id = ${projectId} AND archived_at IS NULL
         AND type IN ('convention', 'vision')
       ORDER BY sort_key, key
    `);

    // 내 활성 클레임 — 기준 버전·베이스라인을 함께 싣는다(agent-integration §2.4)
    const { rows: claims } = await this.db.execute<ActiveClaimSummary>(sql`
      SELECT c.id AS claim_id, c.task_id, t.key AS task_key,
             c.lease_expires_at::text AS lease_expires_at,
             t.source_spec_version_id, t.baseline_id
        FROM claim c JOIN task t ON t.id = c.task_id
       WHERE c.agent_session_id = ${sessionId} AND c.status = 'active'
       ORDER BY c.acquired_at
    `);

    return {
      session_id: sessionId,
      resumed,
      project: { id: project.id, key: project.key, slug: project.slug },
      conventions,
      active_claims: claims,
      gate_policy: project.gate_policy ?? {},
      constants: {
        lease_ttl_seconds: SESSION_STALE_SECONDS,
        heartbeat_interval_seconds: 60,
      },
    };
  }
}
