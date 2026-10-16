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

import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Post,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { createTranslator, msg, negotiateLocale, renderMessage, NERV_ERROR } from '@nerv/schema';
import type { Locale, Translator } from '@nerv/schema';
import { dbConstraintError } from '../common/db-error.js';
import { IdempotencyService } from '../common/idempotency.service.js';
import { subjectOfPrincipal } from '../common/idempotency.interceptor.js';
import { NervError } from '../common/nerv-exception.filter.js';
import type { Principal } from '../modules/auth/auth.service.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { SessionService } from '../modules/session/session.service.js';
import type { SessionCandidate } from '../modules/session/session.service.js';
import { assertToolInput } from './tool-input.js';
import { ToolRegistry } from './tool-registry.js';
import type { NervToolDefinition } from './tool-registry.js';
import type { ToolContext } from './tool-context.js';
import { toolCallLevel, toolCallMessage, toolCallOutcome } from './tool-call-log.js';
import { harnessSessionOf } from './harness-session.js';
import type { ToolCallNote } from './tool-call-log.js';

/** 지원 리비전 — 첫 값이 서버 선호다. */
export const SUPPORTED_REVISIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
] as const;

export const LATEST_REVISION = SUPPORTED_REVISIONS[0];

/** 헤더도 본문도 리비전을 대지 않을 때 — Streamable HTTP 가 그렇게 가정하라고 정한 값이다 */
const FALLBACK_REVISION = '2025-03-26';

/**
 * 요청마다 리비전을 본문에 선언하는 리비전(2026-07-28) — 이 이름을 `_meta` 에 실은 요청을 그 규칙으로 다룬다.
 * 그 앞의 리비전은 `initialize` 로 한 번 협상한다.
 */
const MODERN_REVISION = '2026-07-28';
/** 2026-07-28 의 요청마다 붙는 `_meta` 키 — 리비전 선언 · 서버 정보 */
const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
/** 2026-07-28 의 오류 코드 — 헤더와 본문이 어긋남 · 지원하지 않는 리비전(둘 다 HTTP 400) */
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;
/** `Mcp-Name` 헤더가 비추는 본문의 칸 — NERV 는 도구만 있으므로 `tools/call` 하나다 */
const NAME_HEADER_SOURCE: Record<string, string> = { 'tools/call': 'name' };

const SERVER_INFO = { name: 'nerv', version: '0.1.0' } as const;

/**
 * 2026-07-28 의 목록 결과가 반드시 싣는 캐시 표시 — **바로 낡음 · 사용자마다**로 둔다. 도구 설명은 요청
 * 로케일을 타므로 사람마다 다르고, 오래 두어도 될 시간을 정한 적이 없다(값을 새로 만들지 않는다). 빠지면
 * 그 리비전의 클라이언트가 결과를 버린다 — Claude Code 2.1.296 이 `tools/list` 를 네 번 다시 받고 도구 없이
 * 시작했다(2026-10-11 실측).
 */
const NO_CACHE = { ttlMs: 0, cacheScope: 'private' } as const;

type OnSendDone = (error: Error | null, payload?: unknown) => void;

/** `fastify.addHook` 의 필요한 만큼 — apps/api 는 fastify 를 직접 의존하지 않는다 */
export interface McpStatusHost {
  addHook(
    name: 'onSend',
    hook: (request: never, reply: never, payload: never, done: never) => void,
  ): unknown;
}

/**
 * `/mcp` 의 HTTP 상태를 핸들러가 고른다. 핸들러는 요청에 상태를 적기만 하고 보내기 직전에 바꾼다 — Nest 가
 * 핸들러의 상태를 `@HttpCode` 로 덮기 때문이다. 두 곳에서 쓴다.
 *
 * - 알림(`id` 가 없는 JSON-RPC 메시지)에는 **202 · 본문 없음** — Streamable HTTP 의 약속이다. 2026-10-11
 *   실측(E06-S04 · agent-integration.md §2.6a): 200 과 본문 `null` 을 주던 동안 Codex 0.162.1 은
 *   `notifications/initialized` 의 응답을 JSON-RPC 메시지로 읽다 실패해 세 번 다시 붙고 포기했다.
 * - 2026-07-28 요청의 헤더 · 본문 불일치와 리비전 거절은 **400** — 그 리비전이 정한 상태다(REQ-API-302).
 */
