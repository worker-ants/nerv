// 내 계정 — 이름과 비밀번호 (2026-09-25 — 사람 결정 D10 · UI/UX 검토 SET-13 · REQ-API-186)
//
// 가입할 때 적은 이름은 멤버 표·카드·활동에 그대로 박히는데 고칠 길이 없었고, 비밀번호를 바꾸는 화면도 없었다.
// 인증 스택(better-auth)은 두 문을 이미 열어 두고 있었다 — 그중 `/update-user` 는 이름을 **검사 없이** 받는다.
// 이 파일이 지키는 것: 이름은 `PATCH /api/v1/me` 하나로만(길이·공백 · 사람만) 바뀌고 `/update-user` 는 닫혔다 ·
// 비밀번호는 지금 비밀번호를 맞혀야 바뀌고, 바꾸며 다른 세션을 끊을 수 있다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { DEFAULT_ORIGIN } from '../../src/common/origins.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let userId: string;
let cookie: string;

const EMAIL = 'account@example.com';
const PASSWORD = 'first-password';
const NEXT_PASSWORD = 'second-password';

async function signIn(password: string): Promise<{ status: number; cookie: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: EMAIL, password },
  });
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  return { status: res.statusCode, cookie: raw.split(';')[0] ?? '' };
}

/** 쿠키를 실은 상태 변경 요청 — 오리진이 필요하다(REQ-CB-041 · 브라우저는 언제나 싣는다) */
function withSession(value: string): Record<string, string> {
  return { cookie: value, origin: DEFAULT_ORIGIN, 'content-type': 'application/json' };
}

beforeAll(async () => {
  db = await createScratchDb('nerv_account');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const orgId = newId();
  projectId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  const signUp = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: EMAIL, password: PASSWORD, name: '지민' },
  });
  expect(signUp.statusCode).toBe(200);
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
    EMAIL,
  ]);
  userId = rows[0]?.id ?? '';
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, userId],
  );
  cookie = (await signIn(PASSWORD)).cookie;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

describe('표시 이름 — EP-AUTH-02 (REQ-API-186)', () => {
  it('앞뒤 공백을 잘라 저장하고, 바뀐 me 를 돌려준다', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: withSession(cookie),
      payload: { display_name: '  김지민  ' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>)['display_name']).toBe('김지민');
    const { rows } = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM "user" WHERE id = $1`,
      [userId],
    );
    expect(rows[0]?.display_name).toBe('김지민');
    // 세션이 읽는 이름도 같은 열이다 — 두 벌이 없다
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect((me.json() as Record<string, unknown>)['display_name']).toBe('김지민');
  });

  it('빈 이름·너무 긴 이름·모르는 칸은 거절한다 — 조용히 버리지 않는다', async () => {
    for (const payload of [
      { display_name: '   ' },
      { display_name: 'x'.repeat(61) },
      { display_name: '지민', email: 'other@example.com' },
    ]) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me',
        headers: withSession(cookie),
        payload,
      });
      // 모양이 틀린 본문은 전제 위반이다(parse-body.ts — 계약의 모든 표면이 같은 모양으로 거절한다)
      expect(res.statusCode).toBe(400);
      expect((res.json() as Record<string, unknown>)['code']).toBe(NERV_ERROR.PRECONDITION);
    }
  });

  it('에이전트 토큰으로는 바꾸지 않는다 — 사람의 이름은 사람이 바꾼다 (D-08)', async () => {
    const pat = (
      await app
        .get(AuthService)
        .issueToken({ projectId, userId, name: 'agent', scopes: ['spec:read'] })
    ).token;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${pat}`, 'content-type': 'application/json' },
      payload: { display_name: '에이전트' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);
  });

  it('인증 스택의 /update-user 는 닫혔다 — 검사 없이 이름을 받는 두 번째 문이었다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/update-user',
      headers: withSession(cookie),
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM "user" WHERE id = $1`,
      [userId],
    );
    expect(rows[0]?.display_name).toBe('김지민');
  });
});

describe('비밀번호 바꾸기 — /api/auth/change-password', () => {
  it('지금 비밀번호가 틀리면 바뀌지 않는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: withSession(cookie),
      payload: { currentPassword: 'not-the-password', newPassword: NEXT_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as Record<string, unknown>)['code']).toBe('INVALID_PASSWORD');
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  it('맞히면 바뀌고, 다른 세션을 끊으면 이 브라우저만 남는다', async () => {
    const other = (await signIn(PASSWORD)).cookie;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: withSession(cookie),
      payload: { currentPassword: PASSWORD, newPassword: NEXT_PASSWORD, revokeOtherSessions: true },
    });
    expect(res.statusCode).toBe(200);
    // 이 브라우저는 새 쿠키를 받는다 — 옛 세션도 끊긴 것들 중 하나다
    const setCookie = res.headers['set-cookie'];
    const renewed = (
      Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '')
    ).split(';')[0];
    expect(renewed).toContain('better-auth.session_token=');
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: renewed ?? '' },
    });
    expect(mine.statusCode).toBe(200);
    const theirs = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: other },
    });
    expect(theirs.statusCode).toBe(401);

    expect((await signIn(PASSWORD)).status).toBeGreaterThanOrEqual(400);
    expect((await signIn(NEXT_PASSWORD)).status).toBe(200);
  });
});
