// 표면 5종(REST · MCP · WebSocket · SSE · ingest)이 같은 도메인 서비스를 DI 로 공유한다 — D-05.
// 모듈 맵 정본: docs/04-mvp/codebase.md §2.1~§2.3
//
// 의존 방향은 단방향이다: 도메인 모듈 → EventModule → AuthModule.
// McpModule 대신 mcp/ 표면을 여기서 직접 조립한다 — §2.2 트리에 모듈 파일이 없기 때문이고,
// ToolRegistry 가 DiscoveryService 로 앱 전체의 *.tools.ts 를 수집하므로 도메인 모듈을
// import 할 필요도 없다.

import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DatabaseModule } from './common/database.module.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { IdempotencyService } from './common/idempotency.service.js';
import { McpOriginGuard } from './common/mcp-origin.guard.js';
import { RateLimitGuard } from './common/rate-limit.guard.js';
import { RateLimitService } from './common/rate-limit.service.js';
import { McpController } from './mcp/mcp.controller.js';
import { ToolRegistry } from './mcp/tool-registry.js';
import { ApprovalModule } from './modules/approval/approval.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EventModule } from './modules/event/event.module.js';
import { ImportModule } from './modules/import/import.module.js';
import { PluginModule } from './modules/plugin/plugin.module.js';
import { ReviewModule } from './modules/review/review.module.js';
import { SessionModule } from './modules/session/session.module.js';
import { SpecModule } from './modules/spec/spec.module.js';
import { TaskModule } from './modules/task/task.module.js';
import { WorkerModule } from './worker/worker.module.js';

/** HTTP 표면 없이 잡 러너만 조립하는 워커용 루트(REQ-CB-005). worker.ts 가 쓴다. */
@Module({
  imports: [DatabaseModule, WorkerModule],
})
export class WorkerAppModule {}

@Module({
  imports: [
    DatabaseModule,
    DiscoveryModule,
    AuthModule,
    EventModule,
    SpecModule,
    TaskModule,
    SessionModule,
    ApprovalModule,
    ImportModule,
    ReviewModule,
    PluginModule,
  ],
  // MCP 표면은 AuthModule(스코프 검사)·SessionModule(세션 확인)을 쓴다 —
  // 표면이 직접 판정하지 않고 도메인 서비스에 묻는다(D-05 · REQ-CB-003).
  controllers: [McpController],
  providers: [
    ToolRegistry,
    McpOriginGuard,
    RateLimitService,
    RateLimitGuard,
    IdempotencyService,
    IdempotencyInterceptor,
  ],
})
export class AppModule {}
