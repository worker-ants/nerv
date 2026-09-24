// HTTP 엔트리 — Nest(Fastify) 부트스트랩: REST + MCP + WS + SSE + ingest
// 정본: docs/04-mvp/codebase.md §2.2 · 포트·오리진 환경변수는 §5.2 전표

import { ATTACHMENT_MAX_BYTES, MAX_REQUEST_BODY_BYTES } from '@nerv/schema';
import 'reflect-metadata';
import type { IncomingHttpHeaders } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { AuthGuard } from './common/auth.guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { McpOriginGuard } from './common/mcp-origin.guard.js';
import { SessionOriginGuard } from './common/session-origin.guard.js';
import { NervExceptionFilter } from './common/nerv-exception.filter.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { logLevelsFromEnv } from './common/log-level.js';
import { NervLogger } from './common/nerv-logger.js';
import { registerAccessLog } from './common/access-log.js';
import { REQUEST_ID_HEADER, requestIdFrom } from './common/request-context.js';
import { REPLAYED_HEADER } from './common/idempotency.service.js';
import {
  allowedOriginsFromEnv,
  apiUrlFromEnv,
  assertCookieDomain,
  assertRetiredNames,
} from './common/origins.js';
import { RateLimitGuard } from './common/rate-limit.guard.js';
import { ProjectScopeInterceptor } from './common/project-scope.interceptor.js';
import { assertMailConfig } from './modules/mail/mail.config.js';

