// 워커 엔트리 — 같은 AppModule 조립에서 HTTP 표면을 제외하고 잡 러너만 구동한다 (REQ-CB-005).
//
// 워커가 트래픽을 받는 순간 replica 1 규칙(codebase.md §6.3)이 무의미해진다. 그래서
// createApplicationContext 를 쓴다 — HTTP 리스너가 아예 만들어지지 않는다.
// 잡 루프 스케줄과 advisory lock 획득은 E04-S04 가 연결한다.

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { WorkerAppModule } from './app.module.js';

export async function createWorker(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerAppModule);
}

async function bootstrap(): Promise<void> {
  const worker = await createWorker();
  worker.enableShutdownHooks();
  Logger.log('nerv-worker started (HTTP 리스너 없음 — REQ-CB-005)', 'Worker');
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await bootstrap();
}
