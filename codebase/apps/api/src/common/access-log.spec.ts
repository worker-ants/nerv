import { NERV_ERROR } from '@nerv/schema';
import type { Logger } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  accessLevel,
  clientIp,
  formatAccessLine,
  registerAccessLog,
  surfaceOf,
} from './access-log.js';
import type { AccessRecord } from './access-log.js';
import { nervLoggerFromEnv } from './nerv-logger.js';
import { currentRequestId, requestIdFrom } from './request-context.js';

interface Line {
  level: string;
  /** 사람이 읽는 문장 — 구조화 메시지의 `message` */
  message: string;
  /** 로거가 받은 그대로 — `json` 에서 펼쳐질 필드 */
  fields: Record<string, unknown>;
  requestId: string | null;
}

/** 줄을 모으는 가짜 로거 — 남길 때의 요청 맥락까지 적는다 */
function capture(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const at = (level: string) => (message: { message: string }) =>
    lines.push({
      level,
      message: message.message,
      fields: message as unknown as Record<string, unknown>,
      requestId: currentRequestId(),
    });
  const logger = {
    log: at('log'),
    warn: at('warn'),
    error: at('error'),
    verbose: at('verbose'),
    debug: at('debug'),
    fatal: at('fatal'),
  } as unknown as Logger;
  return { logger, lines };
}

/** main.ts 와 같은 배선 — 요청 ID 생성기와 훅 */
async function boot(logger: Logger) {
  const fastify = new FastifyAdapter({
    genReqId: (req: { headers: IncomingHttpHeaders }) => requestIdFrom(req.headers['x-request-id']),
  }).getInstance();
  registerAccessLog(fastify, logger);
  fastify.get('/api/projects/:proj/tasks', async (request) => {
    // 가드가 하는 일을 흉내 낸다 — 접근 로그는 요청 객체에 달린 주체를 읽는다
    Object.assign(request, {
      nervPrincipal: {
        userId: 'u-1',
        displayName: '지민',
        isAgent: true,
        projectId: 'p-1',
        roles: [],
        scopes: [],
        tokenId: 't-1',
      },
    });
    return { ok: true };
  });
  fastify.post('/api/echo', async (request) => ({ id: currentRequestId(), body: request.body }));
  fastify.get('/api/denied', async (request, reply) => {
    Object.assign(request, { nervErrorCode: NERV_ERROR.FORBIDDEN });
    return reply.status(403).send({ ok: false });
  });
  fastify.get('/api/boom', async (_request, reply) => reply.status(500).send({ ok: false }));
  fastify.get('/healthz', async () => ({ ok: true }));
  // SSE 처럼 `reply.send` 를 거치지 않고 raw 로 쓰다가 끊기는 응답
  fastify.get('/sse/me', (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    reply.raw.write('event: ping\ndata: {}\n\n');
  });
  await fastify.ready();
  return fastify;
}

