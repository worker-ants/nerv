// E02-S04 — 개발 시드 한 벌.
//
//   WHEN 시드 스크립트를 실행하면, THE SYSTEM SHALL 예시 데이터 한 벌을 멱등하게 적재한다
//   (재실행 시 신규 레코드 0) — REQ-DB-002
//
// 시드는 화면 개발의 "데이터 있음" 경로를 즉시 확인하게 해주는 물건이라(database.md §4 말미),
// 무엇이 몇 건인지가 곧 계약이다. 여기서 그 계약을 고정한다.

import { runMigrations, runSeed } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;

beforeAll(async () => {
  db = await createScratchDb('nerv_seed');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

async function count(table: string, where = ''): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} ${where}`,
  );
  return rows[0]?.n ?? 0;
}

describe('개발 시드 (database.md §4)', () => {
  it('빈 DB 에 한 벌을 적재한다', async () => {
    const result = await runSeed(db.url);
    expect(result).toEqual({
      organizations: 1,
      projects: 1,
      specs: 3,
      tasks: 3,
      claims: 3,
      sessions: 3,
      events: 3,
    });
  });

  it('2회 연속 실행해도 상태가 같다 — 멱등 (REQ-DB-002)', async () => {
    const first = await snapshot();
    const result = await runSeed(db.url);
    const second = await snapshot();

    expect(result.projects).toBe(1);
    expect(second).toEqual(first);
  });

  it('문서 세트가 쓰는 표시 ID 가 그대로 심긴다', async () => {
    // DB 콜레이션에 기대지 않는다 — en_US 로케일은 대소문자를 섞어 정렬한다. JS 에서 정렬한다.
    const specKeys = (await rows<{ key: string }>(`SELECT key FROM spec`)).map((r) => r.key).sort();
    expect(specKeys).toEqual(['SPC-CWC-007', 'SPC-CWC-012', 'channel-web-chat']);

    const taskKeys = (await rows<{ key: string }>(`SELECT key FROM task`)).map((r) => r.key).sort();
    expect(taskKeys).toEqual(['TSK-3f77', 'TSK-a3f8', 'TSK-b904']);

    const sessions = (
      await rows<{ external_session_id: string }>(`SELECT external_session_id FROM agent_session`)
    )
      .map((r) => r.external_session_id)
      .sort();
    expect(sessions).toEqual(['S-2d04', 'S-8f31', 'S-b7e9']);

    expect(await count('requirement', `WHERE ref = 'REQ-CWC-031'`)).toBe(1);
  });

  it('화면마다 "데이터 있음" 경로가 뜬다 (§4 말미)', async () => {
    // S4 작업 보드 — in_progress 2 · blocked 1
    expect(await count('task', `WHERE status = 'in_progress'`)).toBe(2);
    expect(await count('task', `WHERE status = 'blocked'`)).toBe(1);
    // S5 세션 모니터 — active 2 · awaiting_input 1
    expect(await count('agent_session', `WHERE state = 'active'`)).toBe(2);
    expect(await count('agent_session', `WHERE state = 'awaiting_input'`)).toBe(1);
    // S7 승인함 — 열린 질문 1
    expect(await count('question', `WHERE status = 'open'`)).toBe(1);
    // S1 홈 — 읽지 않은 알림 1
    expect(await count('notification', `WHERE state = 'unread'`)).toBe(1);
    // S3 스펙 상세 — SPC-CWC-007 은 v3 superseded → v4 approved (diff 재료)
    expect(await count('spec_version', `WHERE status = 'approved'`)).toBe(2);
    expect(await count('spec_version', `WHERE status = 'superseded'`)).toBe(1);
  });

  it('활성 클레임 3건이 부분 unique 를 위반하지 않는다 — Task 당 하나씩이다', async () => {
    expect(await count('claim', `WHERE status = 'active'`)).toBe(3);
    const dup = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM claim WHERE status='active' GROUP BY task_id HAVING count(*) > 1`,
    );
    expect(dup).toEqual([]);
  });

  it('시드가 심지 않은 조직이 있으면 멈춘다 — 운영 DB TRUNCATE 사고 방지', async () => {
    await pool.query(
      `INSERT INTO organization (id, slug, name) VALUES (gen_random_uuid(), 'other-org', '다른 조직')`,
    );
    await expect(runSeed(db.url)).rejects.toThrow(/시드가 심지 않은 조직/);

    // force 로는 지나간다 — 그리고 그 TRUNCATE 가 남의 조직도 지운다는 게 경고의 이유다
    await expect(runSeed(db.url, true)).resolves.toMatchObject({ organizations: 1 });
  });
});

async function rows<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const { rows: r } = await pool.query<T>(sql);
  return r;
}

/** 시드 결과의 지문 — 테이블별 건수 + 표시 키 목록 */
async function snapshot(): Promise<Record<string, unknown>> {
  const tables = [
    'organization',
    '"user"',
    'project',
    'membership',
    'api_token',
    'agent_session',
    'spec',
    'spec_version',
    'requirement',
    'requirement_version',
    'task',
    'claim',
    'question',
    'event',
    'notification',
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = await count(t);
  return counts;
}
