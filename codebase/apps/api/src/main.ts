// HTTP 엔트리 — Nest(Fastify) 부트스트랩: REST + MCP + WS + SSE + ingest
// 정본: docs/04-mvp/codebase.md §2.2 · 포트·오리진 환경변수는 §5.2 전표

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { AuthGuard } from './common/auth.guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { McpOriginGuard } from './common/mcp-origin.guard.js';
import { NervExceptionFilter } from './common/nerv-exception.filter.js';
import { ProjectScopeInterceptor } from './common/project-scope.interceptor.js';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  app.useGlobalFilters(new NervExceptionFilter());
  app.useGlobalInterceptors(new ProjectScopeInterceptor());
  // 가드 순서가 규약이다 — Origin 검증(어디서)이 인증(누가)보다 먼저다(REQ-CB-013).
  // AuthGuard 는 AuthService 를 주입받으므로 컨테이너에서 꺼낸다.
  app.useGlobalGuards(
    new McpOriginGuard(),
    new AuthGuard(app.get(Reflector), app.get(AuthService)),
  );

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
