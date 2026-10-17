// E17-S03 — Slack 채널 발신 (2026-10-17 · 사람 결정 D1 · D2 · api.md REQ-API-354 ~ 356 · database.md REQ-DB-054)
//
// 가짜 Slack 서버를 세우고 실제 HTTP 로 보낸다. 웹훅 접두(`NERV_SLACK_WEBHOOK_PREFIX`)를 그 서버로 돌린다 — 운영의 접두는
// `https://hooks.slack.com/services/` 이고, 서버가 사람이 넣은 아무 주소로나 요청을 보내지 않게 하는 문이다(SSRF).

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import type { NervDb } from '../../src/common/database.module.js';
import { DEFAULT_ORIGIN } from '../../src/common/origins.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { SlackSender } from '../../src/modules/slack/slack.sender.js';
import { SlackService } from '../../src/modules/slack/slack.service.js';
import { SlackJob } from '../../src/worker/jobs/slack.job.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const KEY = randomBytes(32).toString('base64');

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let job: SlackJob;
let cookie: string;
let agentToken: string;
let projectId: string;
let adminId: string;
let plannerId: string;
let requesterId: string;
let fake: Server;
let hooks: string;
/** 가짜 Slack 이 받은 게시 */
const posts: Array<{ path: string; text: string }> = [];
/** 경로마다 다음 응답 — 비면 200 ok */
const replies = new Map<string, Array<{ status: number; headers?: Record<string, string> }>>();

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const path = req.url ?? '';
      posts.push({ path, text: (JSON.parse(raw) as { text: string }).text });
      const next = replies.get(path)?.shift() ?? { status: 200 };
      res.writeHead(next.status, next.headers ?? {}).end(next.status === 200 ? 'ok' : 'no_service');
    });
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  hooks = `http://127.0.0.1:${(fake.address() as { port: number }).port}/services/`;

  db = await createScratchDb('nerv_slack');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  process.env['NERV_ENCRYPTION_KEY'] = KEY;
  process.env['NERV_SLACK_WEBHOOK_PREFIX'] = hooks;
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  job = new SlackJob(
    drizzle(pool) as unknown as NervDb,
    app.get(SlackService),
    app.get(SlackSender),
  );

  const orgId = newId();
  projectId = newId();
  plannerId = newId();
  requesterId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'chat','CHT','웹 채팅')`,
    [projectId, orgId],
  );
  for (const [id, name] of [
    [plannerId, '지민'],
    [requesterId, '요청자'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, `${id}@example.com`, name],
    );
  }

  // 연결은 사람 · admin 이다 — 세션 쿠키로 부른다
  const signUp = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: 'slack-admin@example.com', password: 'correct-horse-battery', name: '민서' },
  });
  const setCookie = signUp.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie : [String(setCookie)])
    .map((line) => line.split(';')[0] ?? '')
    .join('; ');
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE email = 'slack-admin@example.com'`,
  );
  adminId = rows[0]?.id ?? '';
  for (const [user, role] of [
    [adminId, 'admin'],
    [plannerId, 'planner'],
    [requesterId, 'developer'],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
      [newId(), orgId, projectId, user, role],
    );
  }
  agentToken = (
    await app
      .get(AuthService)
      .issueToken({ projectId, userId: adminId, name: 'agent', scopes: ['spec:read'] })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
  await new Promise((done) => fake.close(done));
  delete process.env['NERV_ENCRYPTION_KEY'];
  delete process.env['NERV_SLACK_WEBHOOK_PREFIX'];
});

beforeEach(async () => {
  posts.length = 0;
  replies.clear();
  process.env['NERV_ENCRYPTION_KEY'] = KEY;
  // 알림은 지우지 않는다 — 지우면 다음 파생이 앞 시험의 이벤트를 다시 알림으로 만들어 Slack 줄이 함께 생긴다
  await pool.query('DELETE FROM slack_outbox');
  await pool.query('DELETE FROM project_slack');
});

