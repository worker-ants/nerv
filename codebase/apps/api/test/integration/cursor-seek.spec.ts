// L2 — 커서가 정렬 키와 같은가 (api.md §1.6 · REQ-API-124)
//
// §1.6 은 "커서는 **(정렬 키, id)** 를 인코딩한 불투명 문자열" 이라 적는데 세 목록이 그렇지
// 않았다: 이벤트·알림은 시각 하나로만 seek 했고(같은 시각의 행이 쪽 경계에 걸리면 남은 것이
// 어느 쪽에도 나오지 않는다), 세션은 **커서 열과 정렬 열이 아예 달랐다**(`started_at` 으로
// seek 하고 `last_heartbeat_at` 으로 정렬 — 2쪽에서 세션이 겹치고 빠졌다).
//
// 이 스위트가 세는 것은 하나다: **쪽을 끝까지 넘겨 모은 집합이 전량과 같은가.** 같은 시각을
// 일부러 만들어(한 트랜잭션이 여러 건을 내는 실제 모양) 그 경계에 쪽을 걸치게 한다.
//
// 시각은 **두 모양으로** 만든다 — 정확히 같은 값(동률은 `id` 로 갈린다)과, 같은 ms 안에서
// µs 만 다른 값. 뒤엣것이 없으면 커서가 시각을 ms 로 잘라 싣는 결함이 **초록으로 지나간다**:
// 소수부가 없는 정각만 넣어 두면 잘라도 값이 그대로라 아무 검사도 그것을 세지 않는다.

import { NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ClaimService } from '../../src/modules/task/claim.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { encodeCursor } from '../../src/common/cursor.js';
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
  sessions = new SessionService(events, drizzleDb, new ClaimService());

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
    //
    // **두 모양을 한 번에 지난다**(2026-09-10 보강). 예전 이 배열은 다섯이 모두 정각
    // `00:00:00+00` 이라 동률(`id` 로 갈리는가)만 셌고, **µs 가 잘리는가는 세지 않았다** —
    // 소수부가 없으니 ms 로 잘라도 값이 그대로라 잘리는 결함이 이 검사를 그냥 통과했다.
    // 실제로 작업 목록이 겪은 결함(`new Date(...).toISOString()` 왕복 · main `6e4b48f`)을
    // 이 두 자리에 그대로 심어 보면 예전 배열에서는 여덟 검사가 전부 초록이었다.
    // 그래서 같은 ms 안에 두 무리를 함께 둔다 — 정확히 같은 값 한 쌍(동률)과, µs 만 다른 셋.
    const occurredAt = [
      '2026-09-07 00:00:00.123456+00',
      '2026-09-07 00:00:00.123456+00', // 앞 행과 정확히 같다 — 갈리는 것은 `id` 뿐이다
      '2026-09-07 00:00:00.123457+00',
      '2026-09-07 00:00:00.123458+00',
      '2026-09-07 00:00:00.123459+00',
    ];
    for (const at of occurredAt) {
      await pool.query(
        `INSERT INTO event (id, project_id, type, subject_type, subject_id, actor_user_id, is_agent, occurred_at)
         VALUES ($1,$2,$3,'spec',$4,$5,false,$6)`,
        [newId(), projectId, NERV_EVENT.SPEC_RECHECK_REQUESTED, newId(), userId, at],
      );
    }
    const { rows } = await pool.query<{ ms: number; us: number }>(
      `SELECT count(DISTINCT date_trunc('milliseconds', occurred_at))::int AS ms,
              count(DISTINCT occurred_at)::int AS us
         FROM event WHERE project_id = $1`,
      [projectId],
    );
    // 전제가 성립하지 않으면 이 검사는 아무것도 세지 않는다 — 밀리초는 하나, 값은 넷이다
    expect(rows[0]?.ms).toBe(1);
    expect(rows[0]?.us).toBe(4);

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
    // 시각을 못 박는다 — 파생 시각이 흩어지면 이 검사가 아무것도 세지 않는다.
    // 이벤트 피드와 같은 이유로 **같은 ms 안에 동률 한 쌍과 µs 만 다른 셋**을 함께 둔다:
    // 예전에는 다섯이 모두 정각이라 µs 가 잘려도 값이 그대로여서 이 검사가 통과했다.
    // 파생 알림은 `created_at` 기본값이 `now()`(트랜잭션 시각)라 실제로 이 모양이 된다.
    const createdAt = [
      '2026-09-07 00:00:00.123456+00',
      '2026-09-07 00:00:00.123456+00', // 앞 행과 정확히 같다 — 갈리는 것은 `id` 뿐이다
      '2026-09-07 00:00:00.123457+00',
      '2026-09-07 00:00:00.123458+00',
      '2026-09-07 00:00:00.123459+00',
    ];
    await pool.query(
      `INSERT INTO notification (id, project_id, user_id, event_id, importance, channel, state, created_at)
       SELECT gen_random_uuid(), $1, $2, e.id, 'immediate', 'inapp', 'unread', e.at
         FROM unnest($3::uuid[], $4::timestamptz[]) AS e(id, at)`,
      [projectId, userId, eventIds, createdAt],
    );
    const { rows: shape } = await pool.query<{ ms: number; us: number }>(
      `SELECT count(DISTINCT date_trunc('milliseconds', created_at))::int AS ms,
              count(DISTINCT created_at)::int AS us
         FROM notification WHERE user_id = $1`,
      [userId],
    );
    // 전제: 밀리초는 하나, 값은 넷이다 — 아니면 아래 drain 은 경계를 지나지 않는다
    expect(shape[0]?.ms).toBe(1);
    expect(shape[0]?.us).toBe(4);

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