/** `close` 는 응답이 끝난 뒤에 온다 — 한 틱 기다린다 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('접근 로그 — 요청마다 한 줄 (REQ-CB-052)', () => {
  it('라우트 템플릿·상태·주체를 싣고, 쿼리 문자열은 싣지 않는다', async () => {
    const { logger, lines } = capture();
    const fastify = await boot(logger);
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/projects/NERV/tasks?token=secret-value',
      headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' },
    });
    await settle();
    expect(res.statusCode).toBe(200);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line?.level).toBe('log');
    expect(line?.message).toMatch(/^GET \/api\/projects\/:proj\/tasks 200 \d+ms /);
    expect(line?.message).toContain('surface=rest');
    expect(line?.message).toContain('user=u-1');
    expect(line?.message).toContain('agent=1');
    expect(line?.message).toContain('token=t-1');
    expect(line?.message).toContain('project=p-1');
    expect(line?.message).toContain('ip=203.0.113.9');
    expect(line?.message).not.toContain('secret-value');
    expect(line?.message).not.toContain('aborted'); // 끝까지 쓴 응답이다
    expect(line?.message).not.toContain('NERV'); // 경로의 실제 값이 아니라 템플릿이다
    // 같은 줄이 `json` 에서 펼칠 필드 — 문장과 같은 값이다(REQ-CB-053)
    expect(line?.fields).toMatchObject({
      event: 'access',
      method: 'GET',
      route: '/api/projects/:proj/tasks',
      status: 200,
      surface: 'rest',
      user_id: 'u-1',
      is_agent: true,
      token_id: 't-1',
      project_id: 'p-1',
      ip: '203.0.113.9',
    });
    expect(line?.fields).not.toHaveProperty('code'); // 값이 없는 필드는 싣지 않는다
    expect(line?.fields).not.toHaveProperty('aborted');
    await fastify.close();
  });

  it('요청 ID — 앞문이 넘긴 값을 응답과 로그에 그대로 쓴다', async () => {
    const { logger, lines } = capture();
    const fastify = await boot(logger);
    const id = '0123456789abcdef0123456789abcdef';
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/projects/NERV/tasks',
      headers: { 'x-request-id': id },
    });
    await settle();
    expect(res.headers['x-request-id']).toBe(id);
    expect(lines[0]?.requestId).toBe(id);
    await fastify.close();
  });

  it('요청 ID — 모양이 틀리면 버리고 새로 만든다(로그 줄 끼워 넣기 차단)', async () => {
    const { logger } = capture();
    const fastify = await boot(logger);
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/projects/NERV/tasks',
      headers: { 'x-request-id': 'abc def GET /api/fake 200' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const none = await fastify.inject({ method: 'GET', url: '/api/projects/NERV/tasks' });
    expect(none.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(none.headers['x-request-id']).not.toBe(res.headers['x-request-id']);
    await fastify.close();
  });

  it('핸들러 안에서 요청 맥락이 산다 — 본문 파싱을 지난 뒤에도', async () => {
    const { logger } = capture();
    const fastify = await boot(logger);
    const id = 'req-body-parsed-0001';
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'x-request-id': id, 'content-type': 'application/json' },
      payload: JSON.stringify({ a: 1 }),
    });
    expect(res.json()).toEqual({ id, body: { a: 1 } });
    await fastify.close();
  });

  it('수준 — 403 은 warn, 500 은 error, 에러 코드를 싣는다', async () => {
    const { logger, lines } = capture();
    const fastify = await boot(logger);
    await fastify.inject({ method: 'GET', url: '/api/denied' });
    await fastify.inject({ method: 'GET', url: '/api/boom' });
    await settle();
    expect(lines.map((line) => line.level)).toEqual(['warn', 'error']);
    expect(lines[0]?.message).toContain(`code=${NERV_ERROR.FORBIDDEN}`);
    await fastify.close();
  });

  it('/healthz 는 남기지 않는다 — 요청 ID 헤더는 싣는다', async () => {
    const { logger, lines } = capture();
    const fastify = await boot(logger);
    const res = await fastify.inject({ method: 'GET', url: '/healthz' });
    await settle();
    expect(lines).toHaveLength(0);
    expect(res.headers['x-request-id']).toBeDefined();
    await fastify.close();
  });
});

describe('접근 로그 — 실제 소켓', () => {
  it('끝까지 쓴 응답은 그대로, 클라이언트가 끊은 스트림은 aborted 로 한 줄', async () => {
    const { logger, lines } = capture();
    const fastify = await boot(logger);
    const base = await fastify.listen({ port: 0, host: '127.0.0.1' });

    const ok = await fetch(`${base}/api/projects/NERV/tasks`);
    expect(ok.headers.get('x-request-id')).not.toBeNull();
    await ok.text();

    const abort = new AbortController();
    const stream = await fetch(`${base}/sse/me`, { signal: abort.signal });
    // 스트림 응답에도 요청 ID 가 실린다 — raw 헤더에 달았기 때문이다
    expect(stream.headers.get('x-request-id')).not.toBeNull();
    abort.abort();

    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines[0]?.message).not.toContain('aborted');
    expect(lines[1]?.message).toMatch(/^GET \/sse\/me 200 \d+ms surface=sse .*aborted=1$/);
    // fetch 의 keep-alive 연결이 남아 close 가 기다린다 — 테스트 쪽 사정이다
    fastify.server.closeAllConnections();
    await fastify.close();
  });
});

describe('접근 로그 — 조각', () => {
  it('표면은 경로 접두에서 온다', () => {
    expect(surfaceOf('/api/auth/sign-in/email')).toBe('auth');
    expect(surfaceOf('/api/projects')).toBe('rest');
    expect(surfaceOf('/mcp')).toBe('mcp');
    expect(surfaceOf('/ingest/hooks')).toBe('ingest');
    expect(surfaceOf('/sse/me')).toBe('sse');
    expect(surfaceOf('/plugin/marketplace.json')).toBe('plugin');
    expect(surfaceOf('/nope')).toBe('other');
  });

  it('수준 표', () => {
    expect(accessLevel('GET', 200)).toBe('log');
    expect(accessLevel('POST', 409)).toBe('log');
    expect(accessLevel('GET', 401)).toBe('warn');
    expect(accessLevel('GET', 429)).toBe('warn');
    expect(accessLevel('GET', 503)).toBe('error');
    expect(accessLevel('OPTIONS', 204)).toBe('verbose');
  });

  it('클라이언트 주소는 X-Forwarded-For 의 마지막 항목 — 맨 앞은 클라이언트가 적은 값이다', () => {
    expect(clientIp('1.1.1.1, 10.0.0.5', '10.0.0.9')).toBe('10.0.0.5');
    expect(clientIp(undefined, '10.0.0.9')).toBe('10.0.0.9');
    expect(clientIp('', undefined)).toBeNull();
  });

  it('값이 없는 키는 싣지 않고, 끊긴 응답은 표시한다', () => {
    const record: AccessRecord = {
      method: 'GET',
      route: '/sse/me',
      status: 200,
      durationMs: 61000,
      surface: 'sse',
      aborted: true,
      code: null,
      userId: 'u-1',
      isAgent: false,
      tokenId: null,
      projectId: null,
      ip: null,
      bytes: null,
    };
    expect(formatAccessLine(record)).toBe(
      'GET /sse/me 200 61000ms surface=sse user=u-1 agent=0 aborted=1',
    );
  });
});

/**
 * **싣지 않는 것**(§5.5 · REQ-CB-053) — 실제 로거(두 형식)가 stdout 에 쓴 바이트를 센다.
 * 가짜 로거로 세면 "로거가 무엇을 받았는가" 만 보고, 로거가 그것을 어떻게 펼쳤는가는 못 본다.
 */
