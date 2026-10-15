// fail-open 격상과 해제 · 정책 편집 (2026-10-15 · 사람 결정 · Phase 2 E18-S01 · E18-S02)
//
//   REQ-API-318  admin 은 EP-PRJ-04 로 `failopen` · `retention` 을 고친다 — 같은 zod 스키마로 검증하고, 감사가 바뀐 뒤의
//                값(게이트 정책이면 본문과 지문)을 남긴다. admin 이 아니면 403 이다
//   REQ-API-319  정책의 시간 창 안에 fail-open 이 기준 횟수 이상이면 격상 이벤트를 한 번 남기고 admin 에게 중요 알림을
//                보낸다. 그 창 동안 새 fail-open 이 없으면 워커 잡이 풀고 해제 이벤트를 남긴다
//   REQ-API-320  프로젝트 조회(EP-PRJ-03)가 `failopen_status` 를 준다 — 배너가 그 값을 그린다
//
// 실제 Postgres 로 본다 — 한 번만 격상하는 것(동시에 들어온 fail-open)은 advisory lock 과 READ COMMITTED 의 성질이다.

import { NERV_EVENT, NERV_EVENT_PHASE2, newId } from '@nerv/schema';
import { policyFingerprint } from '@nerv/schema/keys';
import { defaultGatePolicy, GatePolicySchema } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import type { SubmitResult } from '../../src/modules/review/review.service.js';
import { FailopenService } from '../../src/modules/task/failopen.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { FailopenJob } from '../../src/worker/jobs/failopen.job.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let orgId: string;
let admin: string;
let planner: string;
let agentSessionId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_failopen');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url, max: 20 });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM reviewer_report');
  await pool.query('UPDATE review_session SET previous_session_id = NULL');
  await pool.query('DELETE FROM review_session');
  await pool.query('DELETE FROM task');
  await pool.query('TRUNCATE event');
  await pool.query(`UPDATE project SET gate_policy = '{}'::jsonb, retention = '{}'::jsonb`);
});

async function setPolicy(policy: Record<string, unknown>): Promise<void> {
  await pool.query(`UPDATE project SET gate_policy = $1::jsonb WHERE id = $2`, [
    JSON.stringify(policy),
    projectId,
  ]);
}

let seq = 0;
/**
 * done 게이트의 fail-open 한 번 — 리뷰는 받았는데 작업에 `commit` 증적이 없어 신선도만 넘기고 닫는다(REQ-API-314).
 * 작업마다 변경 묶음이 달라야 라운드가 그 작업의 것으로 남는다
 */
async function prepareFailopenTask(): Promise<string> {
  seq += 1;
  const taskId = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,'작업','in_progress','목표','PR','도구','경계')`,
    [taskId, projectId, `CLV-T-FO${String(seq).padStart(4, '0')}`],
  );
  await pool.query(
    `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
     VALUES ($1,$2,$3,'pr',$4,'ci')`,
    [newId(), projectId, taskId, `https://git.example.com/pr/${seq}`],
  );
  await (app.get(ReviewService).submit({
    projectId,
    userId: admin,
    sessionId: agentSessionId,
    isAgent: true,
    branch: `feat/fo-${seq}`,
    baseSha: 'base0000',
    headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    kind: 'code',
    changeset: [`src/fo-${seq}.ts`],
    summaryMd: '봤다.',
    reviewer: { role: 'security', risk: 'medium' },
    taskId,
    findings: [],
  } as Parameters<ReviewService['submit']>[0]) as Promise<SubmitResult>);
  return taskId;
}

const close = (taskId: string): Promise<unknown> =>
  app.get(TaskService).transition({
    projectId,
    taskId,
    status: 'done',
    userId: admin,
    roles: ['admin'],
    specImpact: { none: true },
  });

async function failopenDone(): Promise<void> {
  expect(await close(await prepareFailopenTask())).toMatchObject({ status: 'done' });
}

/** fail-open 을 지난 시각으로 넣는다 — 이벤트는 append-only 라 고칠 수 없다 */
async function failopenAt(ago: string, gate = 'done_gate'): Promise<void> {
  await pool.query(`SELECT nerv_ensure_month_partitions((now() - $1::interval)::date)`, [ago]);
  await pool.query(
    `INSERT INTO event (id, project_id, occurred_at, type, is_agent, subject_type, subject_id, payload)
     VALUES ($1,$2, now() - $3::interval, $4, false, 'task', $5, $6::jsonb)`,
    [newId(), projectId, ago, NERV_EVENT.GATE_FAILOPEN, newId(), JSON.stringify({ gate })],
  );
}

