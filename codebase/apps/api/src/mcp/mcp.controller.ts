// POST /mcp — Streamable HTTP 단일 엔드포인트 (api.md §1.1 · agent-integration §2.1·§2.6)
//
// **tools-first 다.** resources·prompts·elicitation 을 노출하지 않는다 — Codex 가 tools 만
// 지원하므로 그 교집합이 계약이고, 나머지는 Claude 전용 "향상"이지 정본이 아니다
// (agent-integration §2.8). 그래서 tools-only 완주가 Phase 0 성공 기준 0-8 이다.
//
// **리비전 병행 서빙(D-11).** 최신 리비전(2026-07-28)은 프로토콜 세션(Mcp-Session-Id)·
// GET 스트림·Last-Event-ID 재개를 없애고 POST 마다 MCP-Protocol-Version 을 요구한다.
// 구 리비전(2025-03-26~2025-11-25) 클라이언트도 아직 배포돼 있으므로 둘 다 받는다.
// 이것이 가능한 이유는 **NERV 의 세션이 MCP 프로토콜 세션이 아니기 때문**이다 —
// AgentSession 은 nerv_bootstrap 이 발급하고 PAT 에 묶이므로 리비전 변화의 영향을 받지 않는다.

import { Body, Controller, Headers, Post, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { createTranslator, msg, negotiateLocale, renderMessage, NERV_ERROR } from '@nerv/schema';
import type { Locale, Translator } from '@nerv/schema';
import { dbConstraintError } from '../common/db-error.js';
import { NervError } from '../common/nerv-exception.filter.js';
import type { Principal } from '../modules/auth/auth.service.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { SessionService } from '../modules/session/session.service.js';
import type { SessionCandidate } from '../modules/session/session.service.js';
import { assertToolInput } from './tool-input.js';
import { ToolRegistry } from './tool-registry.js';
import type { ToolContext } from './tool-context.js';

/** 지원 리비전 — 첫 값이 서버 선호다. */
export const SUPPORTED_REVISIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
] as const;

export const LATEST_REVISION = SUPPORTED_REVISIONS[0];

/**
 * 서버 instructions — 도구 정의는 지연 로딩되므로 검색 힌트로 쓰인다(2KB 에서 잘림).
 *
 * 에이전트도 사람이 고른 언어로 읽는다. 문장을 여기 박아 두면 요청 로케일과 무관하게
 * 같은 말이 나가므로, **키만 두고 문장은 요청 시점에** 만든다.
 */
