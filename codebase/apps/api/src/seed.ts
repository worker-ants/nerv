// 개발 시드 엔트리 — `pnpm db:seed` (codebase.md §5.1)
// 본체는 @nerv/schema 의 runSeed 다. 이 엔트리는 env 를 읽어 넘기고 결과를 보고한다.

import { Logger } from '@nestjs/common';
import { runSeed } from '@nerv/schema';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    Logger.error('DATABASE_URL 이 없습니다.', 'Seed');
    process.exitCode = 1;
    return;
  }
  if (process.env['NODE_ENV'] === 'production') {
    Logger.error('개발 시드는 production 에서 실행하지 않습니다.', 'Seed');
    process.exitCode = 1;
    return;
  }

  const result = await runSeed(url, process.argv.includes('--force'));
  Logger.log(
    `시드 적재 완료 — 프로젝트 ${result.projects} · 스펙 ${result.specs} · Task ${result.tasks} ` +
      `· 클레임 ${result.claims} · 세션 ${result.sessions} · 이벤트 ${result.events}`,
    'Seed',
  );
}

await main();
