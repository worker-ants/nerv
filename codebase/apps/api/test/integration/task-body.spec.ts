// 작업 본문 수정과 동시 수정 보호 (2026-09-28 · clemvion 요청 N10 · 사람 결정 D12 · REQ-API-254)
//
// 에이전트가 작업 본문을 고칠 길이 없었다(`nerv_task_update` 는 상태만 받았다). 길을 열되 사람이 방금 고친 본문을
// 모른 채 덮지 않게, 읽은 본문의 지문(`body_hash`)을 되돌려 줘야 쓴다 — 스펙 초안의 `base_hash` 와 같은 비교-교환이다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { TaskTools } from '../../src/modules/task/task.tools.js';
import type { ToolContext } from '../../src/mcp/tool-context.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let userId: string;
let token: string;

const KEY = 'CLV-T-BODY01';
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

beforeAll(async () => {
  db = await createScratchDb('nerv_task_body');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId,
      name: 'body',
      scopes: ['task:update', 'task:claim'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query(`UPDATE task SET body_md = '처음 본문' WHERE key = $1`, [KEY]);
});

function tool(roles: string[] = ['developer']): {
  call: (input: Record<string, unknown>) => Promise<unknown>;
} {
  const t = app.get(TaskTools).tools.find((x) => x.name === 'nerv_task_update')!;
  const ctx = {
    projectId,
    sessionId: null,
    principal: { userId, isAgent: true, roles, scopes: ['task:update'] },
  } as unknown as ToolContext;
  return { call: (input) => t.handler(input, ctx).catch((e: unknown) => e) };
}

describe('작업 본문 수정 (REQ-API-254)', () => {
  it('조회는 본문의 지문을 준다 — sha256(body_md)', async () => {
    const task = await app.get(TaskService).get({ projectId, taskKey: KEY });
    expect(task['body_hash']).toBe(sha('처음 본문'));
  });

  it('도구는 status 없이 본문만 고친다 — 지문이 맞으면 쓰고 새 지문을 준다', async () => {
    const out = (await tool().call({
      task_id: KEY,
      body_md: '고친 본문',
      base_hash: sha('처음 본문'),
    })) as Record<string, unknown>;
    expect(out['body_hash']).toBe(sha('고친 본문'));
    const { rows } = await pool.query<{ body_md: string; status: string }>(
      `SELECT body_md, status::text AS status FROM task WHERE key = $1`,
      [KEY],
    );
    expect(rows[0]).toEqual({ body_md: '고친 본문', status: 'backlog' });
  });

  it('그 사이 누가 고쳤으면 409 stale_body 와 지금 지문을 준다 — 덮지 않는다', async () => {
    await pool.query(`UPDATE task SET body_md = '사람이 고친 본문' WHERE key = $1`, [KEY]);
    const error = (await tool().call({
      task_id: KEY,
      body_md: '에이전트 본문',
      base_hash: sha('처음 본문'),
    })) as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe(NERV_ERROR.PRECONDITION);
    expect(error.details).toMatchObject({
      kind: 'stale_body',
      current_hash: sha('사람이 고친 본문'),
      hint: 'reread',
    });
    const { rows } = await pool.query<{ body_md: string }>(
      `SELECT body_md FROM task WHERE key = $1`,
      [KEY],
    );
    expect(rows[0]?.body_md).toBe('사람이 고친 본문');
  });

  it('도구는 지문 없이 본문을 받지 않고, 둘 다 없으면 거절한다', async () => {
    const noHash = (await tool().call({ task_id: KEY, body_md: 'x' })) as {
      details: Record<string, unknown>;
    };
    expect(noHash.details).toMatchObject({ kind: 'invalid_input', field: 'base_hash' });
    const nothing = (await tool().call({ task_id: KEY })) as { details: Record<string, unknown> };
    expect(nothing.details).toMatchObject({ kind: 'invalid_input', field: 'status' });
  });

  it('본문 수정은 EP-TASK-05 와 같은 역할이 있어야 한다', async () => {
    const denied = (await tool(['qa']).call({
      task_id: KEY,
      body_md: 'x',
      base_hash: sha('처음 본문'),
    })) as { code: string; details: Record<string, unknown> };
    expect(denied.code).toBe(NERV_ERROR.FORBIDDEN);
    expect(denied.details['kind']).toBe('role_required');
  });

  it('REST 는 base_hash 를 주면 검사하고, 주지 않으면 예전처럼 쓴다', async () => {
    const patch = (payload: Record<string, unknown>): ReturnType<typeof app.inject> =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/projects/clemvion/tasks/${KEY}`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload,
      });
    const stale = await patch({ body_md: 'REST 본문', base_hash: sha('다른 본문') });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { details: { kind: string } }).details.kind).toBe('stale_body');

    const ok = await patch({ body_md: 'REST 본문', base_hash: sha('처음 본문') });
    expect(ok.statusCode).toBe(200);
    const plain = await patch({ body_md: '지문 없이' });
    expect(plain.statusCode).toBe(200);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dev@example.com','도현','active')`,
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
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, body_md)
     VALUES ($1,$2,$3,'본문 작업','backlog','처음 본문')`,
    [newId(), projectId, KEY],
  );
}
