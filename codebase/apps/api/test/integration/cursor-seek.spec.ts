// L2 — 커서가 정렬 키와 같은가 (api.md §1.6 · REQ-API-124)
//
// §1.6 은 "커서는 **(정렬 키, id)** 를 인코딩한 불투명 문자열" 이라 적는데 세 목록이 그렇지
// 않았다: 이벤트·알림은 시각 하나로만 seek 했고(같은 시각의 행이 쪽 경계에 걸리면 남은 것이
// 어느 쪽에도 나오지 않는다), 세션은 **커서 열과 정렬 열이 아예 달랐다**(`started_at` 으로
// seek 하고 `last_heartbeat_at` 으로 정렬 — 2쪽에서 세션이 겹치고 빠졌다).
//
// 이 스위트가 세는 것은 하나다: **쪽을 끝까지 넘겨 모은 집합이 전량과 같은가.** 같은 시각을
// 일부러 만들어(한 트랜잭션이 여러 건을 내는 실제 모양) 그 경계에 쪽을 걸치게 한다.

import { NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let valkey: ValkeyService;
let events: EventService;
let notifications: NotificationService;
let sessions: SessionService;
let projectId: string;
let userId: string;

/** Valkey 없이 돈다 — 이 스위트가 보는 것은 SQL 의 seek 이다 */
class SilentValkey extends ValkeyService {
  override async publish(): Promise<boolean> {
    return true;
  }
}

beforeAll(async () => {
  db = await createScratchDb('nerv_cursor');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const drizzleDb = drizzle(pool);
  valkey = new SilentValkey();
  events = new EventService(drizzleDb, valkey);
  notifications = new NotificationService(drizzleDb, valkey);
  sessions = new SessionService(events, drizzleDb);

  const orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme','ACME')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'a@example.com','아무개','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
    [newId(), orgId, projectId, userId],
  );
}, 120_000);

afterAll(async () => {
  await valkey?.onApplicationShutdown();
  await pool?.end();
  await db?.drop();
});

/** 쪽을 끝까지 넘겨 id 를 모은다 — 페이지네이션이 답해야 하는 유일한 질문이다 */
async function drain(
  page: (
    cursor: string | null,
  ) => Promise<{ items: { id?: unknown }[]; next_cursor: string | null }>,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const res = await page(cursor);
    seen.push(...res.items.map((r) => String(r.id)));
    if (res.next_cursor === null) return seen;
    cursor = res.next_cursor;
  }
  throw new Error('쪽이 끝나지 않는다 — 커서가 전진하지 않는 것이다');
}

