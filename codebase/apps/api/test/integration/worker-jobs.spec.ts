// E04-S04 — 잡 루프 단일 실행(advisory lock) + 주기 스케줄
//
// **replica 1 은 배포 규칙이고 lock 이 최종 방어선이다**(REQ-CB-011). 이 파일이 검증하는 것은
// "워커가 두 개 떠도 하나만 돈다"이고, 그것을 mock 으로 확인하면 아무 의미가 없다 —
// pg_try_advisory_lock 의 의미론 자체가 검증 대상이라 실제 Postgres 커넥션 2개로 본다.

import { newId, PARTITION_MONTHS_AHEAD, WORKER_ADVISORY_LOCK_KEY } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdvisoryLock } from '../../src/worker/advisory-lock.js';
import { ClaimService } from '../../src/modules/task/claim.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { JobRunner } from '../../src/worker/job-runner.js';
import { LeaseReaperJob } from '../../src/worker/jobs/lease-reaper.job.js';
import { NotificationJob } from '../../src/worker/jobs/notification.job.js';
import { PartitionJob } from '../../src/worker/jobs/partition.job.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { SessionStaleJob } from '../../src/worker/jobs/session-stale.job.js';
import { EmbeddingJob } from '../../src/worker/jobs/embedding.job.js';
import { EmbeddingService } from '../../src/modules/spec/embedding.service.js';
import { ExportJob } from '../../src/worker/jobs/export.job.js';
import { RetentionJob } from '../../src/worker/jobs/retention.job.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let poolA: pg.Pool;
let poolB: pg.Pool;

beforeAll(async () => {
  db = await createScratchDb('nerv_worker');
  await runMigrations(db.url);
  // 워커마다 **자기 풀**이다 — advisory lock 은 세션 수준이라 어느 커넥션이 쥐었는지가
  // 곧 어느 워커가 쥐었는지다. 락은 전용 커넥션 하나를 붙잡고 있으므로(advisory-lock.ts)
  // 풀에는 최소 2개가 필요하다: 하나는 락, 나머지가 잡의 질의다. max: 1 이면 잡이
  // 커넥션을 기다리며 멈춘다 — 예전 구현이 락을 반납했기 때문에 1로도 돌았던 것이다.
  poolA = new pg.Pool({ connectionString: db.url, max: 3 });
  poolB = new pg.Pool({ connectionString: db.url, max: 3 });
});

afterAll(async () => {
  await poolA.end();
  await poolB.end();
  await db.drop();
});

function runnerFor(pool: pg.Pool): { runner: JobRunner; lock: AdvisoryLock } {
  const drizzleDb = drizzle(pool);
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const lock = new AdvisoryLock(pool);
  const runner = new JobRunner(
    lock,
    new LeaseReaperJob(new ClaimService(), drizzleDb),
    new SessionStaleJob(new SessionService(new EventService(drizzleDb, silent), drizzleDb)),
    new NotificationJob(new NotificationService(drizzleDb)),
    new EmbeddingJob(new EmbeddingService(drizzleDb)),
    new RetentionJob(drizzleDb),
    new ExportJob(
      new SpecService(
        new EventService(drizzleDb, silent),
        new SpecCheckService(drizzleDb),
        new SpecRelationService(drizzleDb),
        drizzleDb,
      ),
      drizzleDb,
    ),
    new PartitionJob(drizzleDb),
  );
  return { runner, lock };
}

