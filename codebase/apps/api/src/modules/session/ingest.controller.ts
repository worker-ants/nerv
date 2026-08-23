// 훅 수집기 — POST /ingest/hooks/{session,tool,subagent,stop,session-end}
// 정본: agent-integration.md §3.3 · api.md §2.9
//
// **훅은 텔레메트리 평면이다.** 끊겨도 세션은 진행되고 게이트는 서버가 유지한다 — 그래서
// 여기서 하는 일은 "받은 사실을 적재"까지이고, 실패해도 에이전트를 멈추지 않는다.
// 유일한 예외가 Stop 훅이다: 턴 종료 직전의 **동기 판정** 경로라 202 가 아니라 200 + 결정이다.
//
// 인증은 PAT Bearer — 토큰 없는 이벤트는 버린다(§6.5). 훅 페이로드는 **비신뢰 입력**이라
// 세션 신원을 페이로드가 아니라 토큰에서 가져온다(D-08): 페이로드의 user 를 믿으면
// 훅 하나로 남의 세션을 조작할 수 있다.

import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { AuthService } from '../auth/auth.service.js';
import { SessionService } from './session.service.js';
import type { Principal } from '../auth/auth.service.js';

interface HookRequest {
  nervPrincipal?: Principal;
}

/** Claude Code 훅의 공통 페이로드(§3.3 각주) + NERV 가 읽는 필드. */
interface HookPayload extends Record<string, unknown> {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_use_id?: string;
  agent_type?: string;
  agent_id?: string;
  reason?: string;
  source?: string;
}

