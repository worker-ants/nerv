// E02-S02 — 초기 스냅샷 마이그레이션 + 왕복 멱등.
//
//   WHEN 같은 마이그레이션을 2회 연속 실행하면,
//   THE SYSTEM SHALL 두 번째 실행을 스키마 변경 0으로 종료한다 (REQ-DB-001)
//
// 이 스위트가 지키는 것은 그 한 줄만이 아니다. 0000_init.sql 에는 drizzle 이 표현하지 못해
// **손으로 동봉한** raw SQL 이 들어 있다(확장·파티션·순환 FK·트리거 — database.md §1.2).
// 생성기가 만들어주지 않는 부분이라 조용히 사라져도 타입 검사에 걸리지 않는다 —
// 그래서 적용된 스키마의 사실을 직접 조회해 고정한다.

import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { PARTITION_MONTHS_AHEAD } from '@nerv/schema';
import { migrationsFolder, runMigrations } from '@nerv/schema/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDb, withClient } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;

beforeAll(async () => {
  db = await createScratchDb('nerv_migrate');
});

afterAll(async () => {
  await db.drop();
});

describe('초기 스냅샷 적용 (database.md §2)', () => {
  // 마이그레이션 수는 **디렉터리에서 센다.** 숫자를 박아 두면 파일이 하나 늘 때마다
  // "무엇이 틀렸는지 말해 주지 않는 실패"로 깨진다(실측: 0003_multi_role 을 더하며 깨졌다).
  // 이 테스트가 지키려는 것은 개수가 아니라 **전량 적용과 왕복 멱등**이다.
  const MIGRATIONS = readdirSync(migrationsFolder()).filter((f) => f.endsWith('.sql')).length;

  it('빈 DB 에 오류 없이 적용된다', async () => {
    const first = await runMigrations(db.url);
    expect(first.applied).toBe(MIGRATIONS);
  });

  it('2회 연속 실행해도 변경 0건이다 — 왕복 멱등 (REQ-DB-001)', async () => {
    const before = await snapshotSchema();
    const second = await runMigrations(db.url);
    const after = await snapshotSchema();

    expect(second.applied).toBe(MIGRATIONS); // 이력이 늘지 않는다 = 재적용하지 않았다
    expect(after).toEqual(before);
  });

  it('도메인 테이블 32종 + 검색 인덱스 1종이 존재한다', async () => {
    const names = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            AND table_name NOT LIKE 'event_y%' AND table_name NOT LIKE 'activity_y%'
          ORDER BY table_name`,
      );
      return rows.map((r) => r.table_name);
    });
    // 32 도메인 엔티티 + 인프라 4종(엔티티 아님):
    //   spec_chunk_embedding(§2.15) · auth_session·auth_account·auth_verification(§2.16)
    // 30번째는 `invitation` 이다(2026-08-27 · 사람 결정 — 조직 초대)
    // 31번째는 `finding_comment` 다(2026-08-30 · 사람 결정 — 리뷰 피드백 흐름)
    // 32번째는 `attachment` 다(2026-09-01 · 사람 결정 — 디자인 시안 첨부)
    expect(names).toHaveLength(36);
    expect(names).toContain('spec_chunk_embedding');
    expect(names).toEqual(
      expect.arrayContaining(['auth_session', 'auth_account', 'auth_verification']),
    );
  });

  it('enum 39종이 생성된다 (§2.1)', async () => {
    const count = await scalar(`SELECT count(*)::int FROM pg_type WHERE typtype = 'e'`);
    expect(count).toBe(39);
  });
});

describe('동봉된 raw SQL — 생성기가 만들어주지 않는 부분 (§1.2)', () => {
  it('확장 4종이 설치된다 — 컬럼 타입보다 먼저 있어야 한다 (§2.1)', async () => {
    const names = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ extname: string }>(
        `SELECT extname FROM pg_extension
          WHERE extname IN ('citext','pgcrypto','pg_trgm','vector') ORDER BY extname`,
      );
      return rows.map((r) => r.extname);
    });
    expect(names).toEqual(['citext', 'pg_trgm', 'pgcrypto', 'vector']);
  });

  it('event · activity 가 RANGE 파티션 부모다 (§2.14)', async () => {
    const parents = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relkind = 'p' ORDER BY relname`,
      );
      return rows.map((r) => r.relname);
    });
    expect(parents).toEqual(['activity', 'event']);
  });

  it('마이그레이션이 앞으로 몇 달치 파티션까지 보장한다 (§2.14)', async () => {
    const count = await scalar(
      `SELECT count(*)::int FROM pg_class
        WHERE relkind = 'r' AND (relname LIKE 'event_y%' OR relname LIKE 'activity_y%')`,
    );
    // 0000 은 당월+익월만 만든다. 그 뒤를 잇는 것은 워커인데(§2.14) 워커가 뜨기 전에도
    // 서버는 이벤트를 쓰므로, 마이그레이터가 같은 함수로 창을 채운다.
    // 테이블 2종 × (오늘 ~ +PARTITION_MONTHS_AHEAD 개월)
    expect(count).toBe(2 * (PARTITION_MONTHS_AHEAD + 1));
  });

  it('activity 파티션마다 (session_id, seq) unique 가 붙는다 (§2.6)', async () => {
    const count = await scalar(
      `SELECT count(*)::int FROM pg_indexes
        WHERE schemaname = 'public' AND indexname LIKE 'activity_y%_session_seq_uq'`,
    );
    expect(count).toBe(PARTITION_MONTHS_AHEAD + 1);
  });

  it('순환 참조 FK 가 걸린다 (§2.11)', async () => {
    const names = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conname IN ('spec_current_version_fk','spec_version_change_request_fk','agent_session_current_task_fk')
          ORDER BY conname`,
      );
      return rows.map((r) => r.conname);
    });
    expect(names).toEqual([
      'agent_session_current_task_fk',
      'spec_current_version_fk',
      'spec_version_change_request_fk',
    ]);
  });

  it('nerv_* 함수 4종과 트리거 2종이 존재한다 (§2.13)', async () => {
    const fns = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname LIKE 'nerv\\_%' ORDER BY proname`,
      );
      return rows.map((r) => r.proname);
    });
    expect(fns).toEqual([
      'nerv_ensure_month_partitions',
      'nerv_glob_overlap',
      'nerv_spec_version_freeze',
      'nerv_touch_updated_at',
    ]);

    const triggers = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`,
      );
      return rows.map((r) => r.tgname);
    });
    expect(triggers).toEqual(['spec_version_freeze', 'task_touch_updated_at']);
  });
});

describe('무결성 규칙이 DB 에서 실제로 강제된다', () => {
  it('draft 가 아닌 SpecVersion 의 본문은 동결된다 — 규칙 1 (§2.13)', async () => {
    await withClient(db.url, async (c) => {
      const { orgId, userId, projectId } = await seedTenancy(c);
      const specId = randomUUID();
      const versionId = randomUUID();

      await c.query(
        `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','x','X')`,
        [specId, projectId],
      );
      await c.query(
        `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
         VALUES ($1,$2,1,'draft','원문', digest('원문','sha256'), $3)`,
        [versionId, specId, userId],
      );

      // draft 인 동안에는 고칠 수 있다 — 가변 구간은 draft 하나뿐이다
      await expect(
        c.query(`UPDATE spec_version SET body_md = '수정' WHERE id = $1`, [versionId]),
      ).resolves.toBeDefined();

      await c.query(`UPDATE spec_version SET status = 'approved' WHERE id = $1`, [versionId]);

      // approved 가 된 뒤에는 트리거가 막는다
      await expect(
        c.query(`UPDATE spec_version SET body_md = '몰래 수정' WHERE id = $1`, [versionId]),
      ).rejects.toThrow(/frozen/);

      void orgId;
    });
  });

  it('한 Task 에 활성 클레임은 하나뿐이다 — 규칙 2 (partial unique)', async () => {
    await withClient(db.url, async (c) => {
      const { userId, projectId } = await seedTenancy(c);
      const taskId = randomUUID();
      await c.query(
        `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
         VALUES ($1,$2,'T-1','작업','ready','g','o','t','b')`,
        [taskId, projectId],
      );

      const insertClaim = (id: string) =>
        c.query(
          `INSERT INTO claim (id, project_id, task_id, user_id, status, lease_expires_at)
           VALUES ($1,$2,$3,$4,'active', now() + interval '30 minutes')`,
          [id, projectId, taskId, userId],
        );

      await insertClaim(randomUUID());
      await expect(insertClaim(randomUUID())).rejects.toThrow(/claim_task_active_uq/);

      // 해제되면 다시 잡을 수 있다 — 부분 unique 는 active 만 본다
      await c.query(`UPDATE claim SET status = 'released' WHERE task_id = $1`, [taskId]);
      await expect(insertClaim(randomUUID())).resolves.toBeDefined();
    });
  });

  it('위임 명세 4요소가 없으면 ready 로 갈 수 없다 — 규칙 3 (CHECK)', async () => {
    await withClient(db.url, async (c) => {
      const { projectId } = await seedTenancy(c);
      await expect(
        c.query(
          `INSERT INTO task (id, project_id, key, title, status, goal_md)
           VALUES ($1,$2,'T-2','미비','ready','목표만 있음')`,
          [randomUUID(), projectId],
        ),
      ).rejects.toThrow(/task_delegation_spec_ck/);
    });
  });

  it('nerv_glob_overlap 이 보수적으로 판정한다 (§2.13 · spec-workflow §4.4)', async () => {
    const cases: [string, string, boolean][] = [
      ['src/a/**', 'src/a/b.ts', true],
      ['src/a/**', 'src/b/c.ts', false],
      ['src/*/x.ts', 'src/a/x.ts', true],
      ['a/b/c.ts', 'a/b/c.ts', true],
      ['a/b.ts', 'c/d.ts', false],
    ];
    for (const [g1, g2, expected] of cases) {
      const got = await scalar<boolean>(`SELECT nerv_glob_overlap($1, $2)`, [g1, g2]);
      expect({ g1, g2, got }).toEqual({ g1, g2, got: expected });
    }
  });
});