describe('알림 라우팅은 창에 막히지 않는다 (REQ-API-064 계열)', () => {
  it('알림을 만들지 않는 이벤트가 창을 채워도 그 뒤의 결재 요청이 읽힌다', async () => {
    const { NotificationService } = await import('../../src/modules/event/notification.service.js');
    const orgId = newId();
    const projectId = newId();
    const actor = newId();
    const watcher = newId();
    await poolA.query(`INSERT INTO organization (id, slug, name) VALUES ($1,$2,'알림')`, [
      orgId,
      `ntf-${orgId.slice(-6)}`,
    ]);
    await poolA.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,'알림')`,
      [projectId, orgId, `ntf-${projectId.slice(-6)}`, `N${projectId.slice(-2).toUpperCase()}`],
    );
    for (const [id, email] of [
      [actor, 'actor@example.com'],
      [watcher, 'watcher@example.com'],
    ] as const) {
      await poolA.query(
        `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,'x','active')`,
        [id, `${id.slice(-6)}-${email}`],
      );
      await poolA.query(
        `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
        [newId(), orgId, projectId, id],
      );
    }

    // ① 알림을 만들지 않는 이벤트로 창(200)을 넘긴다 — 카탈로그 밖 타입이다
    for (let i = 0; i < 205; i += 1) {
      await poolA.query(
        `INSERT INTO event (id, project_id, type, subject_type, subject_id, actor_user_id, occurred_at)
         VALUES ($1,$2,'spec.draft_updated','spec_version',$3,$4, now() - interval '1 hour' + ($5 || ' seconds')::interval)`,
        [newId(), projectId, newId(), actor, i],
      );
    }
    // ② 그 뒤에 사람을 불러야 하는 이벤트 하나
    const importantId = newId();
    await poolA.query(
      `INSERT INTO event (id, project_id, type, subject_type, subject_id, actor_user_id, occurred_at)
       VALUES ($1,$2,'approval.requested','approval',$3,$4, now())`,
      [importantId, projectId, newId(), actor],
    );

    // 예전에는 창이 ①로 가득 차 ②가 **다시는** 읽히지 않았다(그 이벤트들은 표식을
    // 남기지 않으므로 다음 실행에서도 같은 200건이 잡힌다).
    const created = await new NotificationService(drizzle(poolA)).route();
    expect(created).toBeGreaterThan(0);

    const { rows } = await poolA.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notification WHERE event_id = $1`,
      [importantId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('월 파티션 — 두 달 뒤에 멈추지 않는다 (REQ-DB-021)', () => {
  /** 그 달의 event 파티션이 있는가 */
  async function hasPartition(monthsFromNow: number): Promise<boolean> {
    const { rows } = await poolA.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class
        WHERE relkind = 'r'
          AND relname = 'event_' || to_char((current_date + ($1 || ' month')::interval), '"y"YYYY"m"MM')`,
      [monthsFromNow],
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  it('잡이 돌면 앞으로 몇 달치가 생긴다 — 0000 은 당월·익월만 만든다', async () => {
    // 마이그레이션 직후 상태를 재현한다: +2 개월 파티션을 지운다(0000 은 두 달만 만든다)
    const { rows: names } = await poolA.query<{ event: string; activity: string }>(
      `SELECT 'event_' || to_char((current_date + ($1 || ' month')::interval), '"y"YYYY"m"MM') AS event,
              'activity_' || to_char((current_date + ($1 || ' month')::interval), '"y"YYYY"m"MM') AS activity`,
      [2],
    );
    await poolA.query(`DROP TABLE IF EXISTS ${names[0]!.event}`);
    await poolA.query(`DROP TABLE IF EXISTS ${names[0]!.activity}`);
    expect(await hasPartition(2)).toBe(false);

    const { runner, lock } = runnerFor(poolA);
    try {
      const ran = await runner.tick(0);
      expect(ran).toContain('partition');
    } finally {
      // 세션 수준 lock 이라 놓지 않으면 뒤 테스트의 "인계" 시나리오가 깨진다
      await lock.release();
    }

    expect(await hasPartition(0)).toBe(true);
    expect(await hasPartition(2)).toBe(true);
    expect(await hasPartition(PARTITION_MONTHS_AHEAD)).toBe(true);
  });

  it('두 달 뒤의 이벤트도 적재된다 — 파티션이 없으면 도메인 트랜잭션째 롤백된다', async () => {
    const { runner, lock } = runnerFor(poolA);
    try {
      await runner.tick(0);
    } finally {
      await lock.release();
    }

    // 이벤트는 도메인 쓰기와 같은 트랜잭션에 있다(REQ-CB-004) — 여기서 실패하면
    // 승인도 클레임도 함께 사라진다. 그래서 미래 시각의 INSERT 를 직접 본다.
    const orgId = newId();
    const projectId = newId();
    await poolA.query(`INSERT INTO organization (id, slug, name) VALUES ($1,$2,'파티션')`, [
      orgId,
      `part-${orgId.slice(-6)}`,
    ]);
    await poolA.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,'파티션')`,
      [projectId, orgId, `part-${projectId.slice(-6)}`, `P${projectId.slice(-2).toUpperCase()}`],
    );

    await expect(
      poolA.query(
        `INSERT INTO event (id, project_id, type, subject_type, subject_id, occurred_at)
         VALUES ($1, $2, 'spec.approved', 'spec_version', $3,
                 (date_trunc('month', current_date) + interval '2 month' + interval '1 day'))`,
        [newId(), projectId, newId()],
      ),
    ).resolves.toBeDefined();
  });
});

describe('E04-S04 잡 루프는 하나만 돈다', () => {
  it('두 워커가 떠도 lock 을 쥔 쪽만 잡을 실행한다 (REQ-CB-011)', async () => {
    const a = runnerFor(poolA);
    const b = runnerFor(poolB);

    const ranA = await a.runner.tick(0);
    const ranB = await b.runner.tick(0);

    expect(ranA.length).toBeGreaterThan(0);
    expect(ranB).toEqual([]); // 조용히 대기한다 — 실패가 아니라 정상 경로다
    expect(a.lock.isHeld).toBe(true);
    expect(b.lock.isHeld).toBe(false);

    // 앞 워커가 죽으면(= lock 해제) 다음 틱에서 뒤 워커가 이어받는다
    await a.lock.release();
    expect(await b.runner.tick(0)).not.toEqual([]);
    await b.lock.release();
  });

  it('락은 전용 커넥션을 쥔다 — 풀이 커넥션을 돌려도 놓지 않는다 (REQ-CB-011)', async () => {
    // 예전에는 풀에서 빌린 커넥션으로 락을 잡고 곧바로 반납했다. 세션 수준 락은 그 물리
    // 커넥션에 묶이므로 풀이 유휴 커넥션을 닫는 순간(기본 10초) Postgres 가 락을 놓았고,
    // 메모리의 `held` 만 true 로 남아 **락 없이 도는 워커**가 됐다.
    const a = runnerFor(poolA);
    const b = runnerFor(poolB);
    try {
      expect(await a.lock.acquire()).toBe(true);

      // 락을 쥔 뒤 같은 풀로 여러 질의를 돌려 커넥션을 순환시킨다
      for (let i = 0; i < 5; i += 1) await poolA.query('SELECT 1');

      // 두 번째 워커는 여전히 못 잡는다 — 락이 살아 있다는 뜻이다
      expect(await b.lock.acquire()).toBe(false);
      expect(a.lock.isHeld).toBe(true);

      // DB 가 보는 사실로도 확인한다 — 이 데이터베이스에서 그 키를 쥔 세션은 하나뿐이다
      const { rows } = await poolB.query<{ n: number }>(
        `SELECT count(DISTINCT pid)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
        [WORKER_ADVISORY_LOCK_KEY.toString()],
      );
      expect(rows[0]?.n).toBe(1);

      await a.lock.release();
      expect(await b.lock.acquire()).toBe(true);
    } finally {
      // 실패해도 놓는다 — 쥔 채로 끝나면 뒤 테스트가 전부 무너진다
      await a.lock.release();
      await b.lock.release();
    }
  });

  it('키는 @nerv/schema 정본이다 — 워커와 검사 도구가 같은 값을 본다', async () => {
    const { lock } = runnerFor(poolA);
    expect(lock.key).toBe(WORKER_ADVISORY_LOCK_KEY);
    await lock.acquire();
    const { rows } = await drizzle(poolB).execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(${WORKER_ADVISORY_LOCK_KEY.toString()}::bigint) AS locked`,
    );
    expect(rows[0]?.locked).toBe(false);
    await lock.release();
    await drizzle(poolB).execute(sql`SELECT pg_advisory_unlock_all()`);
  });
});

describe('E04-S04 주기 스케줄', () => {
  it('주기가 지나지 않은 잡은 다시 돌지 않는다 — 틱마다 전부 도는 게 아니다', async () => {
    const { runner, lock } = runnerFor(poolA);
    const first = await runner.tick(1_000_000);
    expect(first).toEqual(runner.jobNames().slice(0, first.length));

    const immediate = await runner.tick(1_000_100); // 100ms 뒤
    expect(immediate).toEqual([]);

    const later = await runner.tick(1_000_000 + 61_000); // 하트비트 간격 뒤
    expect(later).toContain('lease-reaper');
    // 임베딩은 **주기가 변하는 유일한 잡**이다(REQ-CB-027). 이 환경에는 제공자가 없어
    // 첫 판이 오류로 끝나므로 물러난 주기(5분)를 쓴다 — 61초 뒤에는 아직 차례가 아니다.
    expect(later).not.toContain('embedding');
    await lock.release();
  });

  it('잡 하나가 실패해도 나머지는 돈다 — 회수가 멈추면 그게 곧 클레임 적체다', async () => {
    const { runner, lock } = runnerFor(poolA);
    // 임베딩 제공자는 이 환경에 없다 — 그 실패가 다른 잡을 막지 않아야 한다
    const ran = await runner.tick(2_000_000);
    expect(ran).toContain('lease-reaper');
    expect(ran).toContain('session-stale');
    expect(newId()).toBeDefined();
    await lock.release();
  });
});

// 2026-09-01 사람 결정 — 원문을 보관하기로 했으니 보존이 한 쌍이다.
// 잡은 이미 있었는데(90일 삭제) **지우기 전에 접는 단계**가 없었다: 지우고 나면 그 세션은
// 아무것도 안 한 것처럼 보였고, 빈 레일은 "기록이 없다" 와 "아무것도 안 했다" 를 구별하지 못한다.
describe('보존 — 지우기 전에 접는다 (REQ-API-067)', () => {
  it('도구별 횟수를 세션에 남기고 원문을 지운다', async () => {
    const pool = poolA;
    const orgId = newId();
    const projectId = newId();
    const userId = newId();
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'ret','R')`, [orgId]);
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'ret@example.com','보존','active')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'ret','RET','ret')`,
      [projectId, orgId],
    );
    const sessionId = newId();
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','host','complete')`,
      [sessionId, projectId, userId],
    );
    // 월 파티션이라 그 달의 파티션이 있어야 넣을 수 있다 — 실제 운영에서는 그 달이
    // 현재였을 때 만들어져 있다(0000 의 `nerv_ensure_month_partitions`)
    for (const days of [100, 1, 0]) {
      await pool.query(
        `SELECT nerv_ensure_month_partitions(date_trunc('month', now() - make_interval(days => $1))::date)`,
        [days],
      );
    }
    // 100일 전 활동 — 기본 정책(90일)의 바깥이다
    for (const [i, tool] of ['Bash', 'Bash', 'Edit'].entries()) {
      await pool.query(
        `INSERT INTO activity (id, session_id, project_id, seq, type, title, tool_name, created_at)
         VALUES ($1,$2,$3,$4,'action',$5,$5, now() - interval '100 days')`,
        [newId(), sessionId, projectId, i + 1, tool],
      );
    }
    // 어제 것은 남아야 한다 — 보존은 오래된 것만 걷는다
    await pool.query(
      `INSERT INTO activity (id, session_id, project_id, seq, type, title, tool_name, created_at)
       VALUES ($1,$2,$3,99,'action','Bash · 최근','Bash', now() - interval '1 day')`,
      [newId(), sessionId, projectId],
    );

    const report = await new RetentionJob(drizzle(pool)).run();
    expect(report.activities_deleted).toBe(3);

    const { rows } = await pool.query<{ activity_summary: Record<string, number> }>(
      `SELECT activity_summary FROM agent_session WHERE id = $1`,
      [sessionId],
    );
    // 원문은 사라졌지만 **규모는 남는다**
    expect(rows[0]?.activity_summary).toMatchObject({ Bash: 2, Edit: 1 });

    const { rows: left } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM activity WHERE session_id = $1`,
      [sessionId],
    );
    expect(left[0]?.n).toBe('1');
  });
});
