// drizzle 마이그레이터 — apps/api/src/migrate.ts 가 호출한다(codebase.md §3.1).
// compose 의 migrate 서비스와 k8s 의 nerv-migrate Job 이 **같은 코드 경로**를 쓴다.
//
// 왕복 멱등은 drizzle 의 적용 이력 테이블(__drizzle_migrations)이 보장한다 —
// 이미 적용된 파일은 건너뛰므로 같은 명령을 두 번 실행해도 변경 0건이다(REQ-DB-001).

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** 이 패키지에 동봉된 마이그레이션 폴더. dist 에서 실행돼도 패키지 루트를 찾는다. */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, '../drizzle'), resolve(here, '../../drizzle')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('drizzle 마이그레이션 폴더를 찾지 못했습니다.');
}

export interface MigrateResult {
  /** 적용 후 존재하는 마이그레이션 이력 수 */
  applied: number;
}

/**
 * 마이그레이션을 적용하고 종료한다. 커넥션은 이 함수가 열고 닫는다 —
 * migrate 는 기동 시 1회 실행되는 단발 프로세스이므로 풀을 남기지 않는다.
 */
export async function runMigrations(databaseUrl: string): Promise<MigrateResult> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: migrationsFolder() });
    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    return { applied: Number(rows[0]?.count ?? 0) };
  } finally {
    await pool.end();
  }
}