export async function createApp(): Promise<NestFastifyApplication> {
  // rawBody 를 켠다 — GitHub 웹훅의 HMAC 은 **원문 바이트**로 계산되므로 파싱 후
  // 재직렬화한 문자열로는 검증할 수 없다(키 순서·공백이 달라진다).
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: MAX_REQUEST_BODY_BYTES,
      // 요청 ID — 앞문이 넘긴 `X-Request-Id` 를 쓰고, 없거나 모양이 틀리면 만든다(REQ-CB-052)
      genReqId: (req: { headers: IncomingHttpHeaders }) =>
        requestIdFrom(req.headers['x-request-id']),
    }),
    {
      rawBody: true,
      // 전표(§5.2)가 소비자를 "api · worker" 라 적어 둔 변수다 — 2026-09-06 까지
      // 읽는 코드가 없어 값을 바꿔도 아무 일이 없었다.
      // 로거는 요청 안에서 남긴 줄에 요청 ID 를 붙인다(§5.5) — 서비스 코드는 모른다.
      logger: new NervLogger({ logLevels: logLevelsFromEnv() }),
    },
  );

  // 접근 로그 — 요청마다 한 줄(§5.5 · REQ-CB-052). 라우트가 서기(`init`) 전에 달아야
  // better-auth 경로까지 전부 탄다. 운영 로그에 호출된 API 가 한 줄도 없던 자리다.
  registerAccessLog(app.getHttpAdapter().getInstance());

  app.useGlobalFilters(new NervExceptionFilter());
  // 멱등은 **응답을 만드는 일**이라 인터셉터다(§1.5) — 재생은 핸들러를 건너뛴다.
  app.useGlobalInterceptors(new ProjectScopeInterceptor(), app.get(IdempotencyInterceptor));
  // 가드 순서가 규약이다 — Origin 검증(어디서)이 인증(누가)보다 먼저다(REQ-CB-013).
  // AuthGuard 는 AuthService 를 주입받으므로 컨테이너에서 꺼낸다.
  app.useGlobalGuards(
    new McpOriginGuard(),
    // 세션 쿠키로 오는 **쓰기**는 오리진을 대조한다(REQ-CB-043) — 쿠키는 브라우저가 알아서
    // 싣는 자격증명이라 남의 탭이 보낸 요청에도 실린다. 여기도 인증보다 먼저다.
    new SessionOriginGuard(),
    new AuthGuard(app.get(Reflector), app.get(AuthService)),
    // 쿼터는 주체를 알아야 세므로 인증 뒤다(§1.8) — 앞에 두면 인증도 안 된 요청이
    // 남의 창을 채운다.
    app.get(RateLimitGuard),
  );

  // CORS — **화면이 API 와 다른 오리진에 뜨는 배치의 생사가 여기 달렸다**(REQ-CB-041 ·
  // docs/04-mvp/scope.md §2.3 2단계). 같은 오리진에서는 프리플라이트가 일어나지 않으므로
  // 한 호스트가 화면과 API 를 함께 서빙하는 지금 배치에서는 **동작이 바뀌지 않는다.**
  //
  // 허용목록은 `allowedOriginsFromEnv`(= `NERV_WEB_URL` + `NERV_TRUSTED_ORIGINS`) 하나이고
  // **better-auth 의 `trustedOrigins` 와 같은 목록**이다 — 두 곳이 갈리면 로그인은 되는데
  // 그 다음 요청이 전부 막히거나 그 반대이고, 어느 쪽도 원인을 가리키지 않는다.
  //
  // 목록은 **기동 때 한 번** 읽는다 — 이 저장소의 다른 설정도 전부 기동 시점의 값이다.
  const allowedOrigins = new Set(allowedOriginsFromEnv());
  await app.register(cors, {
    // `Origin` 이 없는 요청(에이전트·CLI·서버 대 서버)은 **CORS 의 대상이 아니다** — 통과시키고
    // 헤더를 붙이지 않는다. 여기서 막으면 브라우저가 아니라 CLI 가 죽는다.
    //
    // 목록 밖의 오리진에는 **헤더를 붙이지 않을 뿐** 오류를 내지 않는다: 막는 것은 브라우저의
    // 몫이고, 5xx 로 답하면 "서버가 고장났다" 로 읽힌다 — 고장난 것은 부르는 쪽의 오리진이다.
    origin: (origin, cb) => cb(null, origin === undefined || allowedOrigins.has(origin)),
    // 세션 쿠키를 싣는 요청이라 필수다. **`*` 와 함께 설 수 없다**(브라우저가 거절한다) —
    // 허용목록이 와일드카드일 수 없는 이유가 이것이다.
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // **화면이 실제로 싣는 헤더만** 적는다(`apps/web/src/lib/api.ts`) — 목록에 없는 헤더는
    // 프리플라이트에서 거절되고, 그 요청은 서버에 도달조차 하지 않는다.
    //   accept · accept-language · content-type — 모든 요청
    //   authorization — PAT 경로(브라우저 밖이지만 같은 표면이다)
    //   idempotency-key — 상태를 바꾸는 요청(§1.5) · x-nerv-org — 같은 slug 한정자(REQ-API-152)
    // `/mcp`·`/ingest` 의 헤더(`mcp-session-id` 등)는 없다 — 브라우저 클라이언트가 없는
    // 표면이다(api.md §1.1 표면 전표). 그런 클라이언트를 지원하게 되면 이 목록이 함께 자란다.
    allowedHeaders: [
      'accept',
      'accept-language',
      'authorization',
      'content-type',
      'idempotency-key',
      'x-nerv-org',
    ],
    // 화면이 **읽어야 하는** 응답 헤더. 적지 않으면 브라우저 JS 에서 보이지 않는다 —
    // 기본 노출은 여섯 개뿐이고 우리 셋은 거기 없다. 429 의 대기 시간과 멱등 재생 표시,
    // 그리고 문의할 때 대는 요청 ID 다(§5.5).
    exposedHeaders: [REPLAYED_HEADER, 'Retry-After', REQUEST_ID_HEADER],
    // 프리플라이트 캐시. 값이 더 커도 브라우저가 자기 상한으로 자른다(Safari 600s·Chrome 7200s).
    maxAge: 600,
  });

  // 첨부 업로드는 multipart 다(§2.10) — 파일당 10MB 는 서비스가 다시 보지만, 여기서도
  // 막아야 그보다 큰 요청이 메모리에 들어오지 않는다.
  await app.register(multipart, { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } });

  // better-auth 핸들러 마운트 — `/api/auth/*` 는 로그인·로그아웃·세션 조회의 표면이다.
  // Nest 라우트가 아니라 Fastify 에 직접 단다: 전역 AuthGuard 를 타면 "로그인하려면 먼저
  // 로그인해야 하는" 고리가 생긴다. 인증 이전의 표면이므로 인증 가드 밖에 있어야 한다.
  const auth = app.get(AuthService).handler;
  if (auth !== null) {
    const fastify = app.getHttpAdapter().getInstance();
    fastify.all('/api/auth/*', async (request, reply) => {
      // 들어온 요청을 절대화하는 기준이다 — 이 핸들러가 사는 오리진, 즉 API 주소다(REQ-CB-036).
      const url = new URL(request.url, apiUrlFromEnv());
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.append(key, value);
        else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
      }
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          ...(request.method === 'GET' || request.method === 'HEAD'
            ? {}
            : { body: JSON.stringify(request.body ?? {}) }),
        }),
      );
      reply.status(response.status);
      for (const [key, value] of response.headers.entries()) reply.header(key, value);
      return reply.send(response.body === null ? null : await response.text());
    });
  }

  // /healthz 는 인프라 전용(무인증 liveness)이며 api.md 의 계약 전표 밖이다(codebase.md §5.4).
  // Nest 라우트가 아니라 Fastify 인스턴스에 직접 단다 — 전역 가드·인터셉터를 타지 않는다.
  app
    .getHttpAdapter()
    .getInstance()
    .get('/healthz', async () => ({ ok: true }));

  return app;
}

async function bootstrap(): Promise<void> {
  // 걷힌 이름을 만나면 여기서 멈춘다 — 기본값으로 뜨면 운영자는 틀린 주소로 서명된 쿠키를
  // 받고서야 안다(REQ-CB-037). 던지면 엔트리가 비영 종료한다.
  assertRetiredNames();
  // 쿠키 도메인도 여기서 본다 — Nest 초기화 중에 던지면 `abortOnError` 기본값이 프로세스를
  // abort 시켜(SIGABRT) 운영자가 받는 것이 문구가 아니라 덤프가 된다(REQ-CB-042).
  assertCookieDomain();
  // 메일도 같은 자리에서 본다 — SMTP 를 켜 놓고 보내는 사람을 비우면 "보냈다고 믿는데 닿지
  // 않는" 배치가 되고, 그것은 뜨지 않는 것보다 나쁘다(2026-09-22 · codebase.md §5.2).
  assertMailConfig();
  const app = await createApp();
  const port = Number(process.env['NERV_API_PORT'] ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`nerv-api listening on :${port}`, 'Bootstrap');
}

// 엔트리로 직접 실행될 때만 리슨한다(테스트는 createApp 만 쓴다).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await bootstrap();
}
