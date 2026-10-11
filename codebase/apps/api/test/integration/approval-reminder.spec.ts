// 결재 리마인더 — 요청 뒤 4시간 · 1일에 한 번씩 (2026-10-11 · api.md REQ-API-296 · spec-workflow §2.6)
//
// SLA 표가 T+4h · T+1d 리마인더를 약속했는데 그것을 내는 코드가 없었다 — 사람은 결재가 묵어도 다시 듣지 못했다.
// 이 스위트가 보는 것은 넷이다. ① 단계마다 한 번만 낸다(다시 돌려도 · 워커가 늦게 봐도). ② 그 결재 요청을 받는
// 사람에게 결재마다 한 줄로 묶어 간다(요청자는 빠진다). ③ 1회째는 메일 요약에서 빠지고 2회째는 든다. ④ 결정하면
// 리마인더도 읽음이 된다 — 끝난 결재를 다시 찾으러 가지 않게.

import { NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NervDb } from '../../src/common/database.module.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { closeRequestNotifications } from '../../src/modules/event/request-notifications.js';
import type { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let orm: NervDb;
let approvals: ApprovalService;
let notifications: NotificationService;
let orgId: string;
let projectId: string;
let archivedProjectId: string;
/** 결재를 요청한 사람(planner) — 리마인더를 받지 않는다 */
let requester: string;
/** 역할 큐의 두 사람 — planner · admin */
let planner: string;
let admin: string;
/** 역할 큐 밖 — designer 는 지정되지 않으면 받지 않는다 */
let designer: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_reminder');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  orm = drizzle(pool) as unknown as NervDb;
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  // 리마인더는 이벤트와 DB 만 쓴다 — 스펙 · 인증 서비스는 부르지 않는다
  approvals = new ApprovalService(new EventService(orm, silent), null as never, null as never, orm);
  notifications = new NotificationService(orm);

  orgId = newId();
  projectId = newId();
  archivedProjectId = newId();
  requester = newId();
  planner = newId();
  admin = newId();
  designer = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme','에이크미')`, [
    orgId,
  ]);
  for (const [id, slug, archived] of [
    [projectId, 'webchat', false],
    [archivedProjectId, 'old', true],
  ] as const) {
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name, archived_at)
       VALUES ($1,$2,$3,upper($3),$3, ${archived ? 'now()' : 'NULL'})`,
      [id, orgId, slug],
    );
  }
  for (const [id, name, role] of [
    [requester, '요청자', 'planner'],
    [planner, '지민', 'planner'],
    [admin, '민서', 'admin'],
    [designer, '서연', 'designer'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, `${id.slice(-8)}@mail.test`, name],
    );
    for (const p of [projectId, archivedProjectId]) {
      await pool.query(
        `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
        [newId(), orgId, p, id, role],
      );
    }
  }
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM approval');
  await pool.query('TRUNCATE event');
});

