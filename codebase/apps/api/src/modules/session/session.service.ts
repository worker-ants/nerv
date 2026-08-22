// AgentSession 수명주기 — pending→active↔awaiting_input→complete/error/stale
// 정본: docs/03-proposal/data-model.md §2.5 · FR-07 · D-13
//
// 세션 레지스트리가 서버에 있다는 것이 clemvion 과의 결정적 차이다. clemvion 의 GC reaper 는
// "동시에 열린 다른 세션이 앵커로 쓰는 worktree 의 PR 이 merge 되면 그 세션은 죽는다 —
// 살아있는 세션 앵커 레지스트리가 필요하다"고 한계를 명시했다(spec-workflow §4.5).
// 서버가 모든 세션의 선언을 보면 그 한계는 존재하지 않는다.

import { Injectable, Logger } from '@nestjs/common';
import { NERV_ERROR, NERV_EVENT, SESSION_STALE_SECONDS, newId } from '@nerv/schema';
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
      throw new NervError(NERV_ERROR.PRECONDITION, '세션을 찾을 수 없습니다.', {
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
        throw new NervError(NERV_ERROR.PRECONDITION, '재개할 세션을 찾을 수 없습니다.', {
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
      throw new NervError(NERV_ERROR.PRECONDITION, '프로젝트를 찾을 수 없습니다.', {
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
