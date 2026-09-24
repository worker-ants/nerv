// 접근 로그 — 요청마다 한 줄 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-052·053)
//
// **운영 api 컨테이너 로그에 호출된 API 가 한 줄도 남지 않았다**(2026-09-24 사람 보고).
// Fastify 는 `logger` 옵션이 없으면 로그를 끄고, Nest 는 요청을 기록하지 않는다. 남는 것은
// 처리되지 않은 예외(500)뿐이라 "권한이 없다고 나온다" 같은 4xx 문의는 로그로 확인할 길이
// 없었다.
//
// Nest 인터셉터가 아니라 **Fastify 훅**에 다는 이유: better-auth(`/api/auth/*`)는 Nest 라우트가
// 아니고, 가드가 거절한 요청은 인터셉터에 닿지 않는다. 훅은 둘 다 본다.
//
// **싣지 않는 것**: 쿼리 문자열(라우트 템플릿만 싣는다) · 본문 · `Authorization`·`Cookie` 등
// 헤더 · 이메일·표시 이름. 사람은 `user_id` 로만 가리킨다 — 이 줄은 수집기로 흘러가고,
// 거기서는 누가 읽을지 이 저장소가 정하지 않는다.

import { Logger } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { Principal } from '../modules/auth/auth.service.js';
import type { StructuredMessage } from './nerv-logger.js';
import { acceptedId, REQUEST_ID_HEADER, requestContext } from './request-context.js';
import {
  createClientIpResolver,
  DEFAULT_TRUSTED_PROXIES,
  trustedProxiesFromEnv,
} from './client-ip.js';
import type { ClientIpResolver, ClientIpSource } from './client-ip.js';

/** 설정을 넘기지 않은 배선(테스트)의 판정기 — 기본 신뢰 목록, 헤더는 믿지 않는다 */
const DEFAULT_CLIENT_IP = createClientIpResolver({
  trusted: trustedProxiesFromEnv({ NERV_TRUSTED_PROXIES: DEFAULT_TRUSTED_PROXIES.join(',') }),
  header: null,
});

/** 훅이 읽는 요청의 모양 — 가드·필터가 요청 객체에 달아 둔 것까지 */
export interface AccessRequest {
  id: string;
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string | undefined } | undefined;
  routeOptions?: { url?: string | undefined } | undefined;
  nervPrincipal?: Principal | undefined;
  nervProjectId?: string | undefined;
  nervSseProjectId?: string | undefined;
  /** 에러 봉투의 코드 — `NervExceptionFilter` 가 단다 */
  nervErrorCode?: string | null | undefined;
}

interface AccessReply {
  raw: ServerResponse;
}

type Done = (error?: Error) => void;

/** `fastify.addHook` 의 필요한 만큼 — apps/api 는 fastify 를 직접 의존하지 않는다 */
export interface AccessHookHost {
  addHook(
    name: 'onRequest' | 'preHandler',
    hook: (request: never, reply: never, done: Done) => void,
  ): unknown;
}

export interface AccessRecord {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  surface: string;
  /** 응답이 끝나기 전에 연결이 닫혔다 — SSE 는 대개 이렇게 끝난다 */
  aborted: boolean;
  code: string | null;
  userId: string | null;
  isAgent: boolean | null;
  tokenId: string | null;
  projectId: string | null;
  ip: string | null;
  /** 주소를 어디서 가렸는가 — 소켓 · 설정한 헤더 · X-Forwarded-For (client-ip.ts) */
  ipSource: ClientIpSource;
  /** Cloudflare 의 Ray ID — 오류 화면이 보여 주는 값이다. 요청 ID 가 따로 있을 때도 싣는다 */
  cfRay: string | null;
  bytes: number | null;
}

/** 로그를 남기지 않는 경로 — 인프라 liveness 는 초마다 온다(§5.4) */
const SKIPPED = new Set(['/healthz']);

/** 경로 접두 → 표면(api.md §1.1 표면 전표) */
export function surfaceOf(path: string): string {
  if (path.startsWith('/api/auth/')) return 'auth';
  if (path.startsWith('/api/')) return 'rest';
  if (path === '/mcp' || path.startsWith('/mcp/')) return 'mcp';
  if (path.startsWith('/ingest/')) return 'ingest';
  if (path.startsWith('/sse/')) return 'sse';
  if (path.startsWith('/ws/')) return 'ws';
  if (path.startsWith('/plugin/')) return 'plugin';
  return 'other';
}

/**
 * 수준 — 5xx 는 서버의 잘못이라 `error`. 401·403·429 는 **사람이 문의해 오는 4xx** 라
 * `warn` 으로 올려 수준만으로 걸러 볼 수 있게 한다. 나머지는 `log`, 프리플라이트는 `verbose`.
 */
export function accessLevel(method: string, status: number): LogLevel {
  if (status >= 500) return 'error';
  if (status === 401 || status === 403 || status === 429) return 'warn';
  if (method === 'OPTIONS') return 'verbose';
  return 'log';
}

/** 라우트 템플릿. 매칭되지 않은 요청(404)은 쿼리를 뗀 경로를 싣는다 */
function routeOf(request: AccessRequest): string {
  const template = request.routeOptions?.url;
  if (template !== undefined && template !== '') return template;
  return (request.url.split('?')[0] ?? '').slice(0, 200);
}

