// AgentSession 수명주기 — pending→active↔awaiting_input→complete/error/stale
// 정본: docs/03-proposal/data-model.md §2.5 · FR-07 · D-13
//
// 세션 레지스트리가 서버에 있다는 것이 clemvion 과의 결정적 차이다. clemvion 의 GC reaper 는
// "동시에 열린 다른 세션이 앵커로 쓰는 worktree 의 PR 이 merge 되면 그 세션은 죽는다 —
// 살아있는 세션 앵커 레지스트리가 필요하다"고 한계를 명시했다(spec-workflow §4.5).
// 서버가 모든 세션의 선언을 보면 그 한계는 존재하지 않는다.

import { Injectable, Logger } from '@nestjs/common';
import {
  msg,
  newId,
  NERV_ERROR,
  NERV_EVENT,
  sessionState,
  SESSION_STALE_SECONDS,
} from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { sqlArray, sqlSeconds } from '../../common/sql-array.js';
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

/** 세션 추정의 후보 한 줄 — 여럿일 때 에이전트가 고를 수 있도록 신원을 함께 준다 */
export interface SessionCandidate extends Record<string, unknown> {
  session_id: string;
  hostname: string;
  agent_type: string;
  last_seen_at: string;
}

/**
 * 상태 필터는 **어휘 안에서만** 받는다 — 모르는 값은 거절이지 무시가 아니다.
 *
 * 판정이 서비스에 있는 이유는 D-05 다: 표면이 늘어도 "무엇이 상태인가"의 답은 한 곳이다.
 * 어휘의 정본은 `session_state` enum 이고(`@nerv/schema`), 여기서 목록을 다시 적지 않는다.
 * 값 자체는 이제 파라미터로 바인딩되므로(`sqlArray`) 이 검사는 두 번째 방어선이다 —
 * 첫 번째는 "조립하지 않는다"이고, 이것은 "필터가 거짓말하지 않는다"를 지킨다.
 */
