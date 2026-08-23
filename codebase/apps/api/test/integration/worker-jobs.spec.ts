// E04-S04 — 잡 루프 단일 실행(advisory lock) + 주기 스케줄
//
// **replica 1 은 배포 규칙이고 lock 이 최종 방어선이다**(REQ-CB-011). 이 파일이 검증하는 것은
// "워커가 두 개 떠도 하나만 돈다"이고, 그것을 mock 으로 확인하면 아무 의미가 없다 —
// pg_try_advisory_lock 의 의미론 자체가 검증 대상이라 실제 Postgres 커넥션 2개로 본다.

import { newId, WORKER_ADVISORY_LOCK_KEY } from '@nerv/schema';
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
  // 커넥션 1개씩 — advisory lock 은 **세션 수준**이라 풀이 커넥션을 바꾸면 의미가 흐려진다.
  poolA = new pg.Pool({ connectionString: db.url, max: 1 });
  poolB = new pg.Pool({ connectionString: db.url, max: 1 });
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
  const lock = new AdvisoryLock(drizzleDb);
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
  );
  return { runner, lock };
}

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
    expect(later).not.toContain('embedding'); // 임베딩은 5배 주기다
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
