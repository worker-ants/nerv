// drizzle 마이그레이터 — apps/api/src/migrate.ts 가 호출한다(codebase.md §3.1).
// compose 의 migrate 서비스와 k8s 의 nerv-migrate Job 이 **같은 코드 경로**를 쓴다.
//
// 왕복 멱등은 drizzle 의 적용 이력 테이블(__drizzle_migrations)이 보장한다 —
// 이미 적용된 파일은 건너뛰므로 같은 명령을 두 번 실행해도 변경 0건이다(REQ-DB-001).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { PARTITION_MONTHS_AHEAD } from './constants.js';

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
  /** 보장한 월 파티션 창의 길이(개월) — 0000 이 만드는 두 달을 포함한다 */
  partitionsAhead: number;
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
    // **파티션 창을 여기서도 채운다.** 0000 은 당월+익월만 만들고 그 뒤는 워커의 몫인데
    // (§2.14), 워커가 뜨기 전에도 서버는 이벤트를 쓴다 — 마이그레이션 직후의 빈 창이
    // 곧 "승인이 롤백되는 서버" 이므로 같은 함수를 한 번 돌려 둔다. 함수는 IF NOT EXISTS 라
    // 재실행이 안전하다(REQ-DB-001 의 왕복 멱등을 깨지 않는다).
    await pool.query(
      `SELECT nerv_ensure_month_partitions((current_date + (n || ' month')::interval)::date)
         FROM generate_series(0, $1) AS n`,
      [PARTITION_MONTHS_AHEAD],
    );
    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    return { applied: Number(rows[0]?.count ?? 0), partitionsAhead: PARTITION_MONTHS_AHEAD };
  } finally {
    await pool.end();
  }
}

/** drizzle 이 파일마다 적는 순서표 한 줄 — `when` 이 적용 이력의 `created_at` 과 같은 값이다 */
export interface JournalEntry {
  tag: string;
  when: number;
}

/** 이 패키지에 동봉된 마이그레이션의 순서표 */
export function journalEntries(folder: string = migrationsFolder()): JournalEntry[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return journal.entries.map(({ tag, when }) => ({ tag, when }));
}

/**
 * 아직 적용되지 않은 마이그레이션 — **drizzle 적용기와 같은 규칙**이다.
 *
 * 적용기는 이력의 가장 늦은 `created_at` 보다 나중(`when` 이 큰) 파일만 돌린다. 판정을 따로
 * 만들면 "검사는 남았다고 하는데 적용기는 할 것이 없다" 는 어긋남이 생긴다. 이력이 코드보다
 * **앞서** 있는 것(옛 파드가 새 스키마 위에서 도는 롤링 배포 · 다른 워크트리가 먼저 올린 DB)은
 * 뒤처진 것이 아니다 — expand-contract 가 그 순간을 허용한다(codebase.md §6.3).
 */
export function pendingMigrations(
  entries: readonly JournalEntry[],
  lastAppliedAt: number | null,
): string[] {
  return entries.filter((e) => lastAppliedAt === null || e.when > lastAppliedAt).map((e) => e.tag);
}

export interface SchemaStatus {
  /** 이력에 적힌 마이그레이션 수 */
  applied: number;
  /** 이 코드에 동봉된 마이그레이션 수 */
  expected: number;
  /** 아직 적용되지 않은 파일 — 비어 있어야 코드가 기대하는 스키마다 */
  pending: string[];
}

/**
 * DB 의 스키마가 이 코드를 따라왔는가(REQ-CB-056). 읽기만 한다.
 *
 * 이력 테이블이 없으면 한 번도 적용하지 않은 DB 다 — 전부가 남은 것이다.
 */
export async function schemaStatus(databaseUrl: string): Promise<SchemaStatus> {
  const entries = journalEntries();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const { rows } = await pool
      .query<{ applied: number; last: string | null }>(
        'SELECT count(*)::int AS applied, max(created_at)::text AS last FROM drizzle.__drizzle_migrations',
      )
      .catch((error: unknown) => {
        // 42P01 relation 없음 · 3F000 스키마 없음 — 적용 이력 자체가 없다
        const code = (error as { code?: string }).code;
        if (code === '42P01' || code === '3F000') return { rows: [{ applied: 0, last: null }] };
        throw error;
      });
    const row = rows[0];
    const last = row?.last === null || row?.last === undefined ? null : Number(row.last);
    return {
      applied: row?.applied ?? 0,
      expected: entries.length,
      pending: pendingMigrations(entries, last),
    };
  } finally {
    await pool.end();
  }
}
