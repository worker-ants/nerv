// E01-S02 수용 기준의 실증.
//
//   WHEN REST 컨트롤러와 MCP 게이트웨이가 같은 도메인 동작을 호출하면,
//   THE SYSTEM SHALL 동일 서비스 인스턴스를 거쳐 게이트 판정을 단일화한다 (D-05)
//
// "같은 클래스를 쓴다"가 아니라 **같은 인스턴스**여야 판정이 하나다. 그래서 참조 동일성을
// 본다(toBe). 표면이 늘어날 때(E03·E05) 이 테스트가 그대로 회귀 방어선이 된다.

import { Test } from '@nestjs/testing';

// DatabaseModule 은 기동 시 DATABASE_URL 을 요구한다(오설정으로 뜨는 것보다 안 뜨는 게 낫다).
// 이 스위트는 모듈 그래프와 라우팅만 보고 **질의를 한 번도 하지 않으므로** 더미 값으로 충분하다 —
// pg.Pool 은 첫 질의 전까지 접속하지 않는다. 실제 DB 검증은 L2 소관이다(codebase.md §4.3).
process.env['DATABASE_URL'] ??= 'postgres://nerv:nerv@127.0.0.1:5432/nerv_l1_no_connect';

import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule, WorkerAppModule } from './app.module.js';
import { ToolRegistry } from './mcp/tool-registry.js';
import { SessionController } from './modules/session/session.controller.js';
import { IngestController } from './modules/session/ingest.controller.js';
import { SessionService } from './modules/session/session.service.js';
import { SessionTools } from './modules/session/session.tools.js';
import { SpecController } from './modules/spec/spec.controller.js';
import { SpecService } from './modules/spec/spec.service.js';
import { SpecTools } from './modules/spec/spec.tools.js';
import { TaskController } from './modules/task/task.controller.js';
import { TaskService } from './modules/task/task.service.js';
import { TaskTools } from './modules/task/task.tools.js';
import { WsGateway } from './modules/event/ws.gateway.js';
import { SseController } from './modules/event/sse.controller.js';
import { EventService } from './modules/event/event.service.js';
import { LeaseReaperJob } from './worker/jobs/lease-reaper.job.js';
import { SessionStaleJob } from './worker/jobs/session-stale.job.js';
import { McpController } from './mcp/mcp.controller.js';
import { ClaimService } from './modules/task/claim.service.js';
import { createWorker } from './worker.js';

/** private 로 주입된 의존을 참조 동일성 비교용으로만 꺼낸다. */
function injected<T>(host: object, key: string): T {
  return (host as unknown as Record<string, T>)[key] as T;
}

describe('AppModule — D-05 표면 5종의 도메인 서비스 공유', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
  });

  it('REST 컨트롤러와 MCP 도구가 같은 SpecService 인스턴스를 받는다', () => {
    const service = app.get(SpecService);
    expect(injected(app.get(SpecController), 'specs')).toBe(service);
    expect(injected(app.get(SpecTools), 'specs')).toBe(service);
  });

  it('REST 컨트롤러와 MCP 도구가 같은 TaskService 인스턴스를 받는다', () => {
    const service = app.get(TaskService);
    expect(injected(app.get(TaskController), 'tasks')).toBe(service);
    expect(injected(app.get(TaskTools), 'tasks')).toBe(service);
  });

  it('REST · MCP · ingest 세 표면이 같은 SessionService 인스턴스를 받는다', () => {
    const service = app.get(SessionService);
    expect(injected(app.get(SessionController), 'sessions')).toBe(service);
    expect(injected(app.get(SessionTools), 'sessions')).toBe(service);
    expect(injected(app.get(IngestController), 'sessions')).toBe(service);
  });

  it('WS 게이트웨이와 SSE 컨트롤러가 같은 EventService 인스턴스를 받는다', () => {
    const service = app.get(EventService);
    expect(injected(app.get(SseController), 'events')).toBe(service);
    expect(injected(app.get(WsGateway), 'events')).toBe(service);
  });
});

describe('ToolRegistry — modules/**/*.tools.ts 수집', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
  });

  it('MVP 도구 15종을 수집한다 (P0 8 + P1 7 — scope.md §4.2)', () => {
    const registry = app.get(ToolRegistry);
    expect(registry.size).toBe(15);
    expect(registry.list().filter((t) => t.phase === 'P0')).toHaveLength(8);
    expect(registry.list().filter((t) => t.phase === 'P1')).toHaveLength(7);
  });

  it('P0 8종의 이름이 카탈로그와 일치한다', () => {
    const registry = app.get(ToolRegistry);
    const p0 = registry
      .list()
      .filter((t) => t.phase === 'P0')
      .map((t) => t.name)
      .sort();
    expect(p0).toEqual([
      'nerv_bootstrap',
      'nerv_spec_get',
      'nerv_spec_search',
      'nerv_spec_tree',
      'nerv_task_claim',
      'nerv_task_heartbeat',
      'nerv_task_next',
      'nerv_task_release',
    ]);
  });

  it('리뷰 도구 2종은 MVP 카탈로그에 없다 (Phase 2 — scope.md §5)', () => {
    const registry = app.get(ToolRegistry);
    expect(registry.get('nerv_review_submit')).toBeUndefined();
    expect(registry.get('nerv_finding_resolve')).toBeUndefined();
  });
});

describe('WorkerAppModule — REQ-CB-005 · 워커는 HTTP 를 열지 않는다', () => {
  let worker: TestingModule;

  beforeAll(async () => {
    worker = await Test.createTestingModule({ imports: [WorkerAppModule] }).compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker.close();
  });

  it('MCP 표면은 워커 루트에 없다', () => {
    // 도메인 모듈을 import 하는 이상 그 모듈의 컨트롤러 클래스는 컨테이너에 들어온다.
    // REQ-CB-005 가 막는 것은 그것이 아니라 **HTTP 리스너**이고, 그 보증은 아래 createWorker
    // 테스트가 한다. 여기서는 워커가 API 전용 표면(MCP)까지 끌고 오지는 않음을 확인한다.
    expect(() => worker.get(McpController, { strict: false })).toThrow();
  });

  it('createWorker 는 HTTP 리스너가 없는 애플리케이션 컨텍스트를 만든다', async () => {
    const ctx = await createWorker();
    // INestApplication 이면 listen/getHttpServer 를 갖는다 — 컨텍스트에는 없어야 한다.
    expect('listen' in ctx).toBe(false);
    expect('getHttpServer' in ctx).toBe(false);
    await ctx.close();
  });

  it('잡도 도메인 서비스를 DI 로 받는다 — 회수 규칙이 API 와 두 벌이 되지 않는다', () => {
    const claims = worker.get(ClaimService, { strict: false });
    expect(injected(worker.get(LeaseReaperJob, { strict: false }), 'claims')).toBe(claims);

    const sessions = worker.get(SessionService, { strict: false });
    expect(injected(worker.get(SessionStaleJob, { strict: false }), 'sessions')).toBe(sessions);
  });
});
