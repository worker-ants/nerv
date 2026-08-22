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

/**
 * 잡 루프 틱.
 *
 * **이 타이머가 워커 프로세스를 살아 있게 한다.** 시그널 리스너만으로는 이벤트 루프가
 * 유지되지 않아 컨테이너가 즉시 종료되고 재시작 루프에 빠진다(실측: Node exit 13
 * "unsettled top-level await"). 워커의 본체는 원래 주기 루프이므로 그 자리를 미리 만든다.
 *
 * E04-S04 가 여기서 advisory lock(REQ-CB-011)을 확인하고 잡 6종을 실행한다 —
 * lease-reaper · session-stale · notification · export · retention · embedding.
 * 주기 값도 그때 확정한다.
 */
const JOB_TICK_MS = 60_000;

async function bootstrap(): Promise<void> {
  const worker = await createWorker();
  worker.enableShutdownHooks();

  const ticker = setInterval(() => {
    // E04-S04: pg_advisory_lock 보유 시에만 잡 루프를 돈다(replica 1 은 배포 규칙, lock 이 최종 방어선)
  }, JOB_TICK_MS);
  Logger.log('nerv-worker started (HTTP 리스너 없음 — REQ-CB-005)', 'Worker');

  const signal = await new Promise<NodeJS.Signals>((resolve) => {
    process.once('SIGTERM', () => resolve('SIGTERM'));
    process.once('SIGINT', () => resolve('SIGINT'));
  });

  Logger.log(`${signal} 수신 — 종료합니다`, 'Worker');
  clearInterval(ticker);
  await worker.close();
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await bootstrap();
}
