// HTTP 엔트리 — Nest(Fastify) 부트스트랩: REST + MCP + WS + SSE + ingest
// 정본: docs/04-mvp/codebase.md §2.2 · 포트·오리진 환경변수는 §5.2 전표

import { ATTACHMENT_MAX_BYTES, MAX_REQUEST_BODY_BYTES } from '@nerv/schema';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import multipart from '@fastify/multipart';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { AuthGuard } from './common/auth.guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { McpOriginGuard } from './common/mcp-origin.guard.js';
import { NervExceptionFilter } from './common/nerv-exception.filter.js';
import { ProjectScopeInterceptor } from './common/project-scope.interceptor.js';

export async function createApp(): Promise<NestFastifyApplication> {
  // rawBody 를 켠다 — GitHub 웹훅의 HMAC 은 **원문 바이트**로 계산되므로 파싱 후
  // 재직렬화한 문자열로는 검증할 수 없다(키 순서·공백이 달라진다).
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: MAX_REQUEST_BODY_BYTES }),
    {
      rawBody: true,
    },
  );

  app.useGlobalFilters(new NervExceptionFilter());
  app.useGlobalInterceptors(new ProjectScopeInterceptor());
  // 가드 순서가 규약이다 — Origin 검증(어디서)이 인증(누가)보다 먼저다(REQ-CB-013).
  // AuthGuard 는 AuthService 를 주입받으므로 컨테이너에서 꺼낸다.
  app.useGlobalGuards(
    new McpOriginGuard(),
    new AuthGuard(app.get(Reflector), app.get(AuthService)),
  );

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
      const url = new URL(request.url, process.env['NERV_PUBLIC_URL'] ?? 'http://localhost:8080');
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
  const app = await createApp();
  const port = Number(process.env['NERV_API_PORT'] ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`nerv-api listening on :${port}`, 'Bootstrap');
}

// 엔트리로 직접 실행될 때만 리슨한다(테스트는 createApp 만 쓴다).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await bootstrap();
}
