// 보존 잡 완성의 첫 조각 — 알림 180일 · 빈 activity 월 파티션 드랍 (2026-10-16 · 사람 결정 ② · Phase 2 E18-S03)
//
// database.md REQ-DB-046 · 047. 알림은 이벤트에서 다시 만들 수 있는 파생 데이터라 180일 뒤에 지우고, 보존 기간을 넘겨
// 행이 모두 지워진 activity 월 파티션은 드랍한다. 리뷰 본문 요약 압축 · draft 압축 · event DETACH 는 재검토 트리거를
// 기다린다(database.md §2.14) — 여기서 다루지 않는다.

import { NERV_EVENT_PHASE2, NOTIFICATION_RETENTION_DAYS, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { RetentionJob } from '../../src/worker/jobs/retention.job.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let retention: RetentionJob;
let orgId: string;
let projectId: string;
let adminId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_retention_cleanup');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  retention = new RetentionJob(drizzle(pool));
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  await pool.query('DELETE FROM activity');
  await pool.query(`UPDATE project SET retention = '{}'::jsonb`);
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  adminId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'admin@example.com','관리자','active')`,
    [adminId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
    [newId(), orgId, projectId, adminId],
  );
}

/** 지난 시각의 이벤트 — 그 달의 파티션이 있어야 넣을 수 있다. 격상은 그 프로젝트의 admin 에게 가는 알림이다 */
async function eventAt(ago: string): Promise<string> {
  const id = newId();
  await pool.query(`SELECT nerv_ensure_month_partitions((now() - $1::interval)::date)`, [ago]);
  await pool.query(
    `INSERT INTO event (id, project_id, occurred_at, type, is_agent, subject_type, subject_id, payload)
     VALUES ($1,$2, now() - $3::interval, $4, false, 'project', $2, '{}'::jsonb)`,
    [id, projectId, ago, NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED],
  );
  return id;
}

/** 그 시각에 파생된 것처럼 알림 줄을 넣는다(묶지 않은 한 줄) */
async function notificationAt(
  eventId: string,
  ago: string,
  state: 'read' | 'unread' = 'unread',
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO notification (id, project_id, user_id, event_id, importance, state, read_at, created_at, last_at)
     VALUES ($1,$2,$3,$4,'immediate',$5::notification_state,
             CASE WHEN $5 = 'read' THEN now() - $6::interval END, now() - $6::interval, now() - $6::interval)`,
    [id, projectId, adminId, eventId, state, ago],
  );
  return id;
}

async function notificationIds(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM notification ORDER BY id`);
  return rows.map((r) => r.id);
}

async function partitions(parent: 'activity' | 'event'): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = $1::regclass ORDER BY c.relname`,
    [parent],
  );
  return rows.map((r) => r.name);
}