const INSTRUCTION_KEYS = [
  'mcp.instructions.what',
  'mcp.instructions.bootstrap',
  'mcp.instructions.flow',
  'mcp.instructions.scope',
  'mcp.instructions.ask',
  'mcp.instructions.data_not_instruction',
] as const;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly registry: ToolRegistry,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * **200 이다, 201 이 아니다.** Nest 는 `@HttpCode` 가 없으면 POST 에 201 을 준다.
   * JSON-RPC 응답은 "만들어진 자원"이 아니고, 무엇보다 이 상태 코드를 읽는 쪽이 있다:
   * `bin/nerv-outbox flush` 는 200 만 성공으로 보고 201 은 4xx 도 아니라 **큐를 멈춘다** —
   * 서버가 정상일수록 아웃박스가 영원히 비지 않았다(2026-09-02).
   */
  @HttpCode(HttpStatus.OK)
  @Post()
  async handle(
    @Body() body: JsonRpcRequest,
    @Headers('mcp-protocol-version') revisionHeader: string | undefined,
    @Req() req: { nervPrincipal?: Principal; headers: Record<string, string | undefined> },
  ): Promise<unknown> {
    // 에이전트가 보내는 Accept-Language 를 그대로 존중한다 — 헤더가 없으면 기본 로케일이다
    const locale = negotiateLocale(req.headers['accept-language'] ?? null);
    const t = createTranslator(locale);
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    if (principal.projectId === null) {
      // 웹 세션으로 /mcp 를 부르는 경로는 없다 — 도구는 PAT 로만 돈다(api.md §1.3)
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.mcp.pat_only'), {
        kind: 'pat_required',
      });
    }

    const revision = this.negotiate(revisionHeader);
    const id = body.id ?? null;

    switch (body.method) {
      case 'initialize':
        return jsonRpc(id, {
          protocolVersion: revision,
          // tools 만 선언한다 — resources·prompts 는 없다(tools-first)
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'nerv', version: '0.1.0' },
          instructions: INSTRUCTION_KEYS.map((key) => t(key)).join(' '),
        });

      case 'notifications/initialized':
        return null;

      case 'ping':
        return jsonRpc(id, {});

      case 'tools/list':
        return jsonRpc(id, {
          tools: this.registry.list().map((tool) => ({
            name: tool.name,
            description: t(tool.summaryKey),
            // 인자 설명도 로케일을 탄다(REQ-CB-024) — 도구 설명만 번역하고 인자는
            // 한국어로 두면 영어 클라이언트가 반쪽짜리 스키마를 받는다.
            inputSchema: localizeSchema(tool.inputSchema, t),
            // 위험도 티어를 메타로 실어 클라이언트가 승인 UX 를 정할 수 있게 한다
            _meta: { 'nerv/tier': tool.tier, 'nerv/scope': tool.scope },
          })),
        });

      case 'tools/call':
        return jsonRpc(
          id,
          await this.callTool(body.params ?? {}, principal, req.headers, t, locale),
        );

      default:
        return jsonRpcError(
          id,
          -32601,
          t('mcp.error.unsupported_method', { method: String(body.method) }),
        );
    }
  }

  /**
   * 리비전 협상 — 헤더가 없으면 구 클라이언트로 보고 그쪽 리비전을 쓴다.
   * 최신 리비전은 헤더를 요구하지만, 없다고 400 을 내면 구 클라이언트가 통째로 막힌다.
   */
  private negotiate(header: string | undefined): string {
    if (header === undefined || header === '') return '2025-03-26';
    const found = SUPPORTED_REVISIONS.find((r) => r === header);
    if (found === undefined) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.mcp.bad_revision', { revision: header }),
        {
          kind: 'unsupported_revision',
          supported: [...SUPPORTED_REVISIONS],
        },
      );
    }
    return found;
  }

  private async callTool(
    params: Record<string, unknown>,
    principal: Principal,
    headers: Record<string, string | undefined>,
    t: Translator,
    locale: Locale,
  ): Promise<unknown> {
    const name = String(params['name'] ?? '');
    const args = (params['arguments'] ?? {}) as Record<string, unknown>;

    const tool = this.registry.get(name);
    if (tool === undefined) {
      return toolError(NERV_ERROR.PRECONDITION, t('mcp.error.unknown_tool', { name }), {
        kind: 'unknown_tool',
      });
    }

    // 스코프와 입력은 호출 **전에** 검사한다 — 부작용 뒤의 거부는 거부가 아니고,
    // 스키마의 `required` 를 아무도 읽지 않으면 그것은 계약이 아니라 문서일 뿐이다
    try {
      this.auth.assertScope(principal, tool.scope);
      assertToolInput(tool.inputSchema, args);
    } catch (error) {
      return this.toStructuredError(error, t, locale);
    }

    // 세션 해소도 **구조화 에러**여야 한다 — 여기서 던지면 게이트웨이가 프로토콜 오류로
    // 뭉개고, 모델은 자기가 무엇을 잘못 넘겼는지 모른 채 같은 호출을 반복한다.
    let session: { id: string | null; candidates: readonly SessionCandidate[] };
    try {
      session = await this.resolveSession(args, principal);
    } catch (error) {
      return this.toStructuredError(error, t, locale);
    }

    const ctx: ToolContext = {
      principal,
      projectId: principal.projectId ?? '',
      sessionId: session.id,
      sessionCandidates: session.candidates,
      idempotencyKey:
        typeof args['idempotency_key'] === 'string'
          ? args['idempotency_key']
          : headers['idempotency-key'],
    };

    try {
      const result = await tool.handler(args, ctx);
      return {
        // 구조화 결과 — 모델이 읽고 다음 행동을 고르게 한다(agent-integration §2.7)
        content: [{ type: 'text', text: JSON.stringify({ ok: true, ...asObject(result) }) }],
        structuredContent: { ok: true, ...asObject(result) },
      };
    } catch (error) {
      return this.toStructuredError(error, t, locale);
    }
  }

  /**
   * 도구 실행 세션 — **명시 인자 > 살아 있는 세션 추정**(api.md §1.4c).
   *
   * 추정이 오랫동안 비어 있었다: 이 함수는 `session_id` 를 준 호출만 세션을 얻었는데,
   * 카탈로그(3.4 §2.3)는 `nerv_bootstrap` 외의 도구에 그 인자를 적지 않는다. 그래서
   * 스키마대로 부르는 에이전트는 `nerv_question_create`·`nerv_task_claim`·
   * `nerv_session_event` 를 **한 번도 성공시킬 수 없었다** — bootstrap 이 방금 성공했어도
   * `session_required` 였다(실측 2026-08-29 · 토이 프로젝트 보고).
   *
   * 도구 호출은 **생존의 증거**이므로 찾은 세션의 마지막 활동 시각을 갱신한다. 그러지
   * 않으면 하트비트를 치지 않는 세션(스펙만 쓰는 세션)이 30분 뒤 stale 로 쓸려 가고,
   * 그때부터 자기 도구를 못 쓴다.
   *
   * nerv_bootstrap 은 세션을 만드는 도구라 여기서 비어 있어도 정상이다.
   */
  private async resolveSession(
    args: Record<string, unknown>,
    principal: Principal,
  ): Promise<{ id: string | null; candidates: readonly SessionCandidate[] }> {
    const projectId = principal.projectId ?? '';
    const explicit = args['session_id'];
    if (typeof explicit === 'string' && explicit !== '') {
      // **자기 세션만 받는다.** 존재만 보면 같은 프로젝트의 남의 세션에 일을 붙일 수 있다
      await this.sessions.requireSession(explicit, projectId, principal.userId);
      await this.sessions.touch(explicit);
      return { id: explicit, candidates: [] };
    }
    const candidates = await this.sessions.liveSessions(projectId, principal.userId);
    if (candidates.length === 1) {
      const only = candidates[0] as SessionCandidate;
      await this.sessions.touch(only.session_id);
      return { id: only.session_id, candidates };
    }
    // 0개면 "먼저 bootstrap", 2개 이상이면 "어느 것인지 말하라" — 판단은 requireSession 이 한다
    return { id: null, candidates };
  }

  /**
   * 에러는 프로토콜 에러가 아니라 **구조화된 도구 결과**로 돌려준다(agent-integration §2.7) —
   * 모델이 읽고 다음 행동을 고르게 하기 위해서다. isError 로 실패임을 표시한다.
   */
  private toStructuredError(error: unknown, t: Translator, locale: Locale): unknown {
    if (error instanceof NervError) {
      // 봉투의 message 는 REST 와 같은 규칙으로 만든다 — 표면이 로케일을 안다
      return toolError(
        error.code,
        renderMessage(error.descriptor, locale),
        error.details,
        nextActionsFor(error),
      );
    }
    // DB 무결성 위반은 REST 와 **같은 변환**을 쓴다(common/db-error.ts · api.md §1.4a).
    // 여기서 UNAVAILABLE 로 뭉개면 더 나쁘다: 그 코드는 "잠시 뒤 다시"라는 뜻이라 에이전트가
    // 영원히 실패할 요청을 재시도한다. 중복 키는 기다린다고 풀리지 않는다.
    const constraint = dbConstraintError(error);
    if (constraint !== null) {
      return toolError(
        constraint.code,
        renderMessage(constraint.descriptor, locale),
        constraint.details,
        nextActionsFor(constraint),
      );
    }

    // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
    this.logger.error('도구 실행 실패', error instanceof Error ? error.stack : String(error));
    return toolError(NERV_ERROR.UNAVAILABLE, t('mcp.error.tool_failed'), {
      kind: 'internal',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  /** 골격 검증용 — 수집된 카탈로그를 노출한다. 프로토콜 응답이 아니다. */
  catalog(): readonly string[] {
    return this.registry.list().map((t) => t.name);
  }
}

/**
 * 에러 코드별 권장 다음 행동 — "응답은 항상 다음 행동을 포함한다"(§2.1 원칙 5).
 * 에이전트가 별도 폴링 루프를 스스로 만들 필요를 없앤다.
 */
function nextActionsFor(error: NervError): string[] {
  // 세션이 없어서 막힌 것이면 답은 하나다 — bootstrap 부터.
  if (error.details['kind'] === 'session_required') return ['nerv_bootstrap'];
  // 여럿이라 못 고른 것이면 **부를 도구가 없다** — 인자를 붙여 다시 부르는 것이 답이다.
  // 여기서 bootstrap 을 권하면 세션이 하나 더 생겨 모호함이 깊어진다.
  if (error.details['kind'] === 'session_ambiguous') return [];

  switch (error.code as string) {
    case NERV_ERROR.CONFLICT_SCOPE:
      return ['nerv_task_next', 'nerv_question_create'];
    case NERV_ERROR.LEASE_EXPIRED:
      return ['nerv_task_claim'];
    case NERV_ERROR.PRECONDITION:
      return ['nerv_spec_get', 'nerv_task_next'];
    case NERV_ERROR.APPROVAL_REQUIRED:
      return ['nerv_task_heartbeat'];
    default:
      return [];
  }
}

function toolError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  nextActions: string[] = [],
): unknown {
  const envelope = {
    ok: false,
    code,
    message,
    details,
    retry_after_s: null,
    next_actions: nextActions,
  };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : { result: value };
}

function jsonRpc(id: string | number | null, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * JSON Schema 안의 `description` 을 카탈로그 키로 보고 번역한다(REQ-CB-024).
 *
 * 키가 아닌 값(예: `'spec key'`)은 그대로 둔다 — 번역기가 모르는 키를 받으면 키를
 * 그대로 돌려주므로, 카탈로그에 없는 설명은 원문이 남는다. 그 성질에 기대는 것이
 * 안전하다: 새 인자에 설명을 적는 사람이 키를 잊어도 스키마가 비지 않는다.
 */
function localizeSchema(schema: unknown, t: (key: never) => string): unknown {
  if (Array.isArray(schema)) return schema.map((item) => localizeSchema(item, t));
  if (schema === null || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] =
      key === 'description' && typeof value === 'string'
        ? t(value as never)
        : localizeSchema(value, t);
  }
  return out;
}