describe('이벤트 피드 — 같은 시각이 쪽 경계에 걸려도 (EP-EVT-01)', () => {
  it('한 트랜잭션이 낸 이벤트 다섯을 limit 2 로 끝까지 넘기면 전량이 정확히 한 번씩 나온다', async () => {
    // 실측에서 이 모양이 이벤트의 25% 였다 — 한 트랜잭션이 여러 건을 내면 같은 ms 에 몰린다.
    // 그 조건을 직접 만든다: `occurred_at` 은 emit 마다 `new Date()` 이고, event 는
    // append-only 라(REQ-DB-023) 나중에 고칠 수도 없다 — 처음부터 같은 값으로 넣는다.
    for (let i = 0; i < 5; i += 1) {
      await pool.query(
        `INSERT INTO event (id, project_id, type, subject_type, subject_id, actor_user_id, is_agent, occurred_at)
         VALUES ($1,$2,$3,'spec',$4,$5,false,'2026-09-07 00:00:00+00')`,
        [newId(), projectId, NERV_EVENT.SPEC_RECHECK_REQUESTED, newId(), userId],
      );
    }
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(DISTINCT occurred_at)::int AS n FROM event WHERE project_id = $1`,
      [projectId],
    );
    expect(rows[0]?.n).toBe(1); // 전제: 다섯이 같은 시각이다

    const seen = await drain((cursor) => events.feed({ projectId, limit: 2, before: cursor }));
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  }, 30_000);

  it('커서는 불투명하다 — 시각 그대로가 아니다(§1.6)', async () => {
    const first = await events.feed({ projectId, limit: 2 });
    expect(first.next_cursor).not.toBeNull();
    expect(Number.isNaN(Date.parse(String(first.next_cursor)))).toBe(true);
  });

  it('옛 형식(맨 타임스탬프)도 한 릴리스 동안 받는다 — 500 이 아니다', async () => {
    const res = await events.feed({ projectId, limit: 2, before: '2999-01-01 00:00:00+00' });
    expect(res.items.length).toBeGreaterThan(0);
  });

  it('망가진 커서는 처음부터 준다 — 화면을 통째로 깨뜨리지 않는다', async () => {
    const res = await events.feed({ projectId, limit: 2, before: '%%%' });
    expect(res.items.length).toBeGreaterThan(0);
  });
});

describe('알림 목록 — 한 이벤트가 여러 수신자에게 파생될 때 (EP-NTF-01)', () => {
  it('같은 created_at 을 가진 알림도 쪽을 넘기며 전량이 한 번씩 나온다', async () => {
    const eventIds: string[] = [];
    await events.transact(async (_tx, emit) => {
      for (let i = 0; i < 5; i += 1) {
        eventIds.push(
          (
            await emit({
              type: NERV_EVENT.APPROVAL_REQUESTED,
              projectId,
              subjectType: 'approval',
              subjectId: newId(),
              actorUserId: userId,
            })
          ).id,
        );
      }
    });
    // 같은 시각으로 못 박는다 — 파생 시각이 흩어지면 이 검사가 아무것도 세지 않는다
    await pool.query(
      `INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state, created_at)
       SELECT gen_random_uuid(), $1, $2, e.id, 'immediate', 'inapp', 'unread', '2026-09-07 00:00:00+00'
         FROM unnest($3::uuid[]) AS e(id)`,
      [projectId, userId, eventIds],
    );
    const seen = await drain((cursor) => notifications.list({ userId, limit: 2, before: cursor }));
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  }, 30_000);
});

describe('세션 보드 — 커서 열과 정렬 열이 같은가 (EP-SES-01)', () => {
  it('하트비트가 뒤섞인 세션 일곱을 limit 2 로 넘기면 겹치지도 빠지지도 않는다', async () => {
    // 나중에 시작했지만 하트비트가 오래된 세션(유령 세션의 전형)을 일부러 만든다 —
    // 예전 커서(`started_at`)로는 그 세션이 2쪽에서 통째로 빠졌다.
    const rows: [string, string, string | null][] = [
      [newId(), '2026-09-01 10:00:00+00', '2026-09-05 10:00:00+00'],
      [newId(), '2026-09-02 10:00:00+00', '2026-09-05 09:00:00+00'],
      [newId(), '2026-09-03 10:00:00+00', '2026-09-05 11:00:00+00'],
      [newId(), '2026-09-04 10:00:00+00', null],
      [newId(), '2026-09-05 10:00:00+00', '2026-09-05 09:00:00+00'],
      [newId(), '2026-09-06 10:00:00+00', null],
      [newId(), '2026-09-07 10:00:00+00', '2026-09-05 09:00:00+00'],
    ];
    for (const [id, startedAt, heartbeat] of rows) {
      await pool.query(
        `INSERT INTO agent_session
           (id, project_id, user_id, hostname, agent_type, state, started_at, last_heartbeat_at)
         VALUES ($1,$2,$3,'host-1','claude-code','active',$4,$5)`,
        [id, projectId, userId, startedAt, heartbeat],
      );
    }
    const seen = await drain((cursor) =>
      sessions.board({ projectId, limit: 2, cursor: cursor ?? undefined }),
    );
    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen).size).toBe(rows.length);
  }, 30_000);
});
