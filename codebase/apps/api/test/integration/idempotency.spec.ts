// L2 — 멱등 키 (api.md §1.5 · REQ-API-003 · 004 · 019)
//
//   WHEN 같은 Idempotency-Key 와 같은 본문으로 재호출되면,
//   THE SYSTEM SHALL 부작용 없이 최초 응답을 재생하고 Idempotency-Replayed: true 를 단다
//   WHEN 같은 키에 다른 본문이 오면, THE SYSTEM SHALL 409 idempotency_mismatch 를 반환한다
//
// **실제 Postgres 로 돈다.** 이 계약의 요점이 경합과 유일 인덱스라서, mock 으로는 "두 번
// 실행되지 않았다" 를 증명할 수 없다 — 세는 것은 DB 의 행 수다(AGENTS.md 테스트 규약).

import { newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { RetentionJob } from '../../src/worker/jobs/retention.job.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let token: string;
let projectId: string;
let userId: string;
let orgId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_idem');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId,
      name: 'idem',
      scopes: ['spec:read', 'task:claim', 'task:update', 'agent-session:launch'],
    })
  ).token;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM idempotency_key');
  await pool.query('DELETE FROM task');
});

async function post(
  body: Record<string, unknown>,
  key: string | null,
): Promise<{ status: number; headers: Record<string, unknown>; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
  if (key !== null) headers['idempotency-key'] = key;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/clemvion/tasks',
    headers,
    payload: body,
  });
  return {
    status: res.statusCode,
    headers: res.headers as Record<string, unknown>,
    body: res.json() as Record<string, unknown>,
  };
}

async function taskCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM task');
  return Number(rows[0]?.n ?? 0);
}

describe('REQ-API-003 — 같은 키 · 같은 본문은 재생이다', () => {
  it('두 번 보내도 Task 는 하나이고, 두 번째 응답이 첫 번째와 같다', async () => {
    const body = { title: '이중 제출' };
    const first = await post(body, 'key-same');
    const second = await post(body, 'key-same');

    expect(first.status).toBe(201);
    expect(await taskCount()).toBe(1);
    // 재생은 상태까지 같아야 한다 — 201 로 만들어진 것이 200 으로 돌아오면 분기가 달라진다
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');
    // 최초 응답에는 그 헤더가 없다 — 있으면 클라이언트가 매번 "중복이었다" 고 읽는다
    expect(first.headers['idempotency-replayed']).toBeUndefined();
  });

  it('키 순서가 달라도 같은 본문이다 — 재직렬화가 재시도를 깨지 않는다', async () => {
    const first = await post({ title: '순서', priority: 'P2' }, 'key-order');
    const second = await post({ priority: 'P2', title: '순서' }, 'key-order');

    expect(second.status).toBe(first.status);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(await taskCount()).toBe(1);
  });

  it('키가 없으면 그냥 두 번 만들어진다 — 헤더 생략은 허용이고 책임은 클라이언트다', async () => {
    await post({ title: '키 없음' }, null);
    await post({ title: '키 없음' }, null);
    expect(await taskCount()).toBe(2);
  });

  it('키가 다르면 다른 요청이다', async () => {
    await post({ title: '다른 키' }, 'key-a');
    await post({ title: '다른 키' }, 'key-b');
    expect(await taskCount()).toBe(2);
  });
});

describe('REQ-API-004 — 같은 키 · 다른 본문은 409다', () => {
  it('본문이 바뀐 재전송은 재시도가 아니라 다른 요청이다', async () => {
    await post({ title: '원본' }, 'key-clash');
    const changed = await post({ title: '바뀐 본문' }, 'key-clash');

    expect(changed.status).toBe(409);
    expect(changed.body['details']).toMatchObject({ kind: 'idempotency_mismatch' });
    // 거절이므로 두 번째는 만들어지지 않았다
    expect(await taskCount()).toBe(1);
  });
});