/** `nerv_ensure_month_partitions` 와 같은 이름 규칙 — 그 시각이 든 달의 파티션 */
async function partitionOf(
  ago: string,
  parent: 'activity' | 'event' = 'activity',
): Promise<string> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT $2 || '_' || to_char(date_trunc('month', now() - $1::interval), '"y"YYYY"m"MM') AS name`,
    [ago, parent],
  );
  return rows[0]?.name ?? '';
}

describe('알림 180일 (REQ-DB-046)', () => {
  it('상수는 데이터 모델의 보존 표 값이다', () => {
    expect(NOTIFICATION_RETENTION_DAYS).toBe(180);
  });

  it('181일 된 알림은 지우고 179일 된 알림은 남긴다 — 읽음 · 안 읽음을 가리지 않는다', async () => {
    const oldRead = await notificationAt(newId(), '181 days', 'read');
    const oldUnread = await notificationAt(newId(), '181 days', 'unread');
    const young = await notificationAt(newId(), '179 days', 'unread');

    const report = await retention.run();

    expect(report.notifications_deleted).toBe(2);
    expect(await notificationIds()).toEqual([young]);
    expect(await notificationIds()).not.toContain(oldRead);
    expect(await notificationIds()).not.toContain(oldUnread);
  });

  it('묶음은 마지막으로 더해진 시각으로 본다 — 처음 이벤트가 오래됐어도 어제 더해졌으면 남는다', async () => {
    const live = newId();
    const stale = newId();
    for (const [id, last] of [
      [live, '1 day'],
      [stale, '181 days'],
    ] as const) {
      await pool.query(
        `INSERT INTO notification (id, project_id, user_id, event_id, importance, state, created_at, last_at,
                                   batch_key, batch_size, batch_open)
         VALUES ($1,$2,$3,$4,'digest','unread', now() - interval '200 days', now() - $5::interval,
                 $6, 2, true)`,
        [id, projectId, adminId, newId(), last, `key:${id}`],
      );
      // 묶음에 든 이벤트 둘 — 지운 줄을 가리키는 행이 남으면 안 된다(FK ON DELETE CASCADE)
      for (let i = 0; i < 2; i += 1) {
        await pool.query(
          `INSERT INTO notification_batch_event (notification_id, event_id, user_id) VALUES ($1,$2,$3)`,
          [id, newId(), adminId],
        );
      }
    }

    const report = await retention.run();

    expect(report.notifications_deleted).toBe(1);
    expect(await notificationIds()).toEqual([live]);
    const { rows } = await pool.query<{ notification_id: string; n: number }>(
      `SELECT notification_id, count(*)::int AS n FROM notification_batch_event GROUP BY notification_id`,
    );
    expect(rows).toEqual([{ notification_id: live, n: 2 }]);
  });

  /**
   * **지운 알림은 다시 파생되지 않는다**(REQ-DB-029 · REQ-API-317). 파생은 "알림이 없는 이벤트" 를 찾으므로 알림을 지우면
   * 그 이벤트는 다시 후보가 된다. 막는 것은 시각이다 — 도는 워커의 커서는 앞으로만 가고, 새로 뜬 워커는 최근 한 시간만
   * 본다. 180일 전의 이벤트는 어느 쪽에도 들지 않는다. 마지막 단언이 그 근거다: 창을 명시로 넓히면 같은 이벤트가 다시 된다
   */
  it('지운 알림의 이벤트는 다음 route() 에서 다시 알림이 되지 않는다 — 도는 워커도 새로 뜬 워커도', async () => {
    const oldEvent = await eventAt('181 days');
    await notificationAt(oldEvent, '181 days');
    const recentEvent = await eventAt('10 minutes');

    // 도는 워커 — 지난 판이 최근 이벤트까지 봤다
    const running = new NotificationService(drizzle(pool));
    expect(await running.route()).toBe(1);

    const report = await retention.run();
    expect(report.notifications_deleted).toBe(1);

    const derivedFor = async (eventId: string): Promise<number> => {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification WHERE event_id = $1`,
        [eventId],
      );
      return rows[0]?.n ?? -1;
    };

    expect(await running.route()).toBe(0);
    // 새로 뜬 워커(커서 없음) — 최근 한 시간만 다시 본다
    const restarted = new NotificationService(drizzle(pool));
    expect(await restarted.route()).toBe(0);
    expect(await derivedFor(oldEvent)).toBe(0);
    expect(await derivedFor(recentEvent)).toBe(1);

    // 근거: 막은 것은 시각 창이다. 명시 `since` 로 창을 넓히면(워커는 그렇게 부르지 않는다) 같은 이벤트가 다시 알림이 된다
    expect(await restarted.route({ since: new Date(Date.now() - 200 * 86_400_000) })).toBe(1);
    expect(await derivedFor(oldEvent)).toBe(1);
  });
});