async function escalatedAt(ago: string): Promise<void> {
  await pool.query(`SELECT nerv_ensure_month_partitions((now() - $1::interval)::date)`, [ago]);
  await pool.query(
    `INSERT INTO event (id, project_id, occurred_at, type, is_agent, subject_type, subject_id, payload)
     VALUES ($1,$2, now() - $3::interval, $4, false, 'project', $2, '{}'::jsonb)`,
    [newId(), projectId, ago, NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED],
  );
}

async function eventsOf(type: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM event WHERE project_id = $1 AND type = $2 ORDER BY occurred_at`,
    [projectId, type],
  );
  return rows.map((r) => r.payload);
}

const escalations = (): Promise<Record<string, unknown>[]> =>
  eventsOf(NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED);
const clears = (): Promise<Record<string, unknown>[]> =>
  eventsOf(NERV_EVENT_PHASE2.GATE_FAILOPEN_CLEARED);

async function statusOf(): Promise<Record<string, unknown>> {
  const project = await app.get(AuthService).project(projectId);
  return project['failopen_status'] as Record<string, unknown>;
}

/** 이 사람의 알림 — 이벤트 종류와 등급 */
async function inboxOf(userId: string): Promise<{ type: string; importance: string }[]> {
  const { rows } = await pool.query<{ type: string; importance: string }>(
    `SELECT e.type, n.importance::text AS importance
       FROM notification n JOIN event e ON e.id = n.event_id
      WHERE n.user_id = $1 ORDER BY n.created_at`,
    [userId],
  );
  return rows;
}

const reconcile = (): Promise<number> => new FailopenJob(app.get(FailopenService)).run();

describe('격상 — 창 안에서 기준 횟수에 닿으면 (REQ-API-319)', () => {
  it('done 게이트의 fail-open 이 기준에 닿으면 격상을 한 번 남기고, 더 쌓여도 다시 내지 않는다', async () => {
    await setPolicy({
      done_gate: { review_coverage: ['code'] },
      failopen: { escalate_count: 3, window_hours: 24 },
    });
    await failopenDone();
    await failopenDone();
    expect(await escalations()).toEqual([]);
    expect(await statusOf()).toMatchObject({ escalated: false, count: 2, escalate_count: 3 });

    await failopenDone();
    expect(await escalations()).toEqual([
      { count: 3, escalate_count: 3, window_hours: 24, gates: { done_gate: 3 } },
    ]);
    await failopenDone();
    expect(await escalations()).toHaveLength(1);

    const status = await statusOf();
    expect(status).toMatchObject({
      escalated: true,
      count: 4,
      escalate_count: 3,
      window_hours: 24,
    });
    expect(typeof status['escalated_at']).toBe('string');
    expect(typeof status['last_at']).toBe('string');
  });

  it('admin 만 중요 알림을 받는다 — planner 는 받지 않는다', async () => {
    await setPolicy({ failopen: { escalate_count: 2, window_hours: 24 } });
    await failopenAt('10 minutes');
    await failopenAt('5 minutes');
    await app.get(FailopenService).afterFailopen(projectId);
    expect(await escalations()).toHaveLength(1);

    await new NotificationService(drizzle(pool)).route();
    expect(await inboxOf(admin)).toEqual([
      { type: NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED, importance: 'immediate' },
    ]);
    expect(await inboxOf(planner)).toEqual([]);
  });

  it('동시에 들어온 fail-open 에서도 격상은 한 번이다 — 확인 여덟이 겹쳐도', async () => {
    await setPolicy({ failopen: { escalate_count: 3, window_hours: 24 } });
    for (const ago of ['3 minutes', '2 minutes', '1 minute']) await failopenAt(ago);
    const failopen = app.get(FailopenService);
    await Promise.all(Array.from({ length: 8 }, () => failopen.afterFailopen(projectId)));
    expect(await escalations()).toHaveLength(1);
  });

  it('done 이 동시에 닫히며 fail-open 을 남겨도 격상은 한 번이다', async () => {
    await setPolicy({
      done_gate: { review_coverage: ['code'] },
      failopen: { escalate_count: 2, window_hours: 24 },
    });
    const tasks = [];
    for (let i = 0; i < 4; i += 1) tasks.push(await prepareFailopenTask());
    const results = await Promise.all(tasks.map((id) => close(id)));
    for (const result of results) expect(result).toMatchObject({ status: 'done' });
    expect(await eventsOf(NERV_EVENT.GATE_FAILOPEN)).toHaveLength(4);
    expect(await escalations()).toHaveLength(1);
  });

  it('창 밖의 fail-open 은 세지 않는다', async () => {
    await setPolicy({ failopen: { escalate_count: 2, window_hours: 1 } });
    await failopenAt('3 hours');
    await failopenAt('2 hours');
    await failopenAt('10 minutes');
    await app.get(FailopenService).afterFailopen(projectId);
    expect(await escalations()).toEqual([]);
    expect(await statusOf()).toMatchObject({ escalated: false, count: 1 });
  });

  it('게이트마다의 수를 남긴다 — 플랜 승인 게이트와 done 게이트', async () => {
    await setPolicy({ failopen: { escalate_count: 3, window_hours: 24 } });
    await failopenAt('3 minutes', 'plan_approval');
    await failopenAt('2 minutes', 'done_gate');
    await failopenAt('1 minute', 'done_gate');
    await app.get(FailopenService).afterFailopen(projectId);
    expect((await escalations())[0]?.['gates']).toEqual({ plan_approval: 1, done_gate: 2 });
  });

  it('정책의 기준을 낮추면 잡이 격상한다 — fail-open 을 남긴 직후가 아니어도 규칙에 맞춘다', async () => {
    await setPolicy({ failopen: { escalate_count: 5, window_hours: 24 } });
    await failopenAt('3 minutes');
    await failopenAt('2 minutes');
    await app.get(FailopenService).afterFailopen(projectId);
    expect(await escalations()).toEqual([]);

    await setPolicy({ failopen: { escalate_count: 2, window_hours: 24 } });
    expect(await reconcile()).toBe(1);
    expect(await escalations()).toHaveLength(1);
    expect(await reconcile()).toBe(0);
  });

  it('정책이 스키마에 맞지 않으면 기본 기준(3회 · 24시간)으로 센다', async () => {
    await setPolicy({ failopen: { escalate_count: 0 } });
    for (const ago of ['3 minutes', '2 minutes', '1 minute']) await failopenAt(ago);
    await app.get(FailopenService).afterFailopen(projectId);
    const defaults = defaultGatePolicy().failopen;
    expect(await escalations()).toEqual([
      {
        count: 3,
        escalate_count: defaults.escalate_count,
        window_hours: defaults.window_hours,
        gates: { done_gate: 3 },
      },
    ]);
  });
});

describe('해제 — 창 동안 새 fail-open 이 없으면 (REQ-API-319)', () => {
  it('잡이 풀고 해제 이벤트를 한 번 남긴다 — 알림은 만들지 않는다', async () => {
    await setPolicy({ failopen: { escalate_count: 2, window_hours: 1 } });
    await failopenAt('3 hours');
    await failopenAt('2 hours 30 minutes');
    await escalatedAt('2 hours 30 minutes');
    expect(await statusOf()).toMatchObject({ escalated: true, count: 0 });

    expect(await reconcile()).toBe(1);
    const [cleared] = await clears();
    expect(cleared?.['window_hours']).toBe(1);
    expect(typeof cleared?.['escalated_at']).toBe('string');
    expect(await statusOf()).toMatchObject({ escalated: false, escalated_at: null });

    expect(await reconcile()).toBe(0);
    expect(await clears()).toHaveLength(1);

    await new NotificationService(drizzle(pool)).route();
    expect(await inboxOf(admin)).toEqual([]);
  });

  it('창 안에 fail-open 이 하나라도 있으면 풀지 않는다', async () => {
    await setPolicy({ failopen: { escalate_count: 2, window_hours: 1 } });
    await escalatedAt('2 hours');
    await failopenAt('30 minutes');
    expect(await reconcile()).toBe(0);
    expect(await clears()).toEqual([]);
    expect(await statusOf()).toMatchObject({ escalated: true, count: 1 });
  });

  it('풀린 뒤 다시 쌓이면 다시 격상한다', async () => {
    await setPolicy({ failopen: { escalate_count: 2, window_hours: 1 } });
    await escalatedAt('3 hours');
    await failopenAt('3 hours');
    expect(await reconcile()).toBe(1);
    expect(await clears()).toHaveLength(1);

    await failopenAt('2 minutes');
    await failopenAt('1 minute');
    await app.get(FailopenService).afterFailopen(projectId);
    expect(await escalations()).toHaveLength(2);
    expect(await statusOf()).toMatchObject({ escalated: true, count: 2 });
  });
});

describe('정책 편집 — failopen · retention (REQ-API-318)', () => {
  const update = (input: {
    roles: ('admin' | 'planner' | 'developer')[];
    gatePolicy?: Record<string, unknown>;
    retention?: Record<string, unknown>;
  }): Promise<unknown> =>
    app
      .get(AuthService)
      .updateProject({
        projectId,
        roles: input.roles,
        actor: { userId: input.roles.includes('admin') ? admin : planner, isAgent: false },
        ...(input.gatePolicy === undefined ? {} : { gatePolicy: input.gatePolicy }),
        ...(input.retention === undefined ? {} : { retention: input.retention }),
      })
      .catch((e: unknown) => e);

  async function lastUpdate(): Promise<Record<string, unknown>> {
    const [payload] = (await eventsOf(NERV_EVENT.PROJECT_UPDATED)).slice(-1);
    return payload ?? {};
  }

  it('admin 이 격상 기준을 고치면 저장하고, 감사에 정책 본문과 바꾸기 전 · 뒤의 지문이 남는다', async () => {
    const before = defaultGatePolicy();
    const result = (await update({
      roles: ['admin'],
      gatePolicy: { ...before, failopen: { escalate_count: 5, window_hours: 48 } },
    })) as Record<string, unknown>;
    expect((result['gate_policy'] as Record<string, unknown>)['failopen']).toEqual({
      escalate_count: 5,
      window_hours: 48,
    });
    expect(result['failopen_status']).toMatchObject({ escalate_count: 5, window_hours: 48 });

    const audit = await lastUpdate();
    const after = GatePolicySchema.parse({
      ...before,
      failopen: { escalate_count: 5, window_hours: 48 },
    });
    expect(audit['fields']).toEqual(['gate_policy']);
    expect(audit['gate_policy']).toEqual(after);
    expect(audit['policy_fingerprint']).toBe(policyFingerprint(after));
    expect(audit['policy_fingerprint_before']).toBe(policyFingerprint(before));
  });

  it('admin 이 보존 기간을 고치면 저장하고, 감사에 바뀐 값이 남는다', async () => {
    const result = (await update({
      roles: ['admin'],
      retention: { activity_days: 30, prompt_blob_ttl_days: 14 },
    })) as Record<string, unknown>;
    expect(result['retention']).toEqual({ activity_days: 30, prompt_blob_ttl_days: 14 });
    const audit = await lastUpdate();
    expect(audit['fields']).toEqual(['retention']);
    expect(audit['retention']).toEqual({ activity_days: 30, prompt_blob_ttl_days: 14 });
    // 게이트 정책을 고치지 않았으면 정책 본문 · 지문을 남기지 않는다
    expect(audit).not.toHaveProperty('policy_fingerprint');
  });

  it('admin 이 아니면 고칠 수 없다 — 격상 기준도 보존 기간도 403 이다', async () => {
    for (const input of [
      { roles: ['planner' as const], gatePolicy: { failopen: { escalate_count: 9 } } },
      { roles: ['developer' as const], retention: { activity_days: 1 } },
    ]) {
      const error = await update(input);
      expect(error).toMatchObject({ details: { kind: 'role_required', required: ['admin'] } });
    }
    const { rows } = await pool.query<{ gate_policy: unknown; retention: unknown }>(
      `SELECT gate_policy, retention FROM project WHERE id = $1`,
      [projectId],
    );
    expect(rows[0]).toEqual({ gate_policy: {}, retention: {} });
    expect(await eventsOf(NERV_EVENT.PROJECT_UPDATED)).toEqual([]);
  });

  it('범위 밖 값은 저장하지 않고 어느 자리인지 말한다 — 같은 스키마다', async () => {
    for (const input of [
      { roles: ['admin' as const], gatePolicy: { failopen: { escalate_count: 0 } } },
      { roles: ['admin' as const], gatePolicy: { failopen: { window_hours: 1.5 } } },
      { roles: ['admin' as const], retention: { activity_days: -1 } },
      { roles: ['admin' as const], retention: { activity_days: 7, unknown_key: 1 } },
    ]) {
      const error = await update(input);
      expect(error).toMatchObject({ details: { kind: 'invalid_policy' } });
    }
    const { rows } = await pool.query<{ gate_policy: unknown; retention: unknown }>(
      `SELECT gate_policy, retention FROM project WHERE id = $1`,
      [projectId],
    );
    expect(rows[0]).toEqual({ gate_policy: {}, retention: {} });
  });
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  admin = newId();
  planner = newId();
  agentSessionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [admin, 'admin@example.com', '관리자'],
    [planner, 'planner@example.com', '기획자'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const [id, role] of [
    [admin, 'admin'],
    [planner, 'planner'],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
      [newId(), orgId, projectId, id, role],
    );
  }
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-02','active')`,
    [agentSessionId, projectId, admin],
  );
}