function assertSessionStates(values: readonly string[]): string[] {
  const allowed = sessionState.enumValues as readonly string[];
  const unknown = values.filter((v) => !allowed.includes(v));
  if (unknown.length > 0) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
      kind: 'invalid_input',
      field: 'state',
      unknown,
      allowed,
    });
  }
  return [...values];
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
      // **재개는 되살리는 것이다.** stale 로 쓸려 간 세션을 그대로 두고 `resumed: true` 만
      // 돌려주면, 그 세션은 살아 있다고 말하면서 죽은 상태로 남는다 — 세션 추정(§1.4c)도
      // 그 세션을 찾지 못해 에이전트가 bootstrap 과 실패를 무한히 오간다.
      await this.db.execute(sql`
        UPDATE agent_session
           SET state = 'active', ended_at = NULL, end_reason = NULL, last_heartbeat_at = now()
         WHERE id = ${existing} AND state <> 'active'
      `);
      // **훅이 모르는 것을 여기서 채운다.** 훅 페이로드에는 branch·worktree·model 이 없어
      // 훅이 만든 세션은 신원 3요소(§1.4c)가 비어 있다 — 실측 2026-09-03: 실사용 세션
      // 34개 전부에서 셋이 NULL 이었고, 세션 카드가 "누구의 무엇"에 답하지 못했다.
      // `coalesce` 라 **덮어쓰지 않는다**: 이미 채워진 값은 그 세션이 말한 자기 자신이다.
      await this.db.execute(sql`
        UPDATE agent_session
           SET branch = coalesce(branch, ${input.branch ?? null}::text),
               worktree_path = coalesce(worktree_path, ${input.worktreePath ?? null}::text),
               model = coalesce(model, ${input.model ?? null}::text),
               cwd = coalesce(cwd, ${input.cwd ?? null}::text)
         WHERE id = ${existing}
      `);
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
   * 훅이 세션 신원을 조인하는 키 — 하네스가 발급한 external_session_id 다(§3.3).
   *
   * **소유자도 함께 본다.** external id 는 비밀이 아니다: EP-SES-02 상세와 EP-EVT-01 피드,
   * 작업 화면이 그대로 싣는 값이다. 그래서 예전에는 같은 프로젝트에 PAT 를 가진 다른 멤버가
   * 그 값 하나로 남의 세션을 끝내고(활성 클레임이 전부 회수된다) 남의 타임라인에 활동을
   * 적재할 수 있었다. 신원은 **토큰에서 온다**(D-08) — 컨트롤러 머리 주석이 처음부터
   * 그렇게 적고 있었고, 조인만 그 말을 따르지 않았다.
   */
  async findByExternalId(
    projectId: string,
    externalSessionId: string,
    userId: string,
  ): Promise<string | null> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM agent_session
       WHERE project_id = ${projectId} AND external_session_id = ${externalSessionId}
         AND user_id = ${userId}
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
    // **번호 매기기와 쓰기가 한 문장이다.** 예전에는 `max(seq)+1` 을 읽고 따로 INSERT 했다 —
    // 훅은 병렬로 도착하고(PostToolUse 는 async 다) 두 요청이 같은 번호를 읽으면 뒤엣것이
    // `(session_id, seq)` 유니크에 걸려 `ON CONFLICT DO NOTHING` 으로 **조용히 사라졌다**.
    // 응답은 그때도 성공이었다. 세션 단위 advisory lock 으로 그 구간을 직렬화한다 —
    // 락의 범위는 트랜잭션이고, 같은 세션의 훅끼리만 기다린다.
    const { rows } = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.sessionId}::text, 0))`,
      );
      return tx.execute<{ id: string }>(sql`
        INSERT INTO activity (id, session_id, project_id, seq, type, title, tool_name, payload)
        SELECT ${newId()}, ${input.sessionId}, ${input.projectId},
               coalesce(max(seq), 0) + 1, ${input.type}::activity_type,
               ${input.title}, ${input.toolName},
               ${JSON.stringify(input.payload ?? {})}::jsonb
          FROM activity WHERE session_id = ${input.sessionId}
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
    });

    await this.db.execute(
      sql`UPDATE agent_session SET last_heartbeat_at = now() WHERE id = ${input.sessionId}`,
    );
    return { accepted: rows.length > 0 };
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
    /** 전표의 "세션 소유자·admin"(EP-SES-04). 없으면 소유자 판정만 한다 */
    isAdmin?: boolean;
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

      // 남의 세션을 멈추는 것은 남의 클레임을 회수하는 것이다(stop 이 그렇게 한다) —
      // 전표는 이 문을 세션 소유자와 admin 에게만 열어 두었다(EP-SES-04).
      if (session.user_id !== input.userId && input.isAdmin !== true) {
        throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.session.not_owner'), {
          kind: 'not_owner',
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
    /** 보는 사람 — 원문 열람 판정의 축이다. 주지 않으면 요약만 준다 */
    userId?: string | null;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    // **원문은 세션 본인과 admin 만 본다**(2026-09-01 사람 결정 · REQ-API-066).
    //
    // 마스킹은 휴리스틱이라 완벽하지 않다 — 이름도 모양도 없는 비밀은 못 잡는다. 그래서
    // 가리는 것과 좁히는 것을 **함께** 둔다. 요약 줄(무슨 도구로 무엇을, 성공했나)은
    // 프로젝트 멤버 전체가 본다: 그것까지 가리면 세션 모니터가 서지 않는다.
    //
    // **판정은 SQL 안이다.** 응답을 만들고 나서 지우면 그 사이의 어떤 경로가 원문을 흘린다.
    const viewer = input.userId ?? null;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      WITH viewer AS (
        SELECT ${viewer}::uuid AS user_id
      )
      SELECT a.id, a.seq, a.type::text AS type, a.title, a.body_md, a.tool_name,
             a.created_at,
             CASE WHEN ${this.canSeeRaw()} THEN a.payload
                  ELSE jsonb_strip_nulls(jsonb_build_object(
                         'tool_use_id', a.payload -> 'tool_use_id',
                         'ok', a.payload -> 'ok',
                         'outcome', a.payload -> 'outcome'))
             END AS payload,
             ${this.canSeeRaw()} AS raw_visible
        FROM activity a
        JOIN agent_session se ON se.id = a.session_id
        JOIN project p ON p.id = se.project_id
       CROSS JOIN viewer v
       WHERE se.project_id = ${input.projectId}
         AND (se.id::text = ${input.sessionId} OR se.external_session_id = ${input.sessionId})
       ORDER BY a.seq DESC
       LIMIT ${Math.min(input.limit ?? 200, 500)}
    `);
    return rows.reverse();
  }

  /**
   * EP-SES-05 — 세션의 **작업 궤적** (2026-09-01 신설 · REQ-API-068).
   *
   * 세션 모니터가 답해야 하는 물음은 "무슨 도구를 썼나" 가 아니라 **"무엇을 하는 중이고
   * 막혀 있나"** 다. 도구 로그는 그 아래 접히는 것이고, 위에 서야 하는 것은 이쪽이다.
   *
   * **새로 저장하는 것이 없다.** 이벤트가 이미 세션 id 를 달고 있으므로(`actor_session_id`)
   * 질의만 있으면 된다 — 스펙을 저장했고, 제출했고, 질문을 던졌고, 발견을 올렸다는 사실이
   * 전부 거기 있다. 세션 축으로 읽은 적이 없었을 뿐이다.
   */
  async trajectory(input: {
    projectId: string;
    sessionId: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    // **키는 봉투에만 있고 행에는 없다.** `event` 는 subject_id 만 들고 있으므로 여기서
    // 되찾는다 — 화면이 읽는 것은 UUID 가 아니라 `SUD-AREA-PLAY` 다.
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT e.id, e.type, e.subject_type, e.subject_id,
             coalesce(s.key, t.key) AS subject_key,
             e.from_state, e.to_state, e.payload, e.occurred_at
        FROM event e
        JOIN agent_session se ON se.id = e.actor_session_id
   LEFT JOIN spec_version sv ON sv.id = e.subject_id AND e.subject_type = 'spec_version'
   LEFT JOIN spec s ON s.id = sv.spec_id
   LEFT JOIN task t ON t.id = e.subject_id AND e.subject_type = 'task'
       WHERE se.project_id = ${input.projectId}
         AND (se.id::text = ${input.sessionId} OR se.external_session_id = ${input.sessionId})
         -- 세션 자신의 생애(started·stale·complete)는 카드가 이미 말한다 — 궤적은 **한 일**이다
         AND e.type NOT LIKE 'session.%'
       ORDER BY e.occurred_at DESC
       LIMIT ${Math.min(input.limit ?? 50, 200)}
    `);
    return rows.reverse();
  }

  /** 세션 본인이거나, 그 프로젝트·조직의 admin 인가 — 조직 단위 멤버십도 본다 */
  private canSeeRaw(): SQL {
    // **`coalesce` 가 없으면 안 본 사람에게 NULL 이 간다.** SQL 의 3값 논리에서
    // `NULL = uuid` 는 false 가 아니라 NULL 이고, 화면은 그것을 "모름" 으로 받는다 —
    // 권한 판정에 "모름" 은 없다. 닫힘이 기본이다.
    return sql`coalesce(
      se.user_id = v.user_id
      OR EXISTS (SELECT 1 FROM membership m
                  WHERE m.user_id = v.user_id AND m.role = 'admin'
                    AND (m.project_id = se.project_id
                         OR (m.project_id IS NULL AND m.org_id = p.org_id)))
    , false)`;
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
               < now() - ${sqlSeconds(SESSION_STALE_SECONDS)}
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
    const states = assertSessionStates(input.states ?? []);
    const stateFilter =
      states.length === 0 ? sql`` : sql` AND s.state = ANY(${sqlArray(states, 'session_state')})`;

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

  /**
   * 이 호출이 **어느 세션의 일인가** — 도구가 `session_id` 를 주지 않았을 때의 추정(§1.4c).
   *
   * 카탈로그(3.4 §2.3)는 `nerv_bootstrap` 외의 도구에 `session_id` 를 적지 않는다. 서버가
   * 안다는 뜻이었는데 **그 절반이 구현돼 있지 않았다** — 그래서 세션을 요구하는 도구
   * (`nerv_question_create`·`nerv_task_claim`·`nerv_session_event`)는 스키마대로 부르면
   * 언제나 `session_required` 였다(실측 2026-08-29).
   *
   * **여럿이면 고르지 않는다.** 잘못 고르면 남의 세션에 질문과 클레임이 붙고, 클레임은
   * 세션 단위로 겹침을 판정하므로(scope 충돌) 조용한 오귀속이 곧 잘못된 충돌 판정이 된다.
   * 후보를 그대로 돌려주고 부르는 쪽이 `session_id` 를 요구하게 한다.
   */
  async liveSessions(projectId: string, userId: string): Promise<SessionCandidate[]> {
    const { rows } = await this.db.execute<SessionCandidate>(sql`
      SELECT id AS session_id, hostname, agent_type::text AS agent_type,
             coalesce(last_heartbeat_at, started_at)::text AS last_seen_at
        FROM agent_session
       WHERE project_id = ${projectId} AND user_id = ${userId}
         AND state IN ('pending', 'active', 'awaiting_input')
         AND coalesce(last_heartbeat_at, started_at)
             > now() - ${sqlSeconds(SESSION_STALE_SECONDS)}
       ORDER BY coalesce(last_heartbeat_at, started_at) DESC
    `);
    return rows;
  }

  /**
   * 도구 호출은 **생존의 증거다.** 하트비트는 클레임을 쥔 세션만 치므로, 스펙만 쓰는
   * 세션은 30분 뒤 stale 로 쓸려 가고 그때부터 자기 도구를 못 쓴다(실측 시나리오).
   */
  async touch(sessionId: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE agent_session SET last_heartbeat_at = now() WHERE id = ${sessionId}`,
    );
  }

  /**
   * 명시된 세션이 **이 프로젝트의, 이 사람의** 세션인가.
   *
   * 사용자를 함께 보는 이유: 존재만 확인하면 같은 프로젝트의 **남의 세션 id** 를 실어
   * 질문·클레임을 그쪽에 붙일 수 있다. 감사(FR-16)가 "누가 했나"에 답하려면 이 자리가
   * 먼저 답해야 한다.
   */
  async requireSession(sessionId: string, projectId: string, userId?: string): Promise<void> {
    const owner = userId === undefined ? sql`` : sql` AND user_id = ${userId}`;
    const { rows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM agent_session WHERE id = ${sessionId} AND project_id = ${projectId}${owner}`,
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
    return this.adoptHookSession(input);
  }

  /**
   * 훅이 먼저 만든 세션을 **채택한다**(2026-09-03).
   *
   * 이것이 없는 동안 기본 설치는 세션을 둘 만들었다: SessionStart 훅이 하네스의
   * `session_id` 로 세션 A 를, 스킬의 `nerv_bootstrap` 이 그 id 없이 세션 B 를 만들었다.
   * 그러면 `nerv_task_claim` 은 살아 있는 세션이 둘이라 `session_ambiguous` 로 거부되고,
   * Stop 게이트·SessionEnd 회수는 external id 로 A 만 찾아 클레임과 훅 평면이 갈라진다.
   * **실측(2026-09-03): 실사용 세션 34개가 만든 클레임이 0건이었고, 같은 사용자·같은
   * cwd 에 살아 있는 세션이 둘 이상인 순간이 10번 있었다.**
   *
   * 채택이 유일한 길인 이유: 반대 방향 — 스킬이 `session_id` 를 싣는 것 — 은 막혀 있다.
   * Claude Code 는 모델에게 자기 `session_id` 를 주지 않는다(훅 페이로드와 statusline
   * stdin 에만 있다). 그래서 **서버가 알아보는 쪽**이 되어야 한다.
   *
   * 대조 조건은 신원 3요소 중 서버가 양쪽에서 받을 수 있는 것들이다 — 같은 사람(D-08)·
   * 같은 프로젝트·같은 hostname, 그리고 bootstrap 이 cwd 를 말했으면 같은 cwd. 훅이 만든
   * 세션(`external_session_id IS NOT NULL`)만 채택 대상이다: MCP 가 만든 세션까지 삼키면
   * 서로 다른 두 스킬 세션이 한 몸이 된다. 여럿이면 **가장 최근 것**을 고른다 — bootstrap 은
   * SessionStart 직후에 오므로 마지막에 열린 세션이 곧 지금 그 세션이다.
   */
  private async adoptHookSession(input: BootstrapInput): Promise<string | null> {
    const sameCwd = input.cwd == null ? sql`` : sql` AND cwd = ${input.cwd}`;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM agent_session
       WHERE project_id = ${input.projectId} AND user_id = ${input.userId}
         AND external_session_id IS NOT NULL
         AND hostname = ${input.hostname}${sameCwd}
         AND state IN ('pending', 'active', 'awaiting_input')
         AND coalesce(last_heartbeat_at, started_at)
             > now() - ${sqlSeconds(SESSION_STALE_SECONDS)}
       ORDER BY coalesce(last_heartbeat_at, started_at) DESC
       LIMIT 1
    `);
    const adopted = rows[0]?.id ?? null;
    if (adopted !== null) {
      this.logger.log(`훅 세션 채택 — host=${input.hostname} session=${adopted}`);
    }
    return adopted;
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
