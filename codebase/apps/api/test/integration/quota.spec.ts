// L2 — 쿼터가 실제로 집행되는가 (api.md §1.8 · REQ-API-012 · 077)
//
// 산수는 L1(`src/common/rate-limit.spec.ts`)이 본다. 여기서 답해야 하는 것은 다른 물음이다:
// **가드가 배선돼 있는가.** 이 항목의 원래 결함이 바로 그것이었다 — 상수 3종은 있었고
// 세는 곳이 없었다. 그런 결함은 HTTP 로 실제 요청을 보내야만 드러난다.

import { newId } from '@nerv/schema';
import { RATE_LIMIT_PAT_PER_MIN } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
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
  db = await createScratchDb('nerv_quota');
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
      name: 'quota',
      scopes: ['spec:read'],
    })
  ).token;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
});

async function get(bearer: string): Promise<{ status: number; headers: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/clemvion/specs/tree',
    headers: { authorization: `Bearer ${bearer}` },
  });
  return { status: res.statusCode, headers: res.headers as Record<string, unknown> };
}

describe('쿼터 — PAT 토큰당 한도가 실제로 걸린다', () => {
  it(`${RATE_LIMIT_PAT_PER_MIN}건까지는 통과하고 그 다음이 429다`, async () => {
    let last = { status: 0, headers: {} as Record<string, unknown> };
    for (let i = 0; i < RATE_LIMIT_PAT_PER_MIN; i += 1) {
      last = await get(token);
      if (last.status === 429) break;
    }
    // 한도 안에서는 429 가 나오지 않는다 — 나오면 창 계산이 틀렸다는 뜻이다
    expect(last.status).not.toBe(429);

    const over = await get(token);
    expect(over.status).toBe(429);
    // 재시도 시각이 없으면 클라이언트는 즉시 되돌아와 같은 429 를 받는다(§1.4)
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  }, 60_000);

  it('다른 토큰은 남의 소진에 걸리지 않는다', async () => {
    const fresh = (
      await app.get(AuthService).issueToken({
        projectId,
        userId,
        name: 'quota-2',
        scopes: ['spec:read'],
      })
    ).token;
    const res = await get(fresh);
    expect(res.status).not.toBe(429);
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