const call = (
  method: 'GET' | 'PUT' | 'DELETE' | 'POST',
  url: string,
  payload?: unknown,
  headers?: Record<string, string>,
) =>
  app.inject({
    method,
    url: `/api/v1/projects/chat${url}`,
    // 본문 없는 요청에 json 형식을 적으면 Fastify 가 400 으로 거절한다 — 본문이 있을 때만 적는다
    headers: headers ?? {
      cookie,
      origin: DEFAULT_ORIGIN,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
const connect = (path = 'T0/B0/ok-hook') =>
  call('PUT', '/integrations/slack', { webhook_url: `${hooks}${path}` });

/** 결재 요청 하나 — critical 이고 역할 큐(planner · admin)에게 간다 */
async function requestApproval(): Promise<string> {
  const approvalId = newId();
  await pool.query(
    `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id, requested_at)
     VALUES ($1,$2,'plan',$3,$4, now())`,
    [approvalId, projectId, newId(), requesterId],
  );
  await app.get(EventService).transact(async (_tx, emit) =>
    emit({
      type: NERV_EVENT.APPROVAL_REQUESTED,
      projectId,
      subjectType: 'approval',
      subjectId: approvalId,
      actorUserId: requesterId,
    }),
  );
  await app.get(NotificationService).route({ since: new Date(Date.now() - 60_000) });
  return approvalId;
}

describe('연결 — admin · 사람 · 키가 있는 배치만(REQ-API-355)', () => {
  it('키가 없는 배치는 연결을 받지 않는다', async () => {
    delete process.env['NERV_ENCRYPTION_KEY'];
    const res = await connect();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ details: { kind: 'slack_disabled' } });
    const status = (await call('GET', '/integrations')).json() as { slack: { enabled: boolean } };
    expect(status.slack.enabled).toBe(false);
  });

  it('접두가 다른 주소는 받지 않는다 — 서버가 아무 주소로나 보내지 않게', async () => {
    const res = await call('PUT', '/integrations/slack', {
      webhook_url: 'http://169.254.169.254/latest',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ details: { kind: 'invalid_input', field: 'webhook_url' } });
  });

  it('에이전트 토큰은 바꾸지 못한다', async () => {
    const res = await call(
      'PUT',
      '/integrations/slack',
      { webhook_url: `${hooks}T0/B0/x` },
      {
        authorization: `Bearer ${agentToken}`,
        'content-type': 'application/json',
      },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: NERV_ERROR.HUMAN_ONLY });
  });

  it('연결하면 암호문만 남고 화면은 끝 네 글자만 본다 · 감사가 남는다', async () => {
    const res = await connect('T0/B0/secret-abcd');
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query<{ webhook_cipher: string; webhook_hint: string }>(
      `SELECT webhook_cipher, webhook_hint FROM project_slack WHERE project_id = $1`,
      [projectId],
    );
    expect(rows[0]?.webhook_cipher).not.toContain('secret');
    expect(rows[0]?.webhook_hint).toBe('abcd');
    const status = (await call('GET', '/integrations')).json() as {
      slack: { enabled: boolean; connection: { hint: string; connected_by: string } };
    };
    expect(status.slack).toMatchObject({
      enabled: true,
      connection: { hint: 'abcd', connected_by: '민서' },
    });
    expect(JSON.stringify(status)).not.toContain('secret');
    const { rows: audit } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event WHERE type = 'project.updated' AND project_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [projectId],
    );
    expect(audit[0]?.payload).toMatchObject({
      fields: ['slack'],
      slack: 'connected',
      hint: 'abcd',
    });
    expect(JSON.stringify(audit[0]?.payload)).not.toContain('secret');
  });

  it('시험 게시는 큐를 거치지 않고 바로 간다 · 거절되면 이유를 돌려준다', async () => {
    await connect();
    const ok = await call('POST', '/integrations/slack/test');
    expect(ok.statusCode).toBe(200);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toContain('웹 채팅');

    await connect('T0/B0/gone');
    replies.set('/services/T0/B0/gone', [{ status: 404 }]);
    const bad = await call('POST', '/integrations/slack/test');
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toMatchObject({ details: { kind: 'slack_rejected' } });
  });
});