describe('작업 목록 — 같은 밀리초 안에서 마이크로초까지 (EP-TSK-01)', () => {
  // TaskService 는 DI 그래프가 깊어(승인·질문·세션) 손으로 조립하지 않는다 — 앱에서 꺼낸다.
  // `list()` 가 만지는 것은 `this.db` 뿐이라 이 스위트의 성격(SQL 의 seek)은 그대로다.
  let app: NestFastifyApplication;
  let tasks: TaskService;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = db.url;
    process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
    app = await createApp();
    await app.init();
    tasks = app.get(TaskService);

    // **같은 밀리초, 다른 마이크로초.** `updated_at` 기본값은 `now()`(트랜잭션 시각)이라
    // 한 트랜잭션 안의 행은 값이 정확히 같지만, 임포터처럼 트랜잭션을 빠르게 이어 만들면
    // 같은 ms 안에서 µs 만 다른 행들이 생긴다 — 커서가 ms 로 잘라 싣던 시절 그 창에
    // 빠진 행은 **영영 나오지 않았다**(실측 2026-09-10: 전체 L2 7회 중 1회 재현).
    // 미표기(NULL) 무리까지 걸치게 해 경계도 함께 지난다.
    const rows: [string, string, string | null][] = [
      [newId(), '2026-09-07 00:00:00.123456+00', 'P0'],
      [newId(), '2026-09-07 00:00:00.123457+00', 'P0'],
      [newId(), '2026-09-07 00:00:00.123458+00', null],
      [newId(), '2026-09-07 00:00:00.123459+00', null],
      [newId(), '2026-09-07 00:00:00.123460+00', null],
    ];
    for (const [i, [id, updatedAt, priority]] of rows.entries()) {
      await pool.query(
        `INSERT INTO task (id, project_id, key, title, status, priority, updated_at)
         VALUES ($1,$2,$3,$4,'backlog',$5::task_priority,$6)`,
        [id, projectId, `CLV-T-C000${i}`, `µs ${updatedAt}`, priority, updatedAt],
      );
    }
    const { rows: check } = await pool.query<{ ms: number; us: number }>(
      `SELECT count(DISTINCT date_trunc('milliseconds', updated_at))::int AS ms,
              count(DISTINCT updated_at)::int AS us
         FROM task WHERE project_id = $1`,
      [projectId],
    );
    // 전제가 성립하지 않으면 이 검사는 아무것도 세지 않는다 — 밀리초는 하나, 값은 다섯이다
    expect(check[0]?.ms).toBe(1);
    expect(check[0]?.us).toBe(5);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('마이크로초만 다른 작업 다섯을 limit 1 로 넘기면 전량이 정확히 한 번씩 나온다', async () => {
    const seen = await drain((cursor) =>
      tasks.list({ projectId, limit: 1, cursor: cursor ?? undefined }),
    );
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  }, 30_000);

  it('망가진 커서는 처음부터 준다 — 22007·22P02 로 화면을 깨뜨리지 않는다', async () => {
    // 형식이 맞는 JSON 배열이라 `decodeCursor` 는 통과시킨다 — 걸러야 하는 쪽은 캐스팅 앞이다
    const broken = encodeCursor(['P0', '그런 시각은 없다', '그런 uuid 도 없다']);
    const res = await tasks.list({ projectId, limit: 1, cursor: broken });
    expect(res.items.length).toBeGreaterThan(0);

    // 어휘 밖 우선순위도 마찬가지다(`::task_priority` 는 22P02 로 죽는다)
    const badPriority = encodeCursor(['P9', '2026-09-07 00:00:00.123460+00', newId()]);
    const res2 = await tasks.list({ projectId, limit: 1, cursor: badPriority });
    expect(res2.items.length).toBeGreaterThan(0);
  }, 30_000);
});
