// E08-S01 — better-auth 세션 인증(웹 경로)
//
// 인증은 두 경로다(api.md §1.3): 세션 쿠키(브라우저)와 PAT(에이전트). 이 파일이 지키는 것은
// **두 경로가 같은 사람을 가리키되 권한이 다르다**는 것이다 — 세션은 사람이라 승인함에
// 도달하고, PAT 는 에이전트라 같은 URL 에서 HUMAN_ONLY 로 막힌다(D-08).

import { NERV_ERROR, newId, runMigrations } from '@nerv/schema';
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
let projectId: string;
let orgId: string;
let cookie: string;
let userId: string;

const EMAIL = 'jimin@example.com';
const PASSWORD = 'nerv-dev-password';

beforeAll(async () => {
  db = await createScratchDb('nerv_authsession');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  orgId = newId();
  projectId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

describe('better-auth 핸들러 (/api/auth/*)', () => {
  it('가입은 도메인 user 테이블에 쓴다 — 인증용 사본을 따로 만들지 않는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: EMAIL, password: PASSWORD, name: '지민' },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await pool.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM "user" WHERE email = $1`,
      [EMAIL],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.display_name).toBe('지민');
    userId = rows[0]?.id ?? '';

    // 비밀번호 원문은 어디에도 없다 — 해시만 auth_account 에 있다
    const { rows: accounts } = await pool.query<{ password: string }>(
      `SELECT password FROM auth_account WHERE user_id = $1`,
      [userId],
    );
    expect(accounts[0]?.password).not.toContain(PASSWORD);
  });

  it('로그인은 HttpOnly 세션 쿠키를 발급한다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(raw).toContain('better-auth.session_token=');
    expect(raw.toLowerCase()).toContain('httponly');
    cookie = raw.split(';')[0] ?? '';

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM auth_session WHERE user_id = $1`,
      [userId],
    );
    // 가입도 세션을 만든다(가입 직후 로그인 상태) — 여기서 세는 것은 "최소 하나"다
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it('틀린 비밀번호는 세션을 만들지 않는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: EMAIL, password: 'wrong-password' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('세션 쿠키로 도메인 표면에 든다', () => {
  it('멤버십이 없으면 프로젝트 경로에서 막힌다 — 로그인은 신원이지 권한이 아니다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('멤버십이 있으면 통과하고 역할이 실린다', async () => {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
      [newId(), orgId, projectId, userId],
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>)['slug']).toBe('clemvion');
  });

  it('세션은 사람이라 승인함에 도달한다 — 같은 URL 에서 PAT 는 막힌다 (D-08)', async () => {
    const asHuman = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals',
      headers: { cookie },
    });
    expect(asHuman.statusCode).toBe(200);

    const pat = (
      await app
        .get(AuthService)
        .issueToken({ projectId, userId, name: 'agent', scopes: ['spec:read'] })
    ).token;
    const asAgent = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals',
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(asAgent.statusCode).toBe(403);
    expect((asAgent.json() as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);
  });

  it('쿠키가 없으면 401 이다 — 미구현 상태의 기본값은 열림이 아니라 닫힘이다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as Record<string, unknown>)['code']).toBe(NERV_ERROR.UNAUTHENTICATED);
  });

  it('로그아웃하면 세션이 사라진다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});
