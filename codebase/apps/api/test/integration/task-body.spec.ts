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

/**
 * 위임 명세를 도구로 채운다 (2026-10-10 · REQ-API-282 · 283).
 *
 * clemvion 에이전트는 위임 명세 칸을 비운 채 작업을 만들었고(CLE-T-V54M21 · 2K6CDJ · CYS6YF), ready 로 올릴 수 없다는
 * 것을 안 뒤에는 고칠 길이 없어 같은 내용으로 다시 만들었다 — 백로그에 진행하지 않을 중복이 셋 남았다.
 */
describe('위임 명세를 도구로 채운다 (REQ-API-282 · 283)', () => {
  const named = (name: string, roles: string[] = ['developer']) => {
    const t = app.get(TaskTools).tools.find((x) => x.name === name)!;
    const ctx = {
      projectId,
      sessionId: null,
      principal: { userId, isAgent: true, roles, scopes: ['task:update'] },
    } as unknown as ToolContext;
    return (input: Record<string, unknown>): Promise<Record<string, unknown>> =>
      t.handler(input, ctx).catch((e: unknown) => e) as Promise<Record<string, unknown>>;
  };
  const briefOf = async (key: string): Promise<Record<string, unknown> | undefined> =>
    (
      await pool.query(
        `SELECT status::text AS status, goal_md, output_format_md, tools_sources_md, boundaries_md
           FROM task WHERE key = $1`,
        [key],
      )
    ).rows[0];

  it('CLE-T-CYS6YF — 칸을 비운 채 만들면 빈 칸과 지문을 받고, 같은 작업을 다시 만들지 않고 채워 ready 로 올린다', async () => {
    const created = await named('nerv_task_create')({
      title: '하네스: 같은 초 세션의 멱등 키 앞자리',
      goal_md: '같은 초에 연 두 세션의 멱등 키가 겹치지 않는다',
      output_format_md: 'PR 1건',
      boundaries_md: 'NERV 서버는 고치지 않는다',
    });
    expect(created).toMatchObject({ status: 'backlog', delegation_missing: ['tools_sources_md'] });
    const key = String(created['key']);

    const filled = await named('nerv_task_update')({
      task_id: key,
      tools_sources_md: 'scripts/nerv_review_payload.py · .review/ 디렉터리 규칙',
      base_brief_hash: created['brief_hash'],
    });
    expect(filled).toMatchObject({
      status: 'ready',
      delegation_complete: true,
      delegation_missing: [],
    });
    expect(await briefOf(key)).toMatchObject({
      status: 'ready',
      tools_sources_md: 'scripts/nerv_review_payload.py · .review/ 디렉터리 규칙',
      goal_md: '같은 초에 연 두 세션의 멱등 키가 겹치지 않는다',
    });
    // 조회의 지문과 응답의 지문이 같다 — 이어서 고칠 때 다시 읽지 않아도 된다
    const detail = await app.get(TaskService).get({ projectId, taskKey: key });
    expect(detail['brief_hash']).toBe(filled['brief_hash']);
    // 다시 만들지 않았다 — 백로그에 남은 중복이 없다
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM task WHERE title = $1`, [
      '하네스: 같은 초 세션의 멱등 키 앞자리',
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('지문 없이는 받지 않고, 그 사이 사람이 채웠으면 409 stale_brief 로 덮지 않는다', async () => {
    const created = await named('nerv_task_create')({ title: '빈 명세 작업' });
    expect(created['delegation_missing']).toEqual([
      'goal_md',
      'output_format_md',
      'tools_sources_md',
      'boundaries_md',
    ]);
    const key = String(created['key']);

    const noHash = await named('nerv_task_update')({ task_id: key, goal_md: '목표' });
    expect(noHash['details']).toMatchObject({ kind: 'invalid_input', field: 'base_brief_hash' });

    await pool.query(`UPDATE task SET goal_md = '사람이 쓴 목표' WHERE key = $1`, [key]);
    const stale = await named('nerv_task_update')({
      task_id: key,
      goal_md: '에이전트 목표',
      base_brief_hash: created['brief_hash'],
    });
    expect(stale).toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'stale_brief', current_brief_hash: expect.any(String), hint: 'reread' },
    });
    expect((await briefOf(key))?.['goal_md']).toBe('사람이 쓴 목표');
  });

  it('본문과 같은 역할이 있어야 하고, 빈 문자열은 안 준 것이다', async () => {
    const created = await named('nerv_task_create')({ title: '역할 확인 작업' });
    const key = String(created['key']);
    const denied = await named('nerv_task_update', ['qa'])({
      task_id: key,
      goal_md: '목표',
      base_brief_hash: created['brief_hash'],
    });
    expect(denied).toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'role_required' },
    });
    const blank = await named('nerv_task_update')({
      task_id: key,
      goal_md: '',
      base_brief_hash: created['brief_hash'],
    });
    expect(blank['details']).toMatchObject({ kind: 'invalid_input', field: 'status' });
  });

  it('REST 도 base_brief_hash 를 주면 검사한다', async () => {
    const created = await named('nerv_task_create')({ title: 'REST 명세 작업' });
    const key = String(created['key']);
    const patch = (payload: Record<string, unknown>): ReturnType<typeof app.inject> =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/projects/clemvion/tasks/${key}`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload,
      });
    const stale = await patch({ goal_md: 'REST 목표', base_brief_hash: 'deadbeef' });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { details: { kind: string } }).details.kind).toBe('stale_brief');
    const ok = await patch({ goal_md: 'REST 목표', base_brief_hash: created['brief_hash'] });
    expect(ok.statusCode).toBe(200);
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
