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

/**
 * 로그인된 기기 (2026-09-28 · 사람 요청 · EP-AUTH-03~05 · REQ-API-243 · 244).
 *
 * 내 로그인 세션을 보고 끊는다. 인증 스택의 `list-sessions` 는 세션 토큰까지 돌려줘서 쓰지 않는다 — 목록에 토큰이
 * 없는지도 본다. 접속 주소는 접근 로그와 같은 규칙이다: 예전에는 `X-Forwarded-For` 가 두 칸이면(프록시를 지난
 * 운영) 주소를 못 찾아 비었다. 여기서는 신뢰 프록시(사설 대역)를 오른쪽부터 건너뛴 첫 주소가 저장되는지 본다.
 */
describe('로그인된 기기 — EP-AUTH-03~05 (REQ-API-243 · 244)', () => {
  async function signInFrom(chain: string, agent: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': chain,
        'user-agent': agent,
      },
      payload: { email: EMAIL, password: NEXT_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    return (
      (Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '')).split(';')[0] ?? ''
    );
  }
  type Row = {
    id: string;
    current: boolean;
    ip_address: string | null;
    user_agent: string | null;
  };
  async function list(value: string): Promise<Row[]> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/sessions',
      headers: { cookie: value },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { items: Row[] }).items;
  }
  /** 본문 없는 쓰기 — content-type 을 싣지 않는다(빈 JSON 본문은 400 이다) */
  const noBody = (value: string): Record<string, string> => ({
    cookie: value,
    origin: DEFAULT_ORIGIN,
  });
  const alive = async (value: string): Promise<number> =>
    (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: value } })).statusCode;

  it('내 로그인을 기기 · 주소와 함께 보이고, 지금 쓰는 것을 표시한다 — 토큰은 주지 않는다', async () => {
    const mine = await signInFrom(
      '198.51.100.10, 10.42.0.5',
      'Mozilla/5.0 (Macintosh) Chrome/131.0',
    );
    await signInFrom('203.0.113.20, 10.42.0.6', 'Mozilla/5.0 (iPhone) Safari/18.0');
    const items = await list(mine);
    const current = items.filter((r) => r.current);
    expect(current).toHaveLength(1);
    // 프록시를 지난 두 칸짜리 주소에서도 클라이언트 주소가 남는다(REQ-API-244)
    expect(current[0]?.ip_address).toBe('198.51.100.10');
    expect(items.some((r) => r.ip_address === '203.0.113.20' && !r.current)).toBe(true);
    expect(items.some((r) => r.user_agent?.includes('iPhone'))).toBe(true);
    expect(JSON.stringify(items)).not.toContain('token');
  });

  it('주소를 못 찾은 로그인은 빈 문자열이 아니라 null 이다 — 화면이 "알 수 없음" 을 적는다', async () => {
    // 인증 스택은 주소를 못 찾으면 빈 문자열을 저장한다. 테스트 환경에서는 대신 127.0.0.1 을 채워서
    // 그 상태를 요청으로 만들 수 없다 — 행을 그 모양으로 바꿔 둔다(E2E 스택에서 실제로 본 값이다)
    const mine = await signInFrom(
      '198.51.100.13, 10.42.0.5',
      'Mozilla/5.0 (Macintosh) Chrome/131.0',
    );
    const me = (await list(mine)).find((r) => r.current)!;
    await pool.query(`UPDATE auth_session SET ip_address = '', user_agent = '' WHERE id = $1`, [
      me.id,
    ]);
    const after = (await list(mine)).find((r) => r.current)!;
    expect(after.ip_address).toBeNull();
    expect(after.user_agent).toBeNull();
  });

  it('다른 기기 하나를 끊으면 그 기기만 로그아웃된다 — 지금 쓰는 로그인은 여기서 끊지 않는다', async () => {
    const mine = await signInFrom(
      '198.51.100.11, 10.42.0.5',
      'Mozilla/5.0 (Macintosh) Firefox/131.0',
    );
    const other = await signInFrom('203.0.113.21, 10.42.0.6', 'Mozilla/5.0 (Android) Chrome/131.0');
    const items = await list(mine);
    const me = items.find((r) => r.current)!;
    const phone = items.find((r) => r.user_agent?.includes('Android'))!;

    const self = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/sessions/${me.id}`,
      headers: noBody(mine),
    });
    expect(self.statusCode).toBe(409);
    expect((self.json() as { details: { kind: string } }).details.kind).toBe('current_session');

    const cut = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/sessions/${phone.id}`,
      headers: noBody(mine),
    });
    expect(cut.statusCode).toBe(200);
    expect(await alive(other)).toBe(401);
    expect(await alive(mine)).toBe(200);

    // 없는 id · UUID 가 아닌 값은 같은 "없음" 이다
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/sessions/not-a-uuid',
      headers: noBody(mine),
    });
    expect(missing.statusCode).toBe(409);
  });

  it('다른 기기 로그인을 모두 끊으면 지금 쓰는 로그인만 남는다', async () => {
    const mine = await signInFrom('198.51.100.12, 10.42.0.5', 'Mozilla/5.0 (Windows) Edge/131.0');
    const a = await signInFrom('203.0.113.22, 10.42.0.6', 'Mozilla/5.0 (iPad) Safari/18.0');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/sessions/revoke-others',
      headers: noBody(mine),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
    expect(await alive(a)).toBe(401);
    expect(await alive(mine)).toBe(200);
    expect(await list(mine)).toHaveLength(1);
  });

  it('에이전트 토큰으로는 보지도 끊지도 못한다 (D-08)', async () => {
    const pat = (
      await app
        .get(AuthService)
        .issueToken({ projectId, userId, name: 'agent-sessions', scopes: ['spec:read'] })
    ).token;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/sessions',
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);
  });
});