@Controller('ingest/hooks')
export class IngestController {
  // 표면은 번역만 — 세션 상태 관리는 SessionService 한 곳이 한다(D-05).
  constructor(
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  /**
   * SessionStart — AgentSession 등록. 응답의 `additionalContext` 로 현재 클레임을 주입한다.
   *
   * 이 주입이 훅의 값어치다: 세션이 시작하자마자 "너는 지금 TSK-a3f8 을 쥐고 있다"를
   * 알려주면, 에이전트가 그것을 다시 물어보거나(왕복) 잊고 새 작업을 잡는 일이 줄어든다.
   */
  @Post('session')
  @HttpCode(HttpStatus.ACCEPTED)
  async session(
    @Req() req: HookRequest,
    @Headers('x-nerv-host') host: string | undefined,
    @Body() body: HookPayload,
  ): Promise<{ ok: true; session_id: string; additionalContext: string }> {
    const principal = requireAgent(req);
    const result = await this.sessions.bootstrap({
      projectId: principal.projectId ?? '',
      userId: principal.userId,
      agentType: normalizeAgentType(body.agent_type),
      hostname: host ?? String(body['hostname'] ?? 'unknown'),
      cwd: body.cwd ?? null,
      externalSessionId: body.session_id ?? null,
    });

    const claims = await this.sessions.activeClaimSummary(result.session_id);
    return {
      ok: true,
      session_id: result.session_id,
      additionalContext:
        claims.length === 0
          ? 'NERV: 활성 클레임 없음 — /nerv:next 로 시작하세요.'
          : `NERV: 활성 클레임 ${claims.map((c) => `${c.task_key}(${c.status})`).join(', ')}. ` +
            '새로 클레임하지 말고 이어서 진행하세요.',
    };
  }

  /** PostToolUse — Activity 적재. 관찰 전용이라 실패해도 202 다. */
  @Post('tool')
  @HttpCode(HttpStatus.ACCEPTED)
  async tool(@Req() req: HookRequest, @Body() body: HookPayload): Promise<{ ok: boolean }> {
    const principal = requireAgent(req);
    const sessionId = await this.resolveSession(principal, body);
    if (sessionId === null) return { ok: false };

    await this.sessions.appendHookActivity({
      sessionId,
      projectId: principal.projectId ?? '',
      type: 'action',
      title: body.tool_name ?? 'tool',
      toolName: body.tool_name ?? null,
      // 훅 페이로드 원문을 통째로 넣지 않는다 — 개인정보·비밀이 섞일 수 있고, 여기 목적은
      // "무엇을 했나"의 타임라인이지 전체 로그 보관이 아니다(D-07).
      payload: { tool_use_id: body.tool_use_id ?? null },
    });
    return { ok: true };
  }

  /** SubagentStart/Stop — 어느 역할 에이전트가 무엇을 했는지. 관찰 전용. */
  @Post('subagent')
  @HttpCode(HttpStatus.ACCEPTED)
  async subagent(@Req() req: HookRequest, @Body() body: HookPayload): Promise<{ ok: boolean }> {
    const principal = requireAgent(req);
    const sessionId = await this.resolveSession(principal, body);
    if (sessionId === null) return { ok: false };

    await this.sessions.appendHookActivity({
      sessionId,
      projectId: principal.projectId ?? '',
      type: 'thought',
      title: `subagent:${body.agent_type ?? body.agent_id ?? 'unknown'}`,
      toolName: null,
      payload: { agent_id: body.agent_id ?? null },
    });
    return { ok: true };
  }

  /**
   * Stop — 턴 종료 직전 **동기 판정**. 서버가 `{"decision":"block"}` 을 주면 종료가 막힌다.
   *
   * MVP 의 판정은 하나다: **리스가 살아 있는데 아직 정리하지 않은 클레임이 있는가.**
   * 미해소 critical finding 조건은 리뷰 수집(FR-09)이 Phase 2 라 판정할 데이터가 없다 —
   * 없는 것을 요구하지 않는다.
   */
  @Post('stop')
  async stop(
    @Req() req: HookRequest,
    @Body() body: HookPayload,
  ): Promise<{ decision?: 'block'; reason?: string; ok: true }> {
    const principal = requireAgent(req);
    const sessionId = await this.resolveSession(principal, body);
    if (sessionId === null) return { ok: true };

    const claims = await this.sessions.activeClaimSummary(sessionId);
    const unfinished = claims.filter((c) => c.status === 'claimed' || c.status === 'in_progress');
    if (unfinished.length === 0) return { ok: true };

    return {
      ok: true,
      decision: 'block',
      reason:
        `아직 정리하지 않은 클레임이 있습니다: ${unfinished.map((c) => c.task_key).join(', ')}. ` +
        'nerv_task_update 로 상태를 남기고 nerv_task_release 로 내려놓은 뒤 끝내세요.',
    };
  }

  /** SessionEnd — complete/error 전이 + 미해제 클레임 회수. 정리만 하고 응답은 없다. */
  @Post('session-end')
  @HttpCode(HttpStatus.ACCEPTED)
  async sessionEnd(@Req() req: HookRequest, @Body() body: HookPayload): Promise<{ ok: boolean }> {
    const principal = requireAgent(req);
    const sessionId = await this.resolveSession(principal, body);
    if (sessionId === null) return { ok: false };

    await this.sessions.finish({
      sessionId,
      projectId: principal.projectId ?? '',
      reason: body.reason === 'error' ? 'error' : 'complete',
      userId: principal.userId,
    });
    return { ok: true };
  }

  /**
   * 훅 페이로드의 `session_id` 는 **에이전트 호스트의 것**이지 우리 UUID 가 아니다.
   * external_session_id 로 찾고, 없으면 조용히 버린다 — bootstrap 전에 도착한 훅이다.
   */
  private async resolveSession(principal: Principal, body: HookPayload): Promise<string | null> {
    if (body.session_id === undefined || body.session_id === '') return null;
    return this.sessions.findByExternalId(principal.projectId ?? '', body.session_id);
  }
}

/** 훅은 PAT 로만 온다 — 토큰 없는 이벤트는 버린다(agent-integration §6.5). */
function requireAgent(req: HookRequest): Principal {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.hook_missing'), {
      kind: 'missing',
    });
  }
  return principal;
}

/** 알 수 없는 에이전트 종류는 'other' 다 — enum 밖의 값으로 적재를 실패시키지 않는다. */
function normalizeAgentType(value: string | undefined): 'claude-code' | 'codex' | 'web' | 'other' {
  if (value === 'claude-code' || value === 'codex' || value === 'web') return value;
  return 'other';
}
