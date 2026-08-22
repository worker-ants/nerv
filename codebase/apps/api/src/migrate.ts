// drizzle 마이그레이션 적용 후 종료 — compose 기동 서비스와 k8s Job 의 공용 엔트리
// (docs/04-mvp/codebase.md §5.3 · §6.3)
//
// **적용기는 E02-S02 소관이다.** 여기서는 @nerv/schema 의 마이그레이터를 호출만 하고,
// 마이그레이션 파일이 아직 없는 지금은 적용할 것이 0건이라 정상 종료한다 —
// compose 의 depends_on: service_completed_successfully 체인(REQ-CB-008)이 그때까지도 성립하도록.

import { Logger } from '@nestjs/common';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    Logger.error('DATABASE_URL 이 없습니다.', 'Migrate');
    process.exitCode = 1;
    return;
  }

  // E02-S02 가 여기서 @nerv/schema 의 runMigrations(url) 을 호출한다.
  Logger.log('적용할 마이그레이션 0건 — 스냅샷은 E02-S02 에서 들어온다', 'Migrate');
}

await main();