describe('발신 — critical 이벤트마다 채널에 한 번(REQ-API-354)', () => {
  it('받는 사람이 둘이어도 한 번 게시하고 이름과 링크만 담는다', async () => {
    await connect();
    const approvalId = await requestApproval();
    expect(await job.run()).toBe(1);
    expect(posts).toHaveLength(1);
    const text = posts[0]?.text ?? '';
    expect(text).toContain('웹 채팅');
    expect(text).toContain('지민');
    expect(text).toContain('민서');
    expect(text).not.toContain('요청자'); // 요청한 사람은 받는 사람이 아니다
    expect(text).toContain(`focus=${approvalId}`);
    // 같은 이벤트는 다시 넣지 않는다
    await app.get(NotificationService).route({ since: new Date(Date.now() - 60_000) });
    expect(await job.run()).toBe(0);
  });

  it('보내기 전에 받은 요청에서 처리됐으면 보내지 않는다 — 크로스 채널 dedup', async () => {
    await connect();
    const approvalId = await requestApproval();
    await pool.query(
      `UPDATE approval SET decision = 'approve', decided_by_user_id = $2, decided_at = now() WHERE id = $1`,
      [approvalId, adminId],
    );
    expect(await job.run()).toBe(0);
    expect(posts).toHaveLength(0);
    const { rows } = await pool.query<{ last_error: string; skipped: boolean }>(
      `SELECT last_error, skipped_at IS NOT NULL AS skipped FROM slack_outbox`,
    );
    expect(rows).toEqual([{ last_error: 'handled', skipped: true }]);
  });

  it('연결이 없으면 줄을 넣지 않는다 — 나중에 연결한 날 지난 일이 몰려 나가지 않게', async () => {
    await requestApproval();
    const { rows } = await pool.query(`SELECT 1 FROM slack_outbox`);
    expect(rows).toHaveLength(0);
  });

  it('지운 웹훅(404)은 바로 포기하고 화면이 이유를 본다 · 429 는 기다렸다 다시 보낸다', async () => {
    await connect('T0/B0/gone');
    replies.set('/services/T0/B0/gone', [{ status: 404 }]);
    await requestApproval();
    expect(await job.run()).toBe(0);
    const status = (await call('GET', '/integrations')).json() as {
      slack: { last_delivery: { state: string; error: string } };
    };
    expect(status.slack.last_delivery).toMatchObject({ state: 'failed' });
    expect(status.slack.last_delivery.error).toContain('HTTP 404');

    await pool.query('DELETE FROM slack_outbox');
    await connect('T0/B0/busy');
    replies.set('/services/T0/B0/busy', [{ status: 429, headers: { 'retry-after': '30' } }]);
    await requestApproval();
    expect(await job.run()).toBe(0);
    const { rows } = await pool.query<{ wait: number; failed: boolean }>(
      `SELECT extract(epoch FROM next_attempt_at - now())::int AS wait, failed_at IS NOT NULL AS failed FROM slack_outbox`,
    );
    expect(rows[0]?.failed).toBe(false);
    expect(rows[0]?.wait).toBeGreaterThan(20);
    await pool.query(`UPDATE slack_outbox SET next_attempt_at = now()`);
    expect(await job.run()).toBe(1);
  });

  it('끊으면 아직 안 보낸 줄도 보내지 않는다', async () => {
    await connect();
    await requestApproval();
    const res = await call('DELETE', '/integrations/slack');
    expect(res.statusCode).toBe(200);
    expect(await job.run()).toBe(0);
    expect(posts).toHaveLength(0);
    const { rows } = await pool.query<{ last_error: string }>(
      `SELECT last_error FROM slack_outbox`,
    );
    expect(rows).toEqual([{ last_error: 'disconnected' }]);
  });
});
