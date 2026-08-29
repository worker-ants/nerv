// MCP — nerv_bootstrap · nerv_session_event
//
// nerv_bootstrap 은 **세션 시작 직후 첫 도구 호출**이다(agent-integration §2.3). 그래서 이
// 도구만 sessionId 없이 실행되고, 나머지 도구는 이 호출이 만든 세션 위에서 돈다.
// nerv_session_event 는 훅 ingest 와 같은 SessionService.appendActivity 를 쓴다(api.md §4).

import { Injectable } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import type { ToolContext } from '../../mcp/tool-context.js';
import { SessionService } from './session.service.js';
import type { AgentKind } from './session.service.js';

@Injectable()
export class SessionTools implements NervToolProvider {
  constructor(private readonly sessions: SessionService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_bootstrap',
      tier: 'A1',
      phase: 'P0',
      summaryKey: 'mcp.tool.first_call',
      scope: 'agent-session:launch',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'mcp.arg.project' },
          agent_type: { type: 'string', enum: ['claude-code', 'codex', 'web', 'other'] },
          hostname: {
            type: 'string',
            description: 'mcp.arg.hostname',
          },
          cwd: { type: 'string' },
          branch: { type: 'string' },
          worktree_path: { type: 'string' },
          model: { type: 'string' },
          external_session_id: { type: 'string', description: 'mcp.arg.external_session_id' },
          resume_session_id: { type: 'string' },
        },
        required: ['agent_type', 'hostname'],
      },
      handler: async (input, ctx) =>
        this.sessions.bootstrap({
          projectId: ctx.projectId,
          userId: ctx.principal.userId,
          agentType: (input['agent_type'] as AgentKind | undefined) ?? 'other',
          hostname: String(input['hostname'] ?? 'unknown'),
          cwd: str(input['cwd']),
          branch: str(input['branch']),
          worktreePath: str(input['worktree_path']),
          model: str(input['model']),
          externalSessionId: str(input['external_session_id']),
          resumeSessionId: str(input['resume_session_id']),
        }),
    },
    {
      name: 'nerv_session_event',
      tier: 'A1',
      phase: 'P1',
      summaryKey: 'mcp.tool.hookless_fallback',
      scope: 'agent-session:launch',
      inputSchema: {
        type: 'object',
        properties: {
          event_seq: { type: 'integer', description: 'mcp.arg.event_seq' },
          type: {
            type: 'string',
            enum: ['thought', 'action', 'elicitation', 'response', 'error'],
          },
          title: { type: 'string' },
          body_md: { type: 'string' },
          tool_name: { type: 'string' },
          payload: { type: 'object' },
          session_id: { type: 'string', description: 'mcp.arg.session_id' },
        },
        required: ['event_seq', 'type'],
      },
      handler: async (input, ctx) =>
        this.sessions.appendActivity({
          sessionId: requireSession(ctx),
          projectId: ctx.projectId,
          seq: BigInt(Number(input['event_seq'] ?? 0)),
          type: input['type'] as 'thought' | 'action' | 'elicitation' | 'response' | 'error',
          title: str(input['title']),
          bodyMd: str(input['body_md']),
          toolName: str(input['tool_name']),
          payload: (input['payload'] as Record<string, unknown> | undefined) ?? {},
        }),
    },
  ];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * nerv_bootstrap 외의 도구는 세션 위에서만 돈다.
 *
 * 구조화 에러로 던지는 것이 중요하다 — "먼저 bootstrap 을 불러라"는 에이전트가 읽고 스스로
 * 고칠 수 있는 정보다. 일반 Error 로 던지면 게이트웨이가 내부 오류로 뭉개고,
 * 모델은 무엇을 잘못했는지 모른 채 같은 호출을 반복한다(agent-integration §2.7).
 *
 * **두 실패는 다른 실패다**(2026-08-29). 없어서 못 고른 것과 여럿이라 안 고른 것은 다음
 * 행동이 다르다 — 앞은 bootstrap, 뒤는 `session_id` 지정이다. 같은 코드로 뭉치면
 * 에이전트는 이미 만든 세션을 두고 bootstrap 을 다시 부르며 제자리를 돈다.
 */
export function requireSession(ctx: ToolContext): string {
  if (ctx.sessionId !== null) return ctx.sessionId;

  const candidates = ctx.sessionCandidates ?? [];
  if (candidates.length > 1) {
    throw new NervError(
      NERV_ERROR.PRECONDITION,
      msg('error.mcp.session_ambiguous', { count: String(candidates.length) }),
      { kind: 'session_ambiguous', sessions: candidates },
    );
  }
  throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.no_session'), {
    kind: 'session_required',
  });
}
