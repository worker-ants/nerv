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
import { msg, NERV_ERROR, prepareHookPayload, redact, text } from '@nerv/schema';
import { outcomeOf, summarize } from './hook-summary.js';
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
  tool_input?: unknown;
  tool_response?: unknown;
  agent_type?: string;
  agent_id?: string;
  reason?: string;
  source?: string;
  /** Stop 훅 전용 — 이미 Stop 훅 때문에 계속하는 중이라는 표시(anti-wedge) */
  stop_hook_active?: boolean;
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
   * 이 주입이 훅의 값어치다: 세션이 시작하자마자 "너는 지금 CLV-T-1KTDCK 을 쥐고 있다"를
   * 알려주면, 에이전트가 그것을 다시 물어보거나(왕복) 잊고 새 작업을 잡는 일이 줄어든다.
   *
   * **래퍼가 계약이다**(2026-09-03). 예전에는 `additionalContext` 를 최상위 키로 돌려줬다 —
   * Claude Code 훅 문서는 그 자리를 **조용히 무시한다**(silently ignores)고 못 박고, 값은
   * `hookSpecificOutput` 아래여야 한다. 그래서 이 주입은 세션 37개 내내 한 번도 모델에
   * 도달하지 못했다(실측 2026-09-03). 알려지지 않은 최상위 키는 무시되므로 `ok`·
   * `session_id` 는 우리 쪽 도구(포워더·L2)를 위해 남긴다.
   */
  @Post('session')
  @HttpCode(HttpStatus.ACCEPTED)
  async session(
    @Req() req: HookRequest,
    @Headers('x-nerv-host') host: string | undefined,
    @Headers('x-nerv-agent') agent: string | undefined,
    @Body() body: HookPayload,
  ): Promise<{
    ok: true;
    session_id: string;
    hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string };
  }> {
    const principal = requireAgent(req);
    const result = await this.sessions.bootstrap({
      projectId: principal.projectId ?? '',
      userId: principal.userId,
      // **훅 본문에는 에이전트 종류가 없다.** Claude Code 가 보내는 페이로드는 세션 id·cwd·
      // source 뿐이라, 본문만 보면 모든 세션이 `other` 로 남는다(실측 2026-08-29 — 세션 화면이
      // 누구의 무엇인지 말하지 못했다). 훅을 보내는 쪽은 자기가 누구인지 아니까 헤더로 말한다.
      // 본문의 `agent_type` 은 그대로 폴백이다 — MCP `nerv_bootstrap` 경로가 그 자리를 쓴다.
      agentType: normalizeAgentType(agent ?? body.agent_type),
      hostname: host ?? String(body['hostname'] ?? 'unknown'),
      cwd: body.cwd ?? null,
      externalSessionId: body.session_id ?? null,
    });

    const claims = await this.sessions.activeClaimSummary(result.session_id);
    return {
      ok: true,
      session_id: result.session_id,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          claims.length === 0
            ? text('agent.no_claim')
            : `NERV: 활성 클레임 ${claims.map((c) => `${c.task_key}(${c.status})`).join(', ')}. ` +
              text('agent.resume_claim'),
      },
    };
  }

  /** PostToolUse — Activity 적재. 관찰 전용이라 실패해도 202 다. */
  @Post('tool')
  @HttpCode(HttpStatus.ACCEPTED)
  async tool(@Req() req: HookRequest, @Body() body: HookPayload): Promise<{ ok: boolean }> {
    const principal = requireAgent(req);
    const sessionId = await this.resolveSession(principal, body);
    if (sessionId === null) return { ok: false };

    const toolName = body.tool_name ?? 'tool';
    // **제목도 가린 값에서 만든다.** 원문에서 만들면 `--token abc` 가 목록에 그대로 뜬다 —
    // 페이로드만 가리고 제목을 놓치면 마스킹이 뚫린 것과 같다(L2 가 이것을 잡았다).
    const safeInput = redact(body.tool_input);
    const outcome = outcomeOf(body.tool_response);
    await this.sessions.appendHookActivity({
      sessionId,
      projectId: principal.projectId ?? '',
      type: 'action',
      // **도구 이름은 "무엇을 했는가" 가 아니다.** 예전에는 이 자리에 그것만 넣어서
      // 타임라인이 "Bash" 를 383번 반복했다(실측 2026-09-01) — 답은 인자에 있다.
      title: summarize(toolName, safeInput, body.cwd ?? ''),
      toolName,
      // **원문을 보관한다**(2026-09-01 — 사람 결정 · REQ-API-065). 비밀만 예외로 가리고,
      // 그 예외는 **여기서** 적용한다: 저장한 뒤 화면에서만 가리면 백업·복제본에 이미
      // 들어간 값을 되돌리지 못한다.
      payload: {
        tool_use_id: body.tool_use_id ?? null,
        ...prepareHookPayload({
          toolName,
          // 이미 가린 값을 넘긴다 — 안에서 한 번 더 훑어도 남은 비밀이 없다(방어는 두 겹이다)
          toolInput: safeInput,
          toolResponse: body.tool_response,
        }),
        // 성패는 목록에서 보인다 — 펼치지 않아도 실패가 눈에 띄어야 한다
        ...(outcome === null ? {} : { ok: outcome.ok, outcome: outcome.detail }),
      },
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
   *
   * **한 번 막은 뒤에는 막지 않는다**(2026-09-03 · anti-wedge). `stop_hook_active` 는
   * "이미 Stop 훅 때문에 계속하는 중"이라는 뜻이고, 훅 문서는 이 값을 확인해 **풀리지 않을
   * 조건으로 막지 말라**고 명시한다. 확인하지 않으면 클레임을 쥔 채 사람에게 물으려는
   * 턴마다 강제 계속이 반복되고(상한 8회), 모델은 멈추려고 클레임을 조기 릴리스한다.
   * clemvion 이 같은 자리에서 같은 답을 냈다 — [1.2 분석](../../../../../docs/01-problem/clemvion-analysis.md)
   * §"`stop_hook_active`면 즉시 허용 — 무한 루프 차단". 우리 문제 정의가 이미 적어 둔
   * 교훈을 서버가 되풀이하고 있었다.
   */
  @Post('stop')
  async stop(
    @Req() req: HookRequest,
    @Body() body: HookPayload,
  ): Promise<{ decision?: 'block'; reason?: string; ok: true }> {
    const principal = requireAgent(req);
    // 두 번째 판정은 하지 않는다 — 첫 block 이 이미 말했고, 그것으로 안 풀렸다면
    // 다시 막는 것은 안내가 아니라 덫이다.
    if (body.stop_hook_active === true) return { ok: true };
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
        text('agent.release_before_exit'),
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
    return this.sessions.findByExternalId(
      principal.projectId ?? '',
      body.session_id,
      principal.userId,
    );
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