/** 계획 승인 결재 하나 — `hoursAgo` 시간 전에 요청됐다 */
async function pendingApproval(
  hoursAgo: number,
  over: { project?: string; assignee?: string; decided?: boolean } = {},
): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                           assignee_user_id, requested_at, decision, decided_by_user_id, decided_at)
     VALUES ($1,$2,'plan',$3,$4,$5, now() - make_interval(hours => $6),
             ${over.decided === true ? `'approve', $7, now()` : 'NULL, NULL, NULL'})`,
    [
      id,
      over.project ?? projectId,
      newId(),
      requester,
      over.assignee ?? null,
      hoursAgo,
      ...(over.decided === true ? [admin] : []),
    ],
  );
  return id;
}

async function reminderLevels(approvalId: string): Promise<number[]> {
  const { rows } = await pool.query<{ level: number }>(
    `SELECT (payload->>'level')::int AS level FROM event
      WHERE type = $1 AND subject_id = $2 ORDER BY occurred_at`,
    [NERV_EVENT.APPROVAL_REMINDED, approvalId],
  );
  return rows.map((r) => r.level);
}

async function reminderRows(approvalId: string): Promise<
  {
    user_id: string;
    importance: string;
    state: string;
    batch_size: number;
    delivered: boolean;
    mail_due: boolean;
  }[]
> {
  const { rows } = await pool.query(
    `SELECT user_id, importance::text AS importance, state::text AS state, batch_size,
            delivered_at IS NOT NULL AS delivered,
            (delivered_at IS NULL OR last_at > delivered_at) AS mail_due
       FROM notification WHERE batch_key = $1 ORDER BY user_id`,
    [`approval:${approvalId}:reminder`],
  );
  return rows;
}

describe('결재 리마인더 — 단계마다 한 번 (REQ-API-296)', () => {
  it('4시간이 지나면 1회째를 한 번 낸다 — 다시 돌려도 더 내지 않고, 4시간 전이면 내지 않는다', async () => {
    const due = await pendingApproval(5);
    const fresh = await pendingApproval(3);
    expect(await approvals.remindDue()).toEqual({ reminded: 1 });
    expect(await approvals.remindDue()).toEqual({ reminded: 0 });
    expect(await reminderLevels(due)).toEqual([1]);
    expect(await reminderLevels(fresh)).toEqual([]);
  });

  it('1일이 지나면 2회째를 낸다 — 워커가 늦게 보면 지난 1회째를 뒤늦게 내지 않는다', async () => {
    const first = await pendingApproval(5);
    await approvals.remindDue();
    await pool.query(
      `UPDATE approval SET requested_at = now() - interval '25 hours' WHERE id = $1`,
      [first],
    );
    const late = await pendingApproval(30);
    expect(await approvals.remindDue()).toEqual({ reminded: 2 });
    expect(await reminderLevels(first)).toEqual([1, 2]);
    expect(await reminderLevels(late)).toEqual([2]);
    expect(await approvals.remindDue()).toEqual({ reminded: 0 });
  });

  it('결정된 결재 · 7일이 지난 결재 · 보관한 프로젝트의 결재는 다시 알리지 않는다', async () => {
    await pendingApproval(30, { decided: true });
    await pendingApproval(8 * 24);
    await pendingApproval(30, { project: archivedProjectId });
    expect(await approvals.remindDue()).toEqual({ reminded: 0 });
  });
});

describe('결재 리마인더 알림 — 받는 사람과 묶음 (REQ-API-296)', () => {
  it('그 결재 요청을 받는 사람에게 결재마다 한 줄로 간다 — 요청자와 큐 밖은 빠진다', async () => {
    const id = await pendingApproval(5);
    await approvals.remindDue();
    await notifications.route();
    const rows = await reminderRows(id);
    expect(rows.map((r) => r.user_id).sort()).toEqual([planner, admin].sort());
    // 결재 요청 자체가 중요 알림이다 — 리마인더까지 중요로 세면 같은 결재가 배지를 두 번 올린다
    for (const row of rows) expect(row).toMatchObject({ importance: 'digest', state: 'unread' });
  });

  it('1회째는 메일 요약에서 빠지고, 2회째가 같은 줄에 더해지면 요약에 든다', async () => {
    const id = await pendingApproval(5);
    await approvals.remindDue();
    await notifications.route();
    for (const row of await reminderRows(id)) {
      expect(row).toMatchObject({ batch_size: 1, delivered: true, mail_due: false });
    }
    await pool.query(
      `UPDATE approval SET requested_at = now() - interval '25 hours' WHERE id = $1`,
      [id],
    );
    await approvals.remindDue();
    await notifications.route();
    const rows = await reminderRows(id);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ batch_size: 2, mail_due: true });
  });

  it('지정 승인자가 있으면 그 사람에게만 간다 — 큐 밖 역할이어도 받는다', async () => {
    const id = await pendingApproval(5, { assignee: designer });
    await approvals.remindDue();
    await notifications.route();
    expect((await reminderRows(id)).map((r) => r.user_id)).toEqual([designer]);
  });

  it('결정하면 리마인더도 읽음이 되고, 결정 뒤에 파생되면 읽은 채로 들어온다', async () => {
    const open = await pendingApproval(5);
    await approvals.remindDue();
    await notifications.route();
    await closeRequestNotifications(orm, 'approval', open);
    for (const row of await reminderRows(open)) expect(row.state).toBe('read');

    // 파생보다 결정이 먼저인 틈 — 파생이 닫힌 요청을 알아본다
    const late = await pendingApproval(5);
    await approvals.remindDue();
    await pool.query(
      `UPDATE approval SET decision = 'approve', decided_by_user_id = $2, decided_at = now()
        WHERE id = $1`,
      [late, admin],
    );
    await notifications.route();
    const rows = await reminderRows(late);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.state).toBe('read');
  });
});
