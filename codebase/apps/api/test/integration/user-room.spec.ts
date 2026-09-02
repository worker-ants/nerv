// L2 — 개인 룸(`user:{id}`)으로 실제로 무언가 나가는가 (api.md §3.3 · §3.5)
//
//   WHEN 알림이 파생되면,
//   THE SYSTEM SHALL `notification.created` 를 수신자의 `user:{id}` 룸으로 방송한다
//
// 원래 결함은 "빈 룸"이었다: WS 는 접속하면 `user:{id}` 를 자동 join 하고 `/sse/me` 는
// 200 으로 열리는데, 그 룸으로 흐르는 봉투가 **하나도 없었다**. 종은 새로고침해야 숫자가
// 바뀌었다. 그런 결함은 실제 Valkey 를 태워야만 드러난다 — 팬아웃 계산만 보면 통과한다.

import { EVENTS_CHANNEL, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventService } from '../../src/modules/event/event.service.js';
import { FanoutService } from '../../src/modules/event/fanout.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import type { BroadcastEnvelope } from '../../src/modules/event/event-subscriber.service.js';
import type { EventSubscriberService } from '../../src/modules/event/event-subscriber.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const VALKEY_URL = process.env['NERV_VALKEY_URL'] ?? 'redis://localhost:6379';

let db: ScratchDb;
let pool: pg.Pool;
let valkey: ValkeyService;
let events: EventService;
let notifications: NotificationService;
let listener: Redis;
let projectId: string;
let plannerId: string;
let actorId: string;

const received: BroadcastEnvelope[] = [];

beforeAll(async () => {
  db = await createScratchDb('nerv_userroom');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const drizzleDb = drizzle(pool);

  valkey = new ValkeyService();
  Object.defineProperty(valkey, 'url', { value: VALKEY_URL });
  events = new EventService(drizzleDb, valkey);
  notifications = new NotificationService(drizzleDb, valkey);

  listener = new Redis(VALKEY_URL);
  await listener.subscribe(EVENTS_CHANNEL);
  listener.on('message', (_ch, payload) => {
    received.push(JSON.parse(payload) as BroadcastEnvelope);
  });

  await seed();
}, 120_000);

afterAll(async () => {
  await listener?.quit();
  await valkey?.onApplicationShutdown();
  await pool?.end();
  await db?.drop();
});

async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('알림 파생 → 개인 룸 방송', () => {
  it('`notification.created` 가 수신자를 지목해 나간다', async () => {
    const before = received.length;

    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.APPROVAL_REQUESTED,
        projectId,
        subjectType: 'approval',
        subjectId: newId(),
        actorUserId: actorId,
      }),
    );
    await waitFor(() => received.length > before);

    const created = await notifications.route();
    expect(created).toBeGreaterThan(0);
    await waitFor(() => received.some((e) => e.type === NERV_EVENT.NOTIFICATION_CREATED));

    const announced = received.filter((e) => e.type === NERV_EVENT.NOTIFICATION_CREATED);
    expect(announced).toHaveLength(1);
    const envelope = announced[0];
    // 수신자를 지목하지 않으면 개인 룸으로는 아무 데도 가지 않는다
    expect(envelope?.recipient_user_ids).toEqual([plannerId]);
    // 원인이 된 이벤트를 가리켜야 받는 쪽이 어느 화면을 다시 읽을지 안다
    expect(envelope?.subject_type).toBe('event');
    expect(envelope?.subject_key).toBe(NERV_EVENT.APPROVAL_REQUESTED);
    // 봉투의 시각은 ISO 8601 이다(§3.3)
    expect(envelope?.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }, 30_000);

  it('행위자 자신에게는 가지 않는다 — 자기가 한 일의 알림은 소음이다', async () => {
    // 위 케이스의 행위자는 actorId 이고, 수신자 목록에 그가 없었다
    const announced = received.filter((e) => e.type === NERV_EVENT.NOTIFICATION_CREATED);
    for (const envelope of announced) {
      expect(envelope.recipient_user_ids).not.toContain(actorId);
    }
  });
});

describe('팬아웃 — 지목된 개인 룸으로 흘린다', () => {
  /** 구독 소스 없이 dispatch 만 쓴다 — 여기서 보는 것은 라우팅 계산이다. */
  const fanoutOf = (): FanoutService =>
    new FanoutService({ onBroadcast: () => undefined } as unknown as EventSubscriberService);

  const envelope = (recipients?: string[]): BroadcastEnvelope =>
    ({
      id: newId(),
      type: NERV_EVENT.NOTIFICATION_CREATED,
      project_id: projectId,
      subject_type: 'event',
      subject_id: newId(),
      subject_key: null,
      actor_user_id: null,
      is_agent: false,
      occurred_at: new Date().toISOString(),
      ...(recipients === undefined ? {} : { recipient_user_ids: recipients }),
    }) as BroadcastEnvelope;

  it('프로젝트 룸에 없어도 지목되면 받는다', () => {
    const fanout = fanoutOf();
    const seen: string[] = [];
    fanout.add({ rooms: new Set([`user:${plannerId}` as const]), deliver: (e) => seen.push(e.id) });

    const sent = envelope([plannerId]);
    expect(fanout.dispatch(sent)).toBe(1);
    expect(seen).toEqual([sent.id]);
  });

  it('지목되지 않으면 개인 룸으로는 가지 않는다', () => {
    const fanout = fanoutOf();
    const seen: string[] = [];
    fanout.add({ rooms: new Set([`user:${plannerId}` as const]), deliver: (e) => seen.push(e.id) });

    expect(fanout.dispatch(envelope())).toBe(0);
    expect(seen).toEqual([]);
  });

  it('두 룸에 다 있어도 한 번만 받는다 — 같은 무효화를 두 번 돌리지 않는다', () => {
    const fanout = fanoutOf();
    const seen: string[] = [];
    fanout.add({
      rooms: new Set([`project:${projectId}` as const, `user:${plannerId}` as const]),
      deliver: (e) => seen.push(e.id),
    });

    const sent = envelope([plannerId]);
    expect(fanout.dispatch(sent)).toBe(1);
    expect(seen).toHaveLength(1);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  plannerId = newId();
  actorId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'planner@example.com','기획','active')`,
    [plannerId],
  );
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dev@example.com','개발','active')`,
    [actorId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
    [newId(), orgId, projectId, plannerId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, actorId],
  );
}
