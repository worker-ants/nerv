// drizzle-kit 설정 — docs/04-mvp/codebase.md §3.1
//
// 마이그레이션 산출물(drizzle/*.sql)은 선언과 반드시 같은 PR 에 담긴다 —
// CI 의 스키마 드리프트 검사가 그것을 강제한다(REQ-CB-007 · REQ-CB-018).
// 0001 스냅샷과 왕복 멱등 규칙은 docs/04-mvp/database.md §1.2 정본.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/tables/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