describe('접근 로그 — 싣지 않는 것', () => {
  const SECRETS = {
    bearer: 'nerv_pat_secret-bearer-value',
    cookie: 'secret-cookie-value',
    idempotency: 'secret-idempotency-value',
    query: 'secret-query-value',
    email: 'jimin@example.com',
    password: 'secret-password-value',
    displayName: '비밀스러운표시이름',
  };

  it.each(['text', 'json'] as const)(
    '%s — 자격증명·본문·쿼리·이메일·이름이 줄에 없다',
    async (format) => {
      const written: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
      try {
        const logger = nervLoggerFromEnv({ NERV_LOG_FORMAT: format, NERV_LOG_LEVEL: 'verbose' });
        const fastify = new FastifyAdapter({
          genReqId: (req: { headers: IncomingHttpHeaders }) =>
            requestIdFrom(req.headers['x-request-id']),
        }).getInstance();
        registerAccessLog(fastify, logger as unknown as Logger);
        fastify.post('/api/v1/projects/:proj/tasks', async (request) => {
          Object.assign(request, {
            nervPrincipal: {
              userId: 'u-1',
              displayName: SECRETS.displayName,
              isAgent: false,
              projectId: null,
              roles: [],
              scopes: [],
              tokenId: null,
            },
          });
          return { email: SECRETS.email }; // 응답 본문도 싣지 않는다
        });
        await fastify.ready();
        await fastify.inject({
          method: 'POST',
          url: `/api/v1/projects/NERV/tasks?q=${SECRETS.query}`,
          headers: {
            authorization: `Bearer ${SECRETS.bearer}`,
            cookie: `better-auth.session_token=${SECRETS.cookie}`,
            'idempotency-key': SECRETS.idempotency,
            'content-type': 'application/json',
          },
          payload: JSON.stringify({ email: SECRETS.email, password: SECRETS.password }),
        });
        await settle();
        await fastify.close();
      } finally {
        spy.mockRestore();
      }
      const output = written.join('');
      expect(output).toContain('/api/v1/projects/:proj/tasks'); // 줄은 남았다
      for (const secret of Object.values(SECRETS)) expect(output).not.toContain(secret);
    },
  );
});