export function accessRecordOf(
  request: AccessRequest,
  raw: ServerResponse,
  durationMs: number,
  aborted: boolean,
  resolveIp: ClientIpResolver = DEFAULT_CLIENT_IP,
): AccessRecord {
  const principal = request.nervPrincipal;
  const client = resolveIp(request.headers, request.socket?.remoteAddress);
  const length = Number(raw.getHeader('content-length'));
  return {
    method: request.method,
    route: routeOf(request),
    status: raw.statusCode,
    durationMs,
    surface: surfaceOf(request.url),
    aborted,
    code: request.nervErrorCode ?? null,
    userId: principal?.userId ?? null,
    isAgent: principal?.isAgent ?? null,
    tokenId: principal?.tokenId ?? null,
    projectId: principal?.projectId ?? request.nervProjectId ?? request.nervSseProjectId ?? null,
    ip: client.ip,
    ipSource: client.source,
    cfRay: acceptedId(request.headers['cf-ray']),
    bytes: Number.isFinite(length) ? length : null,
  };
}

/**
 * 한 줄 — `METHOD 라우트 상태 소요 key=value…`. 앞 넷은 사람이 눈으로 훑는 자리이고
 * 나머지는 grep 으로 거르는 자리다. 값이 없는 키는 싣지 않는다.
 */
export function formatAccessLine(record: AccessRecord): string {
  const fields: [string, string | number | null][] = [
    ['surface', record.surface],
    ['code', record.code],
    ['user', record.userId],
    ['agent', record.isAgent === null ? null : record.isAgent ? 1 : 0],
    ['token', record.tokenId],
    ['project', record.projectId],
    ['ip', record.ip],
    ['ip_source', record.ip === null ? null : record.ipSource],
    ['cf_ray', record.cfRay],
    ['bytes', record.bytes],
  ];
  const tail = fields
    .filter((field): field is [string, string | number] => field[1] !== null)
    .map(([key, value]) => `${key}=${value}`);
  if (record.aborted) tail.push('aborted=1');
  return [
    record.method,
    record.route,
    String(record.status),
    `${record.durationMs}ms`,
    ...tail,
  ].join(' ');
}

/**
 * 구조화 메시지 — `text` 에서는 한 줄 문장, `json` 에서는 필드가 줄의 최상위에 펼쳐진다
 * (`nerv-logger.ts`). 값이 없는 필드는 싣지 않는다 — 문장과 같은 규칙이다.
 */
export function accessMessage(record: AccessRecord): StructuredMessage {
  const fields: Record<string, string | number | boolean | null> = {
    event: 'access',
    method: record.method,
    route: record.route,
    status: record.status,
    duration_ms: record.durationMs,
    surface: record.surface,
    code: record.code,
    user_id: record.userId,
    is_agent: record.isAgent,
    token_id: record.tokenId,
    project_id: record.projectId,
    ip: record.ip,
    ip_source: record.ip === null ? null : record.ipSource,
    cf_ray: record.cfRay,
    bytes: record.bytes,
    aborted: record.aborted ? true : null,
  };
  const message: StructuredMessage = { message: formatAccessLine(record) };
  for (const [key, value] of Object.entries(fields)) if (value !== null) message[key] = value;
  return message;
}

/**
 * 훅 셋을 단다.
 *
 * - `onRequest`: 응답 헤더에 요청 ID 를 싣고(raw 에 싣는다 — SSE 는 Fastify 의 `reply.send` 를
 *   거치지 않고 `writeHead` 로 쓴다), 연결이 닫힐 때 한 줄을 남길 준비를 한다.
 * - `onRequest`·`preHandler`: 요청 맥락(ALS)에 들어간다. 본문 파싱이 맥락을 잃을 수 있어
 *   핸들러 직전에 한 번 더 들어간다 — Nest 의 가드·인터셉터·핸들러는 전부 그 뒤다.
 *
 * `onResponse` 가 아니라 raw 의 `close` 를 듣는 이유: SSE 처럼 `reply.send` 를 거치지 않는
 * 응답에서는 `onResponse` 가 오지 않는다. `close` 는 끝났든 끊겼든 한 번 온다.
 */
export function registerAccessLog(
  host: AccessHookHost,
  options: { logger?: Logger; clientIp?: ClientIpResolver } = {},
): void {
  const logger = options.logger ?? new Logger('Access');
  const resolveIp = options.clientIp ?? DEFAULT_CLIENT_IP;
  host.addHook('onRequest', ((request: AccessRequest, reply: AccessReply, done: Done) => {
    reply.raw.setHeader(REQUEST_ID_HEADER, request.id);
    const path = request.url.split('?')[0] ?? '';
    if (!SKIPPED.has(path)) {
      const startedAt = process.hrtime.bigint();
      // 끝까지 썼는가는 `finish` 로 센다 — `writableFinished` 는 주입(inject) 응답에서
      // `close` 시점에 거짓이라 정상 응답을 끊긴 것으로 적었다(L2 실측).
      let finished = false;
      reply.raw.once('finish', () => {
        finished = true;
      });
      reply.raw.once('close', () => {
        const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
        const record = accessRecordOf(request, reply.raw, durationMs, !finished, resolveIp);
        const level = accessLevel(record.method, record.status);
        requestContext.run({ requestId: request.id }, () => {
          logger[level](accessMessage(record));
        });
      });
    }
    requestContext.run({ requestId: request.id }, () => done());
  }) as never);
  host.addHook('preHandler', ((request: AccessRequest, _reply: AccessReply, done: Done) => {
    requestContext.run({ requestId: request.id }, () => done());
  }) as never);
}
