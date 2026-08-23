// DB 진입점 — 마이그레이터·시드 (정본: docs/04-mvp/codebase.md §3.1)
//
// **배럴(`@nerv/schema`)이 아니라 여기 있다.** 이 둘은 `pg` 드라이버를 import 하는데,
// 배럴이 그것을 재수출하면 **브라우저가 Postgres 드라이버를 평가하게 된다** — 웹 dev 서버가
// `Buffer is not defined` 로 아무것도 렌더하지 못했다(실측 2026-08-23).
//
// 프로덕션 번들은 tree-shaking 이 지워 줘서 증상이 안 보였다. 빌드가 살려 주는 실수는
// 개발 루프에서만 터지고, 그 종류가 가장 찾기 어렵다 — 그래서 경계를 패키지 표면에 박는다.

export { runMigrations, migrationsFolder } from './migrate.js';
export { runSeed, seedSqlPath } from './seed.js';
export type { MigrateResult } from './migrate.js';
export type { SeedResult } from './seed.js';
