// L2 — 쿼터가 실제로 집행되는가 (api.md §1.8 · REQ-API-012 · 077)
//
// 산수는 L1(`src/common/rate-limit.spec.ts`)이 본다. 여기서 답해야 하는 것은 다른 물음이다:
// **가드가 배선돼 있는가.** 이 항목의 원래 결함이 바로 그것이었다 — 상수 3종은 있었고
// 세는 곳이 없었다. 그런 결함은 HTTP 로 실제 요청을 보내야만 드러난다.

import { newId } from '@nerv/schema';
import { RATE_LIMIT_PAT_PER_MIN } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { RATE_WINDOW_SECONDS } from '../../src/common/rate-limit.service.js';
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
  /**
   * **창을 고정한다** (2026-09-05 — 흔들리던 검사를 고친다).
   *
   * 한도는 고정 60초 창이다(`RATE_WINDOW_SECONDS`). 300건을 쏘는 동안 분 경계를 넘으면
   * 카운터가 리셋되고 301번째가 통과한다 — 이 검사는 **실행 시각에 따라** 초록이었다가
   * 빨강이었다. 실제로 전체 실행에서 한 번 실패하고 재실행에서 통과했다.
   *
   * 흔들리는 검사는 고쳐지지 않는다. 다음 사람은 그것을 "가끔 그러는 것" 으로 배우고,
   * **진짜 회귀가 그 소음 속에 숨는다.**
   *
   * 서비스는 `hit(subject, now)` 로 시간을 인자로 받지만 **가드는 그것을 넘기지 않는다** —
   * HTTP 경로를 있는 그대로 검증하는 것이 이 L2 의 요점이라 가드를 바꾸지 않고 `Date` 만
   * 얼린다. 얼리는 시각은 **창의 시작**이라, 300건이 실제로 몇 초가 걸리든 한 창 안이다.
   * 타이머는 얼리지 않는다(`toFake: ['Date']`) — pg 풀과 fastify 는 실제 타이머로 돈다.
   */
  beforeEach(() => {
    const windowMs = RATE_WINDOW_SECONDS * 1000;
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Math.floor(Date.now() / windowMs) * windowMs,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    // 창을 시작점에 얼렸으므로 남은 시간은 **정확히 한 창**이다. 예전에는 `> 0` 만 봤는데,
    // 그 느슨함이 창 계산이 틀려도 통과하게 뒀다(§1.4 — 0 은 "지금 다시" 라는 뜻이라
    // 클라이언트를 곧장 다음 429 로 보낸다).
    expect(Number(over.headers['retry-after'])).toBe(RATE_WINDOW_SECONDS);
    // **타임아웃도 창보다 넉넉해야 한다.** 재현 실험에서 301건이 56초 걸린 적이 있다 —
    // 60초로 두면 창을 고쳐 놓고 타임아웃으로 다시 흔들린다. 같은 종류의 실패다.
  }, 180_000);

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
