// 개발 시드 실행기 — SQL 정본은 seed/dev-seed.sql (docs/04-mvp/database.md §4)
//
// 시드는 **개발 전용**이다. TRUNCATE 후 재삽입이라 몇 번을 실행해도 같은 상태이며
// 재실행 시 신규 레코드가 0이다(REQ-DB-002). 운영 DB 에 도는 일이 없도록 실행 전에
// 데이터 규모를 확인하고, 이미 사람이 쓴 흔적이 보이면 멈춘다.

import { SEED_ORG_SLUG } from './constants.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export function seedSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, '../seed/dev-seed.sql'),
    resolve(here, '../../seed/dev-seed.sql'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('개발 시드 SQL 을 찾지 못했습니다.');
}

export interface SeedResult {
  organizations: number;
  projects: number;
  specs: number;
  tasks: number;
  claims: number;
  sessions: number;
  events: number;
}

/**
 * 개발 시드를 적재한다.
 *
 * @param force 안전장치 해제. 기본값에서는 시드가 심는 조직(`SEED_ORG_SLUG`) 외의 조직이
 *              이미 있으면 멈춘다 — 운영 데이터를 TRUNCATE 하는 사고를 막는다.
 */
export async function runSeed(databaseUrl: string, force = false): Promise<SeedResult> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    if (!force) {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM organization WHERE slug <> $1`,
        [SEED_ORG_SLUG],
      );
      if (Number(rows[0]?.n ?? 0) > 0) {
        throw new Error(
          '시드가 심지 않은 조직이 이미 있습니다 — 개발 DB 가 맞는지 확인하세요(force 로 무시 가능).',
        );
      }
    }

    await pool.query(readFileSync(seedSqlPath(), 'utf8'));

    const { rows } = await pool.query<Record<keyof SeedResult, string>>(`
      SELECT
        (SELECT count(*) FROM organization)   ::text AS organizations,
        (SELECT count(*) FROM project)        ::text AS projects,
        (SELECT count(*) FROM spec)           ::text AS specs,
        (SELECT count(*) FROM task)           ::text AS tasks,
        (SELECT count(*) FROM claim)          ::text AS claims,
        (SELECT count(*) FROM agent_session)  ::text AS sessions,
        (SELECT count(*) FROM event)          ::text AS events
    `);
    const r = rows[0];
    return {
      organizations: Number(r?.organizations ?? 0),
      projects: Number(r?.projects ?? 0),
      specs: Number(r?.specs ?? 0),
      tasks: Number(r?.tasks ?? 0),
      claims: Number(r?.claims ?? 0),
      sessions: Number(r?.sessions ?? 0),
      events: Number(r?.events ?? 0),
    };
  } finally {
    await pool.end();
  }
}
