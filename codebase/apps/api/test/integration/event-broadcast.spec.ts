// E02-S03 — 이벤트 방송 규약 (Valkey `nerv_events`)
//
//   WHEN `event` 테이블에 행이 삽입되고 트랜잭션이 커밋되면,
//   THE SYSTEM SHALL Valkey `nerv_events` 채널로 event id·type·project_id 를 PUBLISH 한다
//   (롤백 시 발행 없음)
//
// 실제 Postgres + 실제 Valkey 상대로 돈다. mock 으로는 "커밋 후에만 방송" 이라는 순서
// 자체가 검증되지 않는다 — 그게 REQ-CB-004 의 전부다.

import { randomUUID } from 'node:crypto';
import { EVENTS_CHANNEL, NERV_EVENT, event as eventTable, newId } from '@nerv/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@nerv/schema/migrate';
import { EventService } from '../../src/modules/event/event.service.js';
import { EventSubscriberService } from '../../src/modules/event/event-subscriber.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const VALKEY_URL = process.env['NERV_VALKEY_URL'] ?? 'redis://localhost:6379';

let db: ScratchDb;
let pool: pg.Pool;
let events: EventService;
let valkey: ValkeyService;
let projectId: string;

/** 방송을 실제 소켓으로 받아 확인한다 — 서비스 내부 상태가 아니라 채널을 본다. */
let listener: Redis;
const received: { id: string; type: string; project_id: string }[] = [];

beforeAll(async () => {
  db = await createScratchDb('nerv_event');
  await runMigrations(db.url);

  pool = new pg.Pool({ connectionString: db.url });
  const drizzleDb = drizzle(pool);

  valkey = new ValkeyService();
  Object.defineProperty(valkey, 'url', { value: VALKEY_URL });
  events = new EventService(drizzleDb, valkey);

  listener = new Redis(VALKEY_URL);
  await listener.subscribe(EVENTS_CHANNEL);
  listener.on('message', (_ch, payload) => {
    received.push(JSON.parse(payload) as (typeof received)[number]);
  });

  projectId = await seedProject(pool);
});

afterAll(async () => {
  await listener.quit();
  await valkey.onApplicationShutdown();
  await pool.end();
  await db.drop();
});