describe('빈 activity 월 파티션 드랍 (REQ-DB-047)', () => {
  it('보존 기간을 넘긴 빈 파티션은 드랍하고 현재 · 미래 달과 event 파티션은 남긴다', async () => {
    await pool.query(`SELECT nerv_ensure_month_partitions((now() - interval '200 days')::date)`);
    await pool.query(`SELECT nerv_ensure_month_partitions(current_date)`);
    await pool.query(
      `SELECT nerv_ensure_month_partitions((current_date + interval '2 months')::date)`,
    );
    const old = await partitionOf('200 days');
    const current = await partitionOf('0 days');
    const future = await partitionOf('-2 months');
    expect(await partitions('activity')).toEqual(expect.arrayContaining([old, current, future]));

    const report = await retention.run();

    expect(report.activity_partitions_dropped).toBeGreaterThanOrEqual(1);
    const left = await partitions('activity');
    expect(left).not.toContain(old);
    expect(left).toEqual(expect.arrayContaining([current, future]));
    // event 는 영구다 — 12개월 뒤 DETACH 는 재검토 트리거를 기다린다(§2.14)
    expect(await partitions('event')).toContain(await partitionOf('200 days', 'event'));
    // 드랍한 달도 함수가 다시 만들 수 있다 — 이름 규칙이 같다
    await pool.query(`SELECT nerv_ensure_month_partitions((now() - interval '200 days')::date)`);
    expect(await partitions('activity')).toContain(old);
  });

  it('행이 남은 파티션은 드랍하지 않는다 — 보관한 프로젝트의 활동은 보존 잡이 지우지 않는다', async () => {
    const archived = newId();
    const session = newId();
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name, archived_at)
       VALUES ($1,$2,'old-proj','OLD','old', now())`,
      [archived, orgId],
    );
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,'claude-code','mac-01','complete')`,
      [session, archived, adminId],
    );
    await pool.query(`SELECT nerv_ensure_month_partitions((now() - interval '300 days')::date)`);
    await pool.query(
      `INSERT INTO activity (id, session_id, project_id, seq, type, title, created_at)
       VALUES ($1,$2,$3,1,'action','보관한 프로젝트의 활동', now() - interval '300 days')`,
      [newId(), session, archived],
    );
    const kept = await partitionOf('300 days');

    try {
      await retention.run();
      expect(await partitions('activity')).toContain(kept);

      // 행이 사라지면 다음 판이 드랍한다
      await pool.query(`DELETE FROM activity WHERE project_id = $1`, [archived]);
      const report = await retention.run();
      expect(report.activity_partitions_dropped).toBeGreaterThanOrEqual(1);
      expect(await partitions('activity')).not.toContain(kept);
    } finally {
      await pool.query(`DELETE FROM activity WHERE project_id = $1`, [archived]);
      await pool.query(`DELETE FROM agent_session WHERE project_id = $1`, [archived]);
      await pool.query(`DELETE FROM project WHERE id = $1`, [archived]);
    }
  });

  it('모든 프로젝트의 activity_days 가운데 가장 긴 값으로 본다 — 한 프로젝트에게라도 보존 기간 안인 달은 남긴다', async () => {
    await pool.query(`SELECT nerv_ensure_month_partitions((now() - interval '200 days')::date)`);
    const old = await partitionOf('200 days');
    await pool.query(
      `UPDATE project SET retention = '{"activity_days": 400}'::jsonb WHERE id = $1`,
      [projectId],
    );

    await retention.run();
    expect(await partitions('activity')).toContain(old);

    await pool.query(`UPDATE project SET retention = '{}'::jsonb WHERE id = $1`, [projectId]);
    await retention.run();
    expect(await partitions('activity')).not.toContain(old);
  });

  it('잠금을 곧바로 얻지 못하면 기다리지 않고 다음 판으로 미룬다 — 활동 쓰기를 줄 세우지 않는다', async () => {
    await pool.query(`SELECT nerv_ensure_month_partitions((now() - interval '200 days')::date)`);
    const old = await partitionOf('200 days');

    // 다른 트랜잭션이 activity 를 읽는 중이다(백업 · 긴 조회)
    const reader = await pool.connect();
    try {
      await reader.query('BEGIN');
      await reader.query('SELECT count(*) FROM activity');

      const started = Date.now();
      const report = await retention.run();
      expect(report.activity_partitions_dropped).toBe(0);
      expect(await partitions('activity')).toContain(old);
      // 기다리지 않았다 — 잠금 대기였다면 이 트랜잭션이 끝날 때까지 돌아오지 않는다
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await reader.query('COMMIT');
      reader.release();
    }

    const report = await retention.run();
    expect(report.activity_partitions_dropped).toBeGreaterThanOrEqual(1);
    expect(await partitions('activity')).not.toContain(old);
  });
});
