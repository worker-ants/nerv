// 워커 엔트리 — 같은 AppModule 조립에서 HTTP 표면을 제외하고 잡 러너만 구동한다 (REQ-CB-005).
//
// 워커가 트래픽을 받는 순간 replica 1 규칙(codebase.md §6.3)이 무의미해진다. 그래서
// createApplicationContext 를 쓴다 — HTTP 리스너가 아예 만들어지지 않는다.
// 잡 루프 스케줄과 advisory lock 은 JobRunner 가 쥔다(E04-S04).

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { WorkerAppModule } from './app.module.js';
import { JobRunner } from './worker/job-runner.js';

export async function createWorker(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerAppModule);
}

/**
 * 잡 루프 틱.
 *
 * **이 타이머가 워커 프로세스를 살아 있게 한다.** 시그널 리스너만으로는 이벤트 루프가
 * 유지되지 않아 컨테이너가 즉시 종료되고 재시작 루프에 빠진다(실측: Node exit 13
 * "unsettled top-level await"). 워커의 본체는 원래 주기 루프이므로 그 자리를 그대로 쓴다.
 *
 * 틱마다 JobRunner 가 advisory lock(REQ-CB-011)을 확인하고, 보유 시에만 각 잡을
 * 자기 주기에 따라 실행한다. 틱 간격이 곧 **스케줄 해상도**다 — 잡이 1초 주기를 원해도
 * 틱이 10초면 10초마다 발화한다. 그래서 기본을 1초로 둔다(2026-08-28 · `NERV_WORKER_TICK_MS`).
 *
 * 촘촘한 틱이 싼 이유: 락은 **한 번 잡으면 계속 보유**하므로(advisory-lock.ts) 틱마다 DB 를
 * 왕복하지 않고, 주기가 안 된 잡은 비교 한 번으로 건너뛴다. 앞 틱이 아직 돌고 있으면
 * 아래 `ticking` 이 그 틱을 통째로 건너뛴다 — 겹쳐 돌지 않는다.
 */
function jobTickMs(): number {
  return Number(process.env['NERV_WORKER_TICK_MS'] ?? 1000);
}

async function bootstrap(): Promise<void> {
  const worker = await createWorker();
  worker.enableShutdownHooks();

  const runner = worker.get(JobRunner);
  let ticking = false;
  const ticker = setInterval(() => {
    // 앞 틱이 아직 안 끝났으면 건너뛴다 — 겹쳐 돌면 같은 잡이 동시 실행된다.
    if (ticking) return;
    ticking = true;
    void runner
      .tick()
      .catch((error: unknown) => Logger.warn(`잡 루프 틱 실패: ${String(error)}`, 'Worker'))
      .finally(() => {
        ticking = false;
      });
  }, jobTickMs());
  // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
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