/** 방송은 비동기라 도착까지 짧게 기다린다. */
async function waitFor(predicate: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('EventService.transact — 커밋 후 방송 (REQ-CB-004)', () => {
  it('커밋되면 event 행이 남고 nerv_events 로 방송된다', async () => {
    const before = received.length;

    const envelope = await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId,
        subjectType: 'task',
        subjectId: newId(),
        isAgent: true,
      }),
    );

    await waitFor(() => received.length > before);

    const broadcast = received.at(-1);
    expect(broadcast).toEqual({
      id: envelope.id,
      type: NERV_EVENT.TASK_CLAIMED,
      project_id: projectId,
    });

    // 봉투에는 참조만 있다 — 본문은 싣지 않는다(database.md §3.2)
    expect(Object.keys(broadcast ?? {}).sort()).toEqual(['id', 'project_id', 'type']);

    const rows = await pool.query('SELECT type, is_agent FROM event WHERE id = $1', [envelope.id]);
    expect(rows.rows[0]).toMatchObject({ type: NERV_EVENT.TASK_CLAIMED, is_agent: true });
  });

  it('롤백되면 행도 방송도 없다', async () => {
    const before = received.length;
    const subjectId = newId();

    await expect(
      events.transact(async (_tx, emit) => {
        await emit({
          type: NERV_EVENT.TASK_DONE,
          projectId,
          subjectType: 'task',
          subjectId,
        });
        throw new Error('의도적 실패');
      }),
    ).rejects.toThrow('의도적 실패');

    // 방송이 늦게 올 수도 있으니 잠깐 기다린 뒤에도 없어야 한다
    await new Promise((r) => setTimeout(r, 300));
    expect(received.length).toBe(before);

    const rows = await pool.query('SELECT count(*)::int AS n FROM event WHERE subject_id = $1', [
      subjectId,
    ]);
    expect(rows.rows[0].n).toBe(0);
  });

  it('한 트랜잭션의 여러 이벤트가 커밋 후 순서대로 방송된다', async () => {
    const before = received.length;

    await events.transact(async (_tx, emit) => {
      await emit({
        type: NERV_EVENT.TASK_READY,
        projectId,
        subjectType: 'task',
        subjectId: newId(),
      });
      await emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId,
        subjectType: 'task',
        subjectId: newId(),
      });
    });

    await waitFor(() => received.length >= before + 2);
    expect(received.slice(before).map((e) => e.type)).toEqual([
      NERV_EVENT.TASK_READY,
      NERV_EVENT.TASK_CLAIMED,
    ]);
  });

  it('event 는 append-only 다 — 삽입 순서가 곧 시간 순서다 (UUIDv7)', async () => {
    const ids: string[] = [];
    await events.transact(async (_tx, emit) => {
      for (let i = 0; i < 3; i += 1) {
        const e = await emit({
          type: NERV_EVENT.SESSION_STARTED,
          projectId,
          subjectType: 'agent_session',
          subjectId: newId(),
        });
        ids.push(e.id);
      }
    });
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('방송 실패는 요청을 깨뜨리지 않는다 (D-14)', () => {
  it('Valkey 가 없어도 트랜잭션은 커밋된다 — 유실은 허용된다', async () => {
    const deadValkey = new ValkeyService();
    Object.defineProperty(deadValkey, 'url', { value: 'redis://127.0.0.1:6399' });
    const isolated = new EventService(drizzle(pool), deadValkey);

    const envelope = await isolated.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.GATE_FAILOPEN,
        projectId,
        subjectType: 'project',
        subjectId: projectId,
      }),
    );

    // DB 는 바뀌었고 API 는 성공했다. 방송만 못 나갔다.
    const rows = await pool.query('SELECT count(*)::int AS n FROM event WHERE id = $1', [
      envelope.id,
    ]);
    expect(rows.rows[0].n).toBe(1);
    expect(deadValkey.failureCount).toBeGreaterThan(0);

    await deadValkey.onApplicationShutdown();
  });
});

describe('EventSubscriberService — 파드별 팬아웃', () => {
  it('구독한 봉투를 등록된 수신자에게 흘린다', async () => {
    const subscriber = new EventSubscriberService(valkey);
    const seen: string[] = [];
    const off = subscriber.onBroadcast((e) => seen.push(e.type));
    await subscriber.start();

    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.SPEC_APPROVED,
        projectId,
        subjectType: 'spec_version',
        subjectId: newId(),
      }),
    );

    await waitFor(() => seen.includes(NERV_EVENT.SPEC_APPROVED));
    expect(seen).toContain(NERV_EVENT.SPEC_APPROVED);

    off();
    expect(subscriber.listenerCount).toBe(0);
  });

  it('한 수신자가 던져도 다른 수신자는 받는다', async () => {
    const subscriber = new EventSubscriberService(valkey);
    const good: string[] = [];
    subscriber.onBroadcast(() => {
      throw new Error('나쁜 수신자');
    });
    subscriber.onBroadcast((e) => good.push(e.type));
    await subscriber.start();

    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.SPEC_REJECTED,
        projectId,
        subjectType: 'spec_version',
        subjectId: newId(),
      }),
    );

    await waitFor(() => good.includes(NERV_EVENT.SPEC_REJECTED));
    expect(good).toContain(NERV_EVENT.SPEC_REJECTED);
  });
});

async function seedProject(p: pg.Pool): Promise<string> {
  const orgId = newId();
  const id = newId();
  const suffix = randomUUID().slice(0, 8);
  await p.query(`INSERT INTO organization (id, slug, name) VALUES ($1,$2,'조직')`, [
    orgId,
    `org-${suffix}`,
  ]);
  await p.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,'프로젝트')`,
    [id, orgId, `p-${suffix}`, `K${suffix.slice(0, 4).toUpperCase()}`],
  );
  void eventTable;
  void sql;
  return id;
}
