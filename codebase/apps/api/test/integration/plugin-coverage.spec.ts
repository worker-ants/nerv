// 플러그인 활성화 — E12-S03 · REQ-API-168 (2026-09-24)
//
// 백로그 E12-S03 의 수용 기준 "관리형 settings 로 배포하면 참여 호스트의 **활성화 여부를
// 서버에서 확인** 가능하게 한다" 가 이 스토리의 마지막 남은 줄이었다. 서버는 그것을 알 방법이
// 없었다 — 세션은 훅(플러그인)으로도 MCP `nerv_bootstrap`(플러그인 없이)으로도 들어온다.
// 훅 포워더가 `X-NERV-Plugin` 으로 버전을 싣고, 서버가 그 값으로 가른다. 여기서 보는 것:
//   ① 훅이 실은 버전이 세션에 남고, 모양이 틀린 값은 없는 것으로 본다
//   ② 스킬의 `nerv_bootstrap` 이 훅 세션을 채택해도 버전을 지우지 않는다(채택은 cwd 대조)
//   ③ 현황은 **기계마다 가장 최근 세션**으로 판정하고, Claude Code 만 세고, 창 밖은 뺀다

import { newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let token: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_plugincov');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const orgId = newId();
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

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId,
      name: 'hooks',
      scopes: ['agent-session:launch', 'spec:read'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM activity');
  await pool.query('TRUNCATE event');
  await pool.query('DELETE FROM agent_session');
});

async function sessionHook(
  externalId: string,
  headers: { host: string; plugin?: string; agent?: string },
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/ingest/hooks/session',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-nerv-host': headers.host,
      'x-nerv-agent': headers.agent ?? 'claude-code',
      ...(headers.plugin === undefined ? {} : { 'x-nerv-plugin': headers.plugin }),
    },
    payload: { session_id: externalId, cwd: '/work/clemvion', source: 'startup' },
  });
  return res.statusCode;
}

async function pluginOf(externalId: string): Promise<string | null> {
  const { rows } = await pool.query<{ plugin_version: string | null }>(
    `SELECT plugin_version FROM agent_session WHERE external_session_id = $1`,
    [externalId],
  );
  return rows[0]?.plugin_version ?? null;
}

async function coverage(): Promise<{
  window_days: number;
  total: number;
  active: number;
  hosts: { hostname: string; active: boolean; plugin_version: string | null }[];
}> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/clemvion/sessions/plugin-coverage',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('훅이 실은 버전이 세션에 남는다', () => {
  it('SessionStart 의 `X-NERV-Plugin` 이 그 세션의 플러그인 버전이 된다', async () => {
    expect(await sessionHook('S-1', { host: 'mac-01', plugin: '0.3.2' })).toBe(202);
    expect(await pluginOf('S-1')).toBe('0.3.2');
  });

  it('헤더가 없으면 NULL — 플러그인이 켜졌다는 증거가 없다', async () => {
    await sessionHook('S-2', { host: 'mac-01' });
    expect(await pluginOf('S-2')).toBeNull();
  });

  it('버전 모양이 아닌 값은 없는 것으로 본다 — 틀린 값을 "켜짐" 으로 세지 않는다', async () => {
    await sessionHook('S-3', { host: 'mac-01', plugin: '<script>' });
    expect(await pluginOf('S-3')).toBeNull();
  });

  it('같은 세션이 다시 시작하면 새 버전이 이긴다 — 세션 사이에 플러그인을 올렸다', async () => {
    await sessionHook('S-4', { host: 'mac-01', plugin: '0.3.1' });
    await sessionHook('S-4', { host: 'mac-01', plugin: '0.3.2' });
    expect(await pluginOf('S-4')).toBe('0.3.2');
  });

  it('스킬의 nerv_bootstrap 이 훅 세션을 채택해도 버전을 지우지 않는다', async () => {
    await sessionHook('S-5', { host: 'mac-01', plugin: '0.3.2' });
    const adopted = await app.get(SessionService).bootstrap({
      projectId,
      userId,
      agentType: 'claude-code',
      hostname: 'mac-01',
      cwd: '/work/clemvion',
    });
    expect(adopted.resumed).toBe(true);
    expect(await pluginOf('S-5')).toBe('0.3.2');
  });
});

describe('활성화 현황 (EP-SES-06)', () => {
  it('기계마다 가장 최근 세션으로 판정한다 — 켰다가 끈 기계는 꺼짐이다', async () => {
    await sessionHook('S-old', { host: 'mac-01', plugin: '0.3.2' });
    await pool.query(
      `UPDATE agent_session SET started_at = now() - interval '2 days',
                                last_heartbeat_at = now() - interval '2 days'
        WHERE external_session_id = 'S-old'`,
    );
    await sessionHook('S-new', { host: 'mac-01' });
    await sessionHook('S-other', { host: 'mac-02', plugin: '0.3.2' });

    const c = await coverage();
    expect(c.total).toBe(2);
    expect(c.active).toBe(1);
    // 꺼진 기계가 먼저다 — 이 목록을 여는 사람이 찾는 것은 켜야 할 기계다
    expect(c.hosts.map((h) => [h.hostname, h.active])).toEqual([
      ['mac-01', false],
      ['mac-02', true],
    ]);
    expect(c.hosts[1]?.plugin_version).toBe('0.3.2');
  });

  it('Claude Code 세션만 센다 — Codex 는 플러그인이 없어도 정상이다', async () => {
    await sessionHook('S-cc', { host: 'mac-01', plugin: '0.3.2' });
    await sessionHook('S-codex', { host: 'linux-01', agent: 'codex' });
    const c = await coverage();
    expect(c.total).toBe(1);
    expect(c.active).toBe(1);
  });

  it('창 밖의 기계는 세지 않는다 — 한 번 쓰고 떠난 노트북이 분모를 영원히 끌지 않게', async () => {
    await sessionHook('S-gone', { host: 'old-laptop' });
    await pool.query(
      `UPDATE agent_session SET started_at = now() - interval '45 days',
                                last_heartbeat_at = now() - interval '45 days'
        WHERE external_session_id = 'S-gone'`,
    );
    const c = await coverage();
    expect(c.window_days).toBe(30);
    expect(c.total).toBe(0);
  });

  it('보드 카드도 그 세션의 플러그인 버전을 싣는다', async () => {
    await sessionHook('S-card', { host: 'mac-01', plugin: '0.3.2' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    const items = (res.json() as { items: { plugin_version: string | null }[] }).items;
    expect(items[0]?.plugin_version).toBe('0.3.2');
  });
});
