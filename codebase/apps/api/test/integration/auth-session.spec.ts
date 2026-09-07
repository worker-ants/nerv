// E08-S01 — better-auth 세션 인증(웹 경로)
//
// 인증은 두 경로다(api.md §1.3): 세션 쿠키(브라우저)와 PAT(에이전트). 이 파일이 지키는 것은
// **두 경로가 같은 사람을 가리키되 권한이 다르다**는 것이다 — 세션은 사람이라 받은 요청에
// 도달하고, PAT 는 에이전트라 같은 URL 에서 HUMAN_ONLY 로 막힌다(D-08).

import { NERV_ERROR, newId } from '@nerv/schema';
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

  it('세션은 사람이라 받은 요청에 도달한다 — 같은 URL 에서 PAT 는 막힌다 (D-08)', async () => {
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

describe('개발 시드 계정 — 자격증명이 도메인 행과 함께 심어진다', () => {
  it('시드 사용자는 issuer 까지 맞아야 로그인된다 (better-auth 1.7)', async () => {
    // better-auth 의 sign-in 은 세 필드를 **동시에** 본다: provider_id · issuer · account_id.
    // 하나라도 다르면 "User not found" 로 실패하는데, 행은 존재하므로 원인을 찾기 어렵다.
    // 시드가 그 함정에 빠졌었다(issuer 누락) — 여기서 형태를 고정한다.
    const seeded = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'seeded@example.com','시드',
       'active')`,
      [seeded],
    );

    const { hashPassword } = await import('better-auth/crypto');
    await pool.query(
      `INSERT INTO auth_account (id, user_id, account_id, provider_id, issuer, password)
       VALUES ($1,$2,$3,'credential','local:credential',$4)`,
      [newId(), seeded, seeded, await hashPassword('seeded-password')],
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'seeded@example.com', password: 'seeded-password' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('issuer 가 없으면 행이 있어도 로그인되지 않는다 — 회귀 방지', async () => {
    const broken = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'broken@example.com','깨진',
       'active')`,
      [broken],
    );
    const { hashPassword } = await import('better-auth/crypto');
    await pool.query(
      `INSERT INTO auth_account (id, user_id, account_id, provider_id, password)
       VALUES ($1,$2,$3,'credential',$4)`,
      [newId(), broken, broken, await hashPassword('broken-password')],
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'broken@example.com', password: 'broken-password' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

/**
 * **같은 slug 가 두 조직에 있을 때 웹이 열려야 한다**(2026-09-07 · REQ-API-152).
 *
 * 해소가 `WHERE slug = …` 의 첫 행을 고르던 동안, 두 번째 조직의 사람은 자기 프로젝트
 * 주소에서 403 `not_member` 를 봤다 — **없는 프로젝트가 아니라 있는 프로젝트를 못 여는**
 * 실패라 원인을 짐작할 단서가 화면에 없다. 여기서 보는 것은 그 번역이다: 주체의 소속으로
 * 좁혀지는가, 좁혀지지 않으면 409 로 말하는가, 한정자를 실으면 열리는가.
 */
describe('slug 이 두 조직에 있을 때의 REST 표면 (REQ-API-152)', () => {
  let orgAlpha: string;
  let orgBeta: string;
  let sharedAlpha: string;
  let sharedBeta: string;
  let betaCookie: string;
  let bothCookie: string;
  let bothId: string;

  async function signIn(email: string, name: string): Promise<{ cookie: string; id: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: { email, password: PASSWORD, name },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
      email,
    ]);
    return { cookie: raw.split(';')[0] ?? '', id: rows[0]?.id ?? '' };
  }

  beforeAll(async () => {
    orgAlpha = newId();
    orgBeta = newId();
    sharedAlpha = newId();
    sharedBeta = newId();
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'alpha','알파')`, [
      orgAlpha,
    ]);
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'beta','베타')`, [
      orgBeta,
    ]);
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'shared','SHA','공유 알파')`,
      [sharedAlpha, orgAlpha],
    );
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'shared','SHB','공유 베타')`,
      [sharedBeta, orgBeta],
    );

    const beta = await signIn('beta-only@example.com', '베타만');
    betaCookie = beta.cookie;
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
      [newId(), orgBeta, sharedBeta, beta.id],
    );

    const both = await signIn('two-orgs@example.com', '양쪽');
    bothCookie = both.cookie;
    bothId = both.id;
    for (const [org, project] of [
      [orgAlpha, sharedAlpha],
      [orgBeta, sharedBeta],
    ]) {
      await pool.query(
        `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'admin')`,
        [newId(), org, project, both.id],
      );
    }
  });

  it('주체의 소속이 하나면 그 조직의 프로젝트가 열린다 — 403 이 아니다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/shared',
      headers: { cookie: betaCookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>)['id']).toBe(sharedBeta);
  });

  it('양쪽 소속이면 한정자 없이 409 다 — 첫 행을 고르는 것은 조용한 오답이다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/shared',
      headers: { cookie: bothCookie },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as Record<string, unknown>;
    expect(body['code']).toBe(NERV_ERROR.PRECONDITION);
    expect(body['details']).toMatchObject({ kind: 'ambiguous_project', orgs: ['alpha', 'beta'] });
  });

  it('`X-Nerv-Org` 를 실으면 그 조직이 열린다 — 웹이 아는 것을 서버에 말해 준다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/shared',
      headers: { cookie: bothCookie, 'x-nerv-org': 'alpha' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>)['id']).toBe(sharedAlpha);
  });

  it('토큰 발급도 조직을 받는다 — 남의 조직 프로젝트에 바인딩된 토큰은 조용한 오답이다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/tokens',
      headers: { cookie: bothCookie, 'content-type': 'application/json' },
      payload: { project: 'shared', org: 'beta', name: '베타 토큰', scopes: ['spec:read'] },
    });
    expect(res.statusCode).toBe(201);

    const { rows } = await pool.query<{ project_id: string }>(
      `SELECT project_id FROM api_token WHERE user_id = $1 AND name = '베타 토큰'`,
      [bothId],
    );
    expect(rows[0]?.project_id).toBe(sharedBeta);
  });
});