// ── 도우미 ─────────────────────────────────────────────────────────────────

async function scalar<T = number>(sql: string, params: unknown[] = []): Promise<T> {
  return withClient(db.url, async (c) => {
    const { rows } = await c.query<Record<string, T>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  });
}

/** 스키마 비교용 — 테이블·컬럼·제약·인덱스의 지문 */
async function snapshotSchema(): Promise<string[]> {
  return withClient(db.url, async (c) => {
    const { rows } = await c.query<{ fingerprint: string }>(
      `SELECT table_name || '.' || column_name || ':' || data_type AS fingerprint
         FROM information_schema.columns WHERE table_schema = 'public'
       UNION ALL
       SELECT 'idx:' || indexname FROM pg_indexes WHERE schemaname = 'public'
       UNION ALL
       SELECT 'con:' || conname FROM pg_constraint
       ORDER BY 1`,
    );
    return rows.map((r) => r.fingerprint);
  });
}

async function seedTenancy(c: import('pg').Client): Promise<{
  orgId: string;
  userId: string;
  projectId: string;
}> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const suffix = projectId.slice(0, 8);
  await c.query(`INSERT INTO organization (id, slug, name) VALUES ($1,$2,'조직')`, [
    orgId,
    `org-${suffix}`,
  ]);
  await c.query(`INSERT INTO "user" (id, email, display_name) VALUES ($1,$2,'사람')`, [
    userId,
    `u-${suffix}@example.com`,
  ]);
  await c.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,'프로젝트')`,
    [projectId, orgId, `p-${suffix}`, `K${suffix.slice(0, 4).toUpperCase()}`],
  );
  return { orgId, userId, projectId };
}
