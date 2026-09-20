// 공개 주소 분리 2단계 — CORS 허용목록과 세션 쿠키의 Domain (REQ-CB-041 · REQ-CB-042)
//
// **개발 루프에서는 이 경로가 한 번도 돌지 않는다.** compose 는 앞문 하나가 화면과 API 를
// 함께 서빙하고(4.1 §2.3 이 그 대가를 명시한다), 같은 오리진에서는 프리플라이트가 일어나지
// 않는다. 그래서 여기서 **브라우저 없이** 그 둘을 직접 센다 — 프리플라이트 응답 헤더와
// `Set-Cookie` 의 `Domain` 이다.
//
// 스위트가 지키는 것은 "같은 목록" 이다. CORS 와 better-auth 가 다른 목록을 보면 증상이
// 사람을 엉뚱한 곳으로 보낸다 — 로그인은 되는데 그 다음 요청이 전부 막히거나 그 반대다.
// 그래서 **화면 오리진으로 로그인까지 태운다**: 헤더만 세면 목록이 둘인 것을 못 잡는다.

import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { assertCookieDomain } from '../../src/common/origins.js';
import { createBetterAuth } from '../../src/modules/auth/better-auth.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const WEB = 'https://app.nerv.test.example.com';
const API = 'https://api.nerv.test.example.com';
const COOKIE_DOMAIN = 'nerv.test.example.com';
const OTHER = 'https://studio.test.example.com';
const EVIL = 'https://evil.example.com';

const EMAIL = 'jimin@example.com';
const PASSWORD = 'nerv-dev-password';

let db: ScratchDb;

beforeAll(async () => {
  db = await createScratchDb('nerv_cors');
  await runMigrations(db.url);
  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  process.env['NERV_WEB_URL'] = WEB;
  process.env['NERV_API_URL'] = API;
  process.env['NERV_TRUSTED_ORIGINS'] = OTHER;
});

afterAll(async () => {
  await db.drop();
  delete process.env['NERV_WEB_URL'];
  delete process.env['NERV_API_URL'];
  delete process.env['NERV_TRUSTED_ORIGINS'];
  delete process.env['NERV_COOKIE_DOMAIN'];
});

/** 기동 때 env 를 읽는 자리가 둘(CORS 허용목록·쿠키 도메인)이라 스위트마다 다시 띄운다. */
async function boot(): Promise<NestFastifyApplication> {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** 프리플라이트 — 브라우저가 본 요청 전에 보내는 그 요청이다. */
function preflight(
  app: NestFastifyApplication,
  origin: string,
  headers = 'content-type,idempotency-key',
): Promise<{ statusCode: number; headers: Record<string, unknown> }> {
  return app.inject({
    method: 'OPTIONS',
    url: '/api/v1/projects/clemvion/specs',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': headers,
    },
  });
}

/** `Set-Cookie` 는 여러 줄일 수 있다 — 세션 쿠키 한 줄을 고른다. */
function sessionCookie(raw: string | string[] | undefined): string {
  const lines = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return lines.find((line) => line.includes('session_token')) ?? '';
}