describe('멱등 저장소 — 주체와 실패', () => {
  it('주체가 다르면 남의 응답을 받지 않는다 — 키는 클라이언트가 만드는 값이다', async () => {
    const auth = app.get(AuthService);
    const otherUserId = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'other@example.com','다른','active')`,
      [otherUserId],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
      [newId(), orgId, projectId, otherUserId],
    );
    const otherToken = (
      await auth.issueToken({
        projectId,
        userId: otherUserId,
        name: 'other',
        scopes: ['spec:read', 'task:update'],
      })
    ).token;

    await post({ title: '내 것' }, 'shared-key');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/clemvion/tasks',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${otherToken}`,
        'idempotency-key': 'shared-key',
      },
      payload: { title: '남의 것' },
    });

    // 같은 키인데도 409 도 재생도 아니다 — 주체가 다르면 아예 다른 자리다
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotency-replayed']).toBeUndefined();
    expect(await taskCount()).toBe(2);
  });

  it('실패한 요청은 자리를 비운다 — 재시도가 같은 실패를 재생하지 않는다', async () => {
    // 제목이 빈 요청은 거절된다. 그 응답이 박제되면 같은 키로는 영영 성공할 수 없다.
    const failed = await post({ title: '' }, 'key-retry');
    expect(failed.status).toBeGreaterThanOrEqual(400);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM idempotency_key WHERE key = 'key-retry'`,
    );
    expect(Number(rows[0]?.n)).toBe(0);

    const retried = await post({ title: '이번엔 된다' }, 'key-retry');
    expect(retried.status).toBe(201);
  });

  it('24시간 지난 키는 보존 잡이 지운다 — 어제의 응답을 오늘 재생하지 않는다', async () => {
    await post({ title: '오래된 것' }, 'key-old');
    await pool.query(
      `UPDATE idempotency_key SET created_at = now() - interval '25 hours' WHERE key = 'key-old'`,
    );

    // 새 키 하나를 함께 둔다 — 잡이 오래된 것만 골라 지우는지 보기 위해서다
    await post({ title: '방금 것' }, 'key-fresh');

    const report = await new RetentionJob(drizzle(pool)).run();
    expect(report.idempotency_keys_deleted).toBe(1);

    const { rows } = await pool.query<{ key: string }>('SELECT key FROM idempotency_key');
    expect(rows.map((r) => r.key)).toEqual(['key-fresh']);
  });
});

describe('MCP 표면 — 같은 저장소다', () => {
  async function callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': '2026-07-28',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    });
    const body = res.json() as { result: { structuredContent: Record<string, unknown> } };
    return body.result.structuredContent;
  }

  it('같은 idempotency_key 로 두 번 부르면 Task 는 하나다', async () => {
    const args = { project: 'clemvion', title: 'MCP 이중 제출', idempotency_key: 'mcp-key' };
    const first = await callTool('nerv_task_create', args);
    const second = await callTool('nerv_task_create', args);

    expect(await taskCount()).toBe(1);
    expect(second['task_id']).toBe(first['task_id']);
  });

  it('멱등 키가 없으면 두 번 만들어진다', async () => {
    await callTool('nerv_task_create', { project: 'clemvion', title: '키 없는 MCP' });
    await callTool('nerv_task_create', { project: 'clemvion', title: '키 없는 MCP' });
    expect(await taskCount()).toBe(2);
  });

  it('읽기 도구는 저장소를 거치지 않는다 — 재생하면 낡은 값을 준다', async () => {
    await callTool('nerv_task_list', { project: 'clemvion', idempotency_key: 'read-key' });
    await callTool('nerv_task_create', { project: 'clemvion', title: '그 사이에 생긴 것' });
    const after = await callTool('nerv_task_list', {
      project: 'clemvion',
      idempotency_key: 'read-key',
    });

    const items = after['items'] as unknown[];
    expect(items.length).toBe(1);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM idempotency_key WHERE key = 'read-key'`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'hana@example.com','하나','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, userId],
  );
}