export function registerMcpStatus(host: McpStatusHost): void {
  host.addHook('onSend', ((
    request: { nervMcpStatus?: number },
    reply: { code(status: number): unknown; removeHeader(name: string): unknown },
    payload: unknown,
    done: OnSendDone,
  ) => {
    const status = request.nervMcpStatus;
    if (status === undefined) {
      done(null, payload);
      return;
    }
    reply.code(status);
    if (status === Number(HttpStatus.ACCEPTED)) {
      reply.removeHeader('content-type');
      done(null, '');
      return;
    }
    done(null, payload);
  }) as never);
}

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
  // 흐름마다 읽는 기준이 다르다 — 구현은 작업의 기준, 스펙 수정은 최신(2026-09-27 · REQ-API-197)
  'mcp.instructions.spec_basis',
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
    // REST 와 **같은 저장소**를 쓴다(§1.5) — 표면이 둘이어도 실행은 한 번이다
    private readonly idempotency: IdempotencyService,
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
    @Req()
    req: {
      nervPrincipal?: Principal;
      nervMcpStatus?: number;
      headers: Record<string, string | undefined>;
    },
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

    // **2026-07-28 은 본문이 리비전을 선언한다**(REQ-API-302 · agent-integration §2.6a). `_meta` 에 그 이름을
    // 실은 요청만 그 규칙으로 다루고, 헤더만 그 이름을 대는 요청은 지금처럼 받는다 — 플러그인 아웃박스가
    // 그렇게 보내고, 이미 깔린 사본을 한꺼번에 바꿀 수 없다.
    const era = classifyEra(body, req.headers);
    if (era.kind === 'reject') {
      req.nervMcpStatus = HttpStatus.BAD_REQUEST;
      return jsonRpcError(body.id ?? null, era.code, era.render(t), era.data);
    }
    const modern = era.kind === 'modern';
    // 선언한 요청은 헤더를 위에서 대조했다 — 협상은 선언이 없는 요청의 일이다
    const revision = modern ? MODERN_REVISION : this.negotiate(revisionHeader);
    // `id` 가 없으면 알림이다 — 무엇이든 받기만 하고 202 · 본문 없음으로 답한다(registerMcpStatus).
    // `notifications/initialized` 말고도 Claude Code 는 `roots` 를 선언하고 그 변경을 알린다.
    // 배열(구 리비전의 일괄 요청)과 `method` 없는 본문은 알림이 아니다 — 지금처럼 아래에서 거절한다.
    if (isNotification(body)) {
      req.nervMcpStatus = HttpStatus.ACCEPTED;
      return null;
    }
    const id = body.id ?? null;
    // 2026-07-28 의 결과는 `resultType` 을 반드시 싣는다 — 빠지면 그 리비전의 클라이언트가 결과를 버린다
    const complete = (result: Record<string, unknown>, always = false): unknown =>
      modern || always
        ? jsonRpc(id, {
            ...result,
            resultType: 'complete',
            _meta: { ...(result['_meta'] as object | undefined), [META_SERVER_INFO]: SERVER_INFO },
          })
        : jsonRpc(id, result);

    switch (body.method) {
      // 2026-07-28 의 첫 요청 — 서버가 받는 리비전과 능력을 알린다. Claude Code 2.1.296 은 이것부터 묻고,
      // 답이 없으면(-32601) 구 리비전 핸드셰이크로 내려갔다(2026-10-11 실측).
      case 'server/discover':
        return complete(
          {
            ...NO_CACHE,
            supportedVersions: [...SUPPORTED_REVISIONS],
            capabilities: { tools: { listChanged: false } },
            instructions: INSTRUCTION_KEYS.map((key) => t(key)).join(' '),
          },
          true,
        );

      case 'initialize':
        // 2026-07-28 에는 핸드셰이크가 없다 — 그 리비전을 선언한 요청에는 모르는 메서드다
        if (modern) {
          return jsonRpcError(
            id,
            -32601,
            t('mcp.error.unsupported_method', { method: 'initialize' }),
          );
        }
        return jsonRpc(id, {
          // 첫 요청에서는 **본문이 리비전을 고른다** — 구 리비전 클라이언트는 이 요청에 헤더를
          // 보내지 않는다(실측: Claude Code 2.1.296 은 2025-11-25 · Codex 0.162.1 은 2025-06-18 을
          // 본문에만 넣었고, 서버는 2025-03-26 으로 깎아 답했다). 지원하는 값이면 그대로 돌려준다.
          protocolVersion: this.negotiateInitialize(body.params, revision),
          // tools 만 선언한다 — resources·prompts 는 없다(tools-first)
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTION_KEYS.map((key) => t(key)).join(' '),
        });

      case 'ping':
        return complete({});

      case 'tools/list':
        return complete({
          ...(modern ? NO_CACHE : {}),
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

      case 'tools/call': {
        // 호출마다 한 줄 — 접근 로그만으로는 전부 `POST /mcp 200` 이다(tool-call-log.ts · §5.5)
        const note: ToolCallNote = { tool: null, sessionId: null, ignoredArgs: 0 };
        const startedAt = performance.now();
        const result = await this.callTool(
          body.params ?? {},
          principal,
          req.headers,
          t,
          locale,
          note,
        );
        const outcome = toolCallOutcome(result);
        const durationMs = Math.round(performance.now() - startedAt);
        this.logger[toolCallLevel(outcome)](toolCallMessage(note, outcome, durationMs));
        return complete(result as Record<string, unknown>);
      }

      default:
        return jsonRpcError(
          id,
          -32601,
          t('mcp.error.unsupported_method', { method: String(body.method) }),
        );
    }
  }

  /**
   * **서버가 먼저 보내는 스트림은 없다** — 구 리비전 클라이언트가 `GET /mcp` 로 그 스트림을 열려고
   * 하면 405 로 답한다. 그 리비전들이 "스트림을 주지 않는 서버" 에게 정한 답이다(최신 리비전은 GET
   * 스트림을 없앴다). 2026-10-11 실측: Claude Code 2.1.296 은 2025-11-25 로 붙은 뒤 이 요청을 보냈고,
   * 그전까지는 라우트가 없어 404 를 받았다.
   */
  @Get()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  @Header('Allow', 'POST')
  noServerStream(): void {
    // 본문 없음 — 상태와 Allow 헤더가 답이다
  }

  /**
   * 리비전 협상 — 헤더가 없으면 구 클라이언트로 보고 그쪽 리비전을 쓴다.
   * 최신 리비전은 헤더를 요구하지만, 없다고 400 을 내면 구 클라이언트가 통째로 막힌다.
   */
  private negotiate(header: string | undefined): string {
    if (header === undefined || header === '') return FALLBACK_REVISION;
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

  /**
   * `initialize` 의 리비전 — 본문의 `protocolVersion` 이 지원하는 값이면 그 값이다. 아니면
   * 헤더로 고른 값(없으면 2025-03-26)을 준다 — 받아들일지는 클라이언트가 정한다.
   */
  private negotiateInitialize(
    params: Record<string, unknown> | undefined,
    fallback: string,
  ): string {
    const requested = params?.['protocolVersion'];
    return SUPPORTED_REVISIONS.find((r) => r === requested) ?? fallback;
  }

  private async callTool(
    params: Record<string, unknown>,
    principal: Principal,
    headers: Record<string, string | undefined>,
    t: Translator,
    locale: Locale,
    /** 호출 한 줄에 실을 것을 채운다 — 응답에는 영향이 없다 */
    note: ToolCallNote,
  ): Promise<unknown> {
    const name = String(params['name'] ?? '');
    const args = (params['arguments'] ?? {}) as Record<string, unknown>;
    const harnessSessionId = harnessSessionOf(params['_meta']);

    const tool = this.registry.get(name);
    if (tool === undefined) {
      return toolError(NERV_ERROR.PRECONDITION, t('mcp.error.unknown_tool', { name }), {
        kind: 'unknown_tool',
      });
    }
    note.tool = tool.name;

    // 권한과 입력은 호출 **전에** 검사한다 — 부작용 뒤의 거부는 거부가 아니고,
    // 스키마의 `required` 를 아무도 읽지 않으면 그것은 계약이 아니라 문서일 뿐이다
    let ignoredArgs: string[];
    try {
      this.auth.assertScope(principal, tool.scope);
      ignoredArgs = assertToolInput(tool.inputSchema, args);
    } catch (error) {
      return this.toStructuredError(error, t, locale);
    }
    note.ignoredArgs = ignoredArgs.length;
    if (ignoredArgs.length > 0) {
      // 운영자용 로그(REQ-CB-022) — 드리프트는 사람이 스킬·스키마를 고쳐야 사라진다
      this.logger.warn(
        `스킬↔스키마 드리프트: ${tool.name} 이(가) 받지 않는 인자 ${ignoredArgs.join(', ')}`,
      );
    }

    // 세션 해소도 **구조화 에러**여야 한다 — 여기서 던지면 게이트웨이가 프로토콜 오류로
    // 뭉개고, 모델은 자기가 무엇을 잘못 넘겼는지 모른 채 같은 호출을 반복한다.
    let session: { id: string | null; candidates: readonly SessionCandidate[] };
    try {
      session = await this.resolveSession(args, principal, harnessSessionId);
    } catch (error) {
      return this.toStructuredError(error, t, locale);
    }
    note.sessionId = session.id;

    const ctx: ToolContext = {
      principal,
      projectId: principal.projectId ?? '',
      sessionId: session.id,
      sessionCandidates: session.candidates,
      harnessSessionId,
      idempotencyKey:
        typeof args['idempotency_key'] === 'string'
          ? args['idempotency_key']
          : headers['idempotency-key'],
    };

    try {
      const result = await this.runOnce(tool, args, ctx);
      // **무시한 인자를 성공 응답에도 싣는다**(REQ-API-080). 실패했을 때만 말하면
      // 정작 흔한 경우 — 호출은 성공하고 값만 사라지는 경우 — 를 아무도 모른다.
      const payload = {
        ok: true,
        ...asObject(result),
        ...(ignoredArgs.length > 0 ? { ignored_args: ignoredArgs } : {}),
      };
      return {
        // 구조화 결과 — 모델이 읽고 다음 행동을 고르게 한다(agent-integration §2.7)
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    } catch (error) {
      return this.toStructuredError(error, t, locale);
    }
  }

  /**
   * 멱등 키가 있으면 **REST 와 같은 저장소**를 거쳐 한 번만 실행한다(api.md §1.5).
   *
   * 표면을 나누지 않는 이유가 이 함수의 존재 이유다: 아웃박스가 큐잉한 쓰기는 재전송될 때
   * MCP 로 갈지 REST 로 갈지 정해져 있지 않다. 저장소가 표면마다 다르면 "한 번만 실행된다"
   * 는 약속이 표면이 바뀌는 순간 깨진다.
   *
   * 읽기 도구(A1)는 지나간다 — 재실행에 부작용이 없고, 재생하면 오히려 낡은 값을 준다.
   */
  private async runOnce(
    tool: NervToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<unknown> {
    const key = ctx.idempotencyKey;
    if (key === undefined || key === '' || tool.tier === 'A1' || tool.selfIdempotent === true) {
      return tool.handler(args, ctx);
    }
    const subject = subjectOfPrincipal(ctx.principal);
    const fingerprint = IdempotencyService.fingerprint({
      route: `mcp ${tool.name}`,
      // 키 자체는 지문에 넣지 않는다 — 지문이 답해야 하는 것은 "같은 키에 다른 요청인가" 다
      body: { ...args, idempotency_key: undefined },
    });
    const outcome = await this.idempotency.begin({ subject, key, fingerprint });
    if (outcome.replay !== null) return outcome.replay.body;
    try {
      const result = await tool.handler(args, ctx);
      await this.idempotency.complete({ subject, key, statusCode: 200, body: result ?? null });
      return result;
    } catch (error) {
      // 실패를 박제하지 않는다 — 자리를 비워야 재시도가 다시 실행된다
      await this.idempotency.abandon({ subject, key });
      throw error;
    }
  }

  /**
   * 도구 실행 세션 — **명시 인자 > 하네스가 실어 준 자기 세션 > 살아 있는 세션 추정**(api.md §1.4c).
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
   *
   * **하네스가 자기 세션 id 를 실어 주면 어림하지 않는다**(2026-10-16 · E20-S01 · REQ-API-324). Codex 는 MCP 요청마다
   * 그 값을 싣고 그것이 훅 입력의 `session_id` 다 — 훅이 만든 세션을 external id 로 찾으면 같은 사람이 세션을 둘 열어
   * 둬도 이 호출이 어느 세션의 일인지 안다. 찾지 못하면(아직 bootstrap 전 · 훅 없는 설치) 지금처럼 어림한다.
   */
  private async resolveSession(
    args: Record<string, unknown>,
    principal: Principal,
    harnessSessionId: string | null,
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
    if (harnessSessionId !== null) {
      // 자기 세션만 찾는다 — external id 는 비밀이 아니다(findByExternalId 가 사람을 함께 본다). 살아 있는 세션일
      // 때만 고른다: 끝났거나 쓸려 간 세션에 일을 붙이지 않고, 그때는 아래 어림이 bootstrap 을 권한다
      const own = await this.sessions.findByExternalId(
        projectId,
        harnessSessionId,
        principal.userId,
      );
      if (own !== null && candidates.some((c) => c.session_id === own)) {
        await this.sessions.touch(own);
        return { id: own, candidates: [] };
      }
    }
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
    // **원문을 밖으로 내보내지 않는다**(2026-09-03). 예전에는 예외 메시지를 `detail` 에
    // 그대로 실었는데, drizzle 의 예외 메시지는 **SQL 전문**이라(db-error.ts 주석이 이미
    // 그렇게 적고 있다) 오타 하나가 스키마와 질의를 그대로 돌려주는 창이 됐다. 원인은
    // 운영자 로그에 남고, 모델에게는 "다시 시도할 수 있는 실패" 라는 사실만 준다.
    return toolError(NERV_ERROR.UNAVAILABLE, t('mcp.error.tool_failed'), { kind: 'internal' });
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

type Era =
  | { kind: 'legacy' }
  | { kind: 'modern' }
  | {
      kind: 'reject';
      code: number;
      /** 문장은 요청 로케일로 만든다 — 분류는 로케일을 모른다 */
      render: (t: Translator) => string;
      data?: Record<string, unknown>;
    };

/**
 * 이 요청을 어느 리비전의 규칙으로 다루나 — **본문이 정하고 헤더는 대조한다**(REQ-API-302).
 *
 * `params._meta` 에 2026-07-28 을 선언한 요청이 그 리비전이다. 그 요청은 `MCP-Protocol-Version` ·
 * `Mcp-Method` 헤더가 있어야 하고 본문과 같아야 하며, `tools/call` 은 `Mcp-Name` 이 도구 이름과 같아야 한다 —
 * 어긋나면 -32020 · HTTP 400 이다. 선언한 리비전을 모르면 -32022 와 받는 목록을 준다. 헤더만 2026-07-28 을
 * 대는 요청(선언 없음)은 구 리비전처럼 받는다 — 참조 구현은 이것을 거절하지만, NERV 플러그인의 아웃박스가
 * 그렇게 보내고 깔린 사본을 한꺼번에 바꿀 수 없다.
 */
function classifyEra(body: unknown, headers: Record<string, string | undefined>): Era {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'legacy' };
  const message = body as JsonRpcRequest;
  const meta = message.params?.['_meta'];
  if (typeof meta !== 'object' || meta === null || !(META_PROTOCOL_VERSION in meta)) {
    return { kind: 'legacy' };
  }
  const claimed = (meta as Record<string, unknown>)[META_PROTOCOL_VERSION];
  if (typeof claimed !== 'string') {
    return { kind: 'reject', code: -32602, render: (t) => t('mcp.error.envelope_invalid') };
  }
  if (!SUPPORTED_REVISIONS.some((r) => r === claimed)) {
    return {
      kind: 'reject',
      code: UNSUPPORTED_PROTOCOL_VERSION,
      render: (t) => t('error.mcp.bad_revision', { revision: claimed }),
      data: { supported: [...SUPPORTED_REVISIONS], requested: claimed },
    };
  }
  // 앞선 리비전을 선언한 요청 — 그 리비전은 헤더 규칙이 없다
  if (claimed !== MODERN_REVISION) return { kind: 'legacy' };

  const mismatch = (header: string, sent: string | undefined, expected: string): Era => ({
    kind: 'reject',
    code: HEADER_MISMATCH,
    render: (t) => t('mcp.error.header_mismatch', { header, sent: sent ?? '-', expected }),
    data: { mismatch: { header: sent ?? '(missing)', body: expected } },
  });
  const versionHeader = headers['mcp-protocol-version']?.trim();
  if (versionHeader !== claimed) return mismatch('MCP-Protocol-Version', versionHeader, claimed);
  const method = String(message.method ?? '');
  const methodHeader = headers['mcp-method']?.trim();
  const isRequest = 'id' in message;
  // 알림은 헤더가 있을 때만 대조한다 — 그 리비전이 헤더를 요구하는 것은 요청이다
  if ((isRequest || methodHeader !== undefined) && methodHeader !== method) {
    return mismatch('Mcp-Method', methodHeader, method);
  }
  const field = NAME_HEADER_SOURCE[method];
  const named = field === undefined ? undefined : message.params?.[field];
  if (isRequest && typeof named === 'string') {
    const nameHeader = headers['mcp-name']?.trim();
    const decoded = nameHeader === undefined ? undefined : decodeMcpName(nameHeader);
    if (decoded !== named) return mismatch('Mcp-Name', nameHeader, named);
  }
  return { kind: 'modern' };
}

/**
 * `Mcp-Name` 값 — 헤더에 실을 수 없는 글자는 `=?base64?…?=` 로 감싸 보낸다. 감싼 값이 base64 가 아니면
 * undefined(본문과 맞지 않는 것으로 본다).
 */
function decodeMcpName(value: string): string | undefined {
  const wrapped = /^=\?base64\?(.*)\?=$/i.exec(value);
  if (wrapped === null) return value;
  const encoded = wrapped[1] ?? '';
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return undefined;
  return Buffer.from(encoded, 'base64').toString('utf8');
}

/** JSON-RPC 알림 — `method` 는 있고 `id` 는 없는 객체 하나 */
function isNotification(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('id' in body) &&
    typeof (body as JsonRpcRequest).method === 'string'
  );
}

function jsonRpc(id: string | number | null, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): unknown {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
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
