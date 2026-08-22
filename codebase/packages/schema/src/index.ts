// @nerv/schema — 타입·상수의 단일 정본 (docs/04-mvp/codebase.md §3)
//
// apps/* 는 도메인 상수·이벤트 이름·에러 코드·검증 스키마를 여기서만 import 한다(REQ-CB-006).
// 이 패키지는 순수 선언 + 마이그레이터만 갖는다 — 런타임 로직을 두지 않는다(§1.2).

export * from './constants.js';
export * from './ids.js';
export * from './scopes.js';
export * from './errors.js';
export * from './events.js';
export * from './tables/index.js';
export * from './zod/index.js';

// 마이그레이터 — 순수 선언은 아니지만 §1.2 가 허용한 예외다("순수 선언 + 마이그레이터만").
export { runMigrations, migrationsFolder } from './migrate.js';
export { runSeed, seedSqlPath } from './seed.js';
export type { SeedResult } from './seed.js';
export type { MigrateResult } from './migrate.js';
