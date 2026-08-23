// drizzle 마이그레이션 적용 후 종료 — compose 기동 서비스와 k8s Job 의 공용 엔트리
// (docs/04-mvp/codebase.md §5.3 · §6.3)
//
// 적용기 본체는 @nerv/schema 의 runMigrations 다 — 이 엔트리는 env 를 읽어 넘기고 종료한다.
// 왕복 멱등은 drizzle 적용 이력이 보장하므로 이 프로세스를 두 번 돌려도 변경 0건이다(REQ-DB-001).

import { Logger } from '@nestjs/common';
import { runMigrations } from '@nerv/schema/migrate';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    Logger.error('DATABASE_URL 이 없습니다.', 'Migrate');
    process.exitCode = 1;
    return;
  }

  const { applied } = await runMigrations(url);
  Logger.log(`마이그레이션 적용 완료 — 이력 ${applied}건`, 'Migrate');
}

await main();