describe('CORS 허용목록 — 코드가 추측하지 않는다 (REQ-CB-041)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    delete process.env['NERV_COOKIE_DOMAIN'];
    app = await boot();
  });
  afterAll(async () => {
    await app.close();
  });

  it('화면 오리진의 프리플라이트를 허용한다 — `NERV_WEB_URL` 이 목록에 자동으로 든다', async () => {
    const res = await preflight(app, WEB);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    // 세션 쿠키를 싣는 요청이라 이 헤더가 없으면 브라우저가 응답을 버린다
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('**와일드카드가 아니다** — `credentials: true` 와 `*` 는 함께 설 수 없다', async () => {
    const res = await preflight(app, WEB);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    // 오리진마다 답이 다르므로 캐시가 오리진을 키에 넣어야 한다
    expect(String(res.headers['vary'])).toContain('Origin');
  });

  it('화면이 싣는 헤더 둘이 프리플라이트를 통과한다 — 목록에 없으면 요청이 서버에 닿지 않는다', async () => {
    const res = await preflight(app, WEB);
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
    expect(allowed).toContain('idempotency-key'); // 상태를 바꾸는 요청(api.md §1.5)
    expect(allowed).toContain('x-nerv-org'); // 같은 slug 한정자(REQ-API-152)
    expect(String(res.headers['access-control-allow-methods'])).toContain('PATCH');
  });

  it('`NERV_TRUSTED_ORIGINS` 의 오리진도 같은 목록이다', async () => {
    const res = await preflight(app, OTHER);
    expect(res.headers['access-control-allow-origin']).toBe(OTHER);
  });

  it('**목록 밖 오리진에는 헤더를 붙이지 않는다** — 막는 것은 브라우저의 몫이다', async () => {
    const res = await preflight(app, EVIL);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    // 5xx 로 답하지 않는다 — "서버가 고장났다" 로 읽힌다. 고장난 것은 부르는 쪽의 오리진이다
    expect(res.statusCode).toBeLessThan(500);
  });

  it('API 자기 오리진은 목록에 없다 — 자기 자신에게 보내는 요청은 CORS 가 아니다', async () => {
    const res = await preflight(app, API);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('**`Origin` 없는 요청은 그대로 통과한다** — 여기서 막으면 브라우저가 아니라 CLI 가 죽는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('본 요청에도 헤더가 붙는다 — 프리플라이트만 통과하면 응답을 읽지 못한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: WEB } });
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('화면이 읽어야 하는 응답 헤더를 노출한다 — 적지 않으면 JS 에서 보이지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: WEB } });
    const exposed = String(res.headers['access-control-expose-headers']).toLowerCase();
    expect(exposed).toContain('retry-after'); // 429 의 대기 시간(§1.8)
    expect(exposed).toContain('idempotency-replayed'); // 멱등 재생 표시(§1.5)
  });

  it('**better-auth 가 같은 목록을 본다** — 화면 오리진의 로그인이 통과한다', async () => {
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json', origin: WEB },
      payload: { email: EMAIL, password: PASSWORD, name: '지민' },
    });
    expect(signUp.statusCode).toBe(200);
  });

  /**
   * **이 검사가 서려면 라이브러리의 테스트 모드를 꺼야 했다**(2026-09-20 실측 ·
   * better-auth 1.7.1): 옵션을 비워 두면 `isTest()` 일 때 오리진 검증을 스스로 끈다.
   * 운영에서는 켜져 있으니 동작은 같지만, 그 상태로는 **L2 가 방어선을 끈 채 초록을 본다.**
   * `disableOriginCheck: false` 를 명시한 이유이고, 그래서 여기서 셀 수 있다.
   */
  it('목록 밖 오리진의 로그인은 거절된다 — CSRF 방어선은 헤더가 아니라 목록이다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: EVIL },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(sessionCookie(res.headers['set-cookie'] as string | string[] | undefined)).toBe('');
  });

  it('쿠키를 실은 요청도 오리진으로 거절된다 — 남의 탭이 보내는 요청이 그 모양이다', async () => {
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: WEB },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
    const cookie = sessionCookie(signIn.headers['set-cookie'] as string | string[] | undefined);
    expect(cookie).not.toBe('');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: {
        'content-type': 'application/json',
        origin: EVIL,
        cookie: cookie.split(';')[0] ?? '',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('**비우면 호스트 전용 쿠키다** — 지금까지의 동작이 그것이고 기본값이 그것이다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: WEB },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = sessionCookie(res.headers['set-cookie'] as string | string[] | undefined);
    expect(cookie).not.toBe('');
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });
});

describe('세션 쿠키의 Domain — NERV_COOKIE_DOMAIN (REQ-CB-042)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // 앞의 점은 값의 일부가 아니다 — 전표에 어느 모양으로 적히든 한 모양으로 읽는지 함께 센다
    process.env['NERV_COOKIE_DOMAIN'] = `.${COOKIE_DOMAIN}`;
    app = await boot();
  });
  afterAll(async () => {
    await app.close();
    delete process.env['NERV_COOKIE_DOMAIN'];
  });

  it('로그인 쿠키가 **상위 도메인**으로 선다 — 같은 도메인 아래의 화면이 같은 세션을 쓴다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: WEB },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);

    const cookie = sessionCookie(res.headers['set-cookie'] as string | string[] | undefined);
    expect(cookie.toLowerCase()).toContain(`domain=${COOKIE_DOMAIN}`);
  });

  it('`SameSite=Lax` 와 `HttpOnly` 는 그대로다 — 도메인을 넓히는 것이 방어선을 내리는 것은 아니다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: WEB },
      payload: { email: EMAIL, password: PASSWORD },
    });
    const cookie = sessionCookie(res.headers['set-cookie'] as string | string[] | undefined);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    // https 배치라 Secure 도 함께 선다(better-auth 는 baseURL 의 스킴을 본다)
    expect(cookie.toLowerCase()).toContain('secure');
  });
});

describe('틀린 쿠키 도메인 — 기동을 거부한다 (REQ-CB-042)', () => {
  /**
   * **여기서 앱을 띄우지 않는 이유**(2026-09-20 실측): `NestFactory` 의 기본값이
   * `abortOnError: true` 라, 초기화 중의 예외는 예외로 돌아오지 않고 **프로세스를
   * abort 시킨다** — 테스트 러너째로 죽어 아무것도 세지 못했다. 그래서 엔트리는
   * `assertCookieDomain()` 으로 Nest 보다 먼저 보고(main.ts·worker.ts), 여기서는
   * 앱이 실제로 이 값을 읽는 자리(better-auth 생성)를 그대로 태운다.
   */
  it('**두 호스트의 상위가 아니면 뜨지 않는다** — 브라우저는 그 쿠키를 조용히 버린다', async () => {
    const pool = new pg.Pool({ connectionString: db.url });
    process.env['NERV_COOKIE_DOMAIN'] = 'other.example.com';
    try {
      expect(() => createBetterAuth(pool)).toThrow(/기동을 거부/);
      expect(() => assertCookieDomain()).toThrow(/기동을 거부/);
    } finally {
      delete process.env['NERV_COOKIE_DOMAIN'];
      await pool.end();
    }
  });
});
