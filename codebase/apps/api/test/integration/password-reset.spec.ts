// 비밀번호를 잊었을 때 — 메일로 재설정 (2026-09-25 — 사람 결정 D10 · UI/UX 검토 SET-13 · REQ-API-187)
//
// 내 계정(REQ-API-186)은 **지금 비밀번호를 아는 사람**의 문이었다. 잊은 사람에게는 길이 없었다 — 인증 스택은
// `/request-password-reset` 을 열어 두고 있었지만 보낼 곳(`sendResetPassword`)이 없어 늘 400 이었다.
// 이 파일이 지키는 것: 재설정 메일이 줄을 서고 · 없는 주소에도 같은 답을 하며 · 링크는 API 를 거쳐 화면으로 가고 ·
// 새 비밀번호를 정하면 옛 비밀번호와 **모든** 세션이 끝나며 · 링크는 한 번뿐이고 · 메일이 꺼진 배치는 켜지 않는다.
// 라이브러리의 모양에 기댄 자리라 실물로만 판정한다(`verify-email-return.spec.ts` 와 같은 까닭).

import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { apiUrlFromEnv } from '../../src/common/origins.js';
import { createBetterAuth } from '../../src/modules/auth/better-auth.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const WEB = 'http://web.nerv.test';
const PASSWORD = 'first-password';
const NEXT_PASSWORD = 'second-password';
/** 이 스위트가 바꾸는 env — 끝나면 원래 값으로 되돌린다(다른 스위트가 같은 프로세스를 쓴다) */
const KEYS = [
  'NERV_MAIL_HOST',
  'NERV_MAIL_FROM',
  'NERV_WEB_URL',
  'NERV_REQUIRE_EMAIL_VERIFICATION',
];

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of KEYS) saved[key] = process.env[key];
  // 메일이 켜진 배치 — 인증 강제는 메일에서 유도된다(mail.config.ts)
  process.env['NERV_MAIL_HOST'] = 'mailpit';
  process.env['NERV_MAIL_FROM'] = 'NERV <no-reply@example.com>';
  process.env['NERV_WEB_URL'] = WEB;
  delete process.env['NERV_REQUIRE_EMAIL_VERIFICATION'];

  db = await createScratchDb('nerv_pwreset');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_outbox');
});

/** 브라우저가 싣는 것 — 오리진(REQ-CB-041)과 화면의 언어 */
function browser(locale = 'ko'): Record<string, string> {
  return { 'content-type': 'application/json', origin: WEB, 'accept-language': locale };
}

async function signUp(email: string, locale = 'ko'): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: browser(locale),
    payload: { email, password: PASSWORD, name: '지민' },
  });
  expect(res.statusCode).toBe(200);
}

async function signIn(
  email: string,
  password: string,
): Promise<{ status: number; cookie: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: browser(),
    payload: { email, password },
  });
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  return { status: res.statusCode, cookie: raw.split(';')[0] ?? '' };
}

async function requestReset(email: string, locale = 'ko') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/request-password-reset',
    headers: browser(locale),
    payload: { email },
  });
}

/** 줄 선 재설정 메일 — 링크의 토큰과 돌아갈 자리를 꺼낸다 */
async function resetMail(email: string): Promise<{
  locale: string;
  subject: string;
  body: string;
  token: string;
  callback: string;
}> {
  const { rows } = await pool.query<{ locale: string; subject: string; body_text: string }>(
    `SELECT locale, subject, body_text FROM email_outbox
      WHERE kind = 'reset_password' AND to_email = $1`,
    [email],
  );
  expect(rows).toHaveLength(1);
  const body = rows[0]!.body_text;
  const link = /\/api\/auth\/reset-password\/([^?\s]+)\?callbackURL=(\S+)/.exec(body);
  expect(link, '메일에 재설정 링크가 있어야 한다').not.toBeNull();
  return {
    locale: rows[0]!.locale,
    subject: rows[0]!.subject,
    body,
    token: decodeURIComponent(link![1]!),
    callback: decodeURIComponent(link![2]!),
  };
}

async function markVerified(email: string): Promise<void> {
  await pool.query(`UPDATE "user" SET email_verified = true WHERE email = $1`, [email]);
}

// **맨 앞에 둔다.** 인증 스택의 요청 한도 카운터는 모듈 전역이라(메모리 저장소) 이 파일의 앱과 아래에서 따로 만든
// 인스턴스가 같은 IP·경로 칸을 나눠 센다 — 뒤에 두면 앞선 검사의 요청 수에 따라 429 가 끼어든다(2026-09-25 실측).
describe('메일이 꺼진 배치', () => {
  it('재설정을 켜지 않는다 — 오지 않을 메일을 기다리게 하지 않고 RESET_PASSWORD_DISABLED 로 답한다', async () => {
    const host = process.env['NERV_MAIL_HOST'];
    delete process.env['NERV_MAIL_HOST'];
    const calls: string[] = [];
    try {
      // 메일 쪽이 있어도 스위치는 메일 호스트다 — 넣을 곳이 있다고 켜지 않는다
      const auth = createBetterAuth(pool, {
        enqueueVerifyEmail: async () => false,
        enqueueResetPassword: async ({ email }) => {
          calls.push(email);
          return false;
        },
      });
      const res = await auth.handler(
        new Request(`${apiUrlFromEnv().replace(/\/+$/, '')}/api/auth/request-password-reset`, {
          method: 'POST',
          headers: browser(),
          body: JSON.stringify({ email: 'reset-en@example.com' }),
        }),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as Record<string, unknown>)['code']).toBe(
        'RESET_PASSWORD_DISABLED',
      );
      expect(calls).toEqual([]);
    } finally {
      process.env['NERV_MAIL_HOST'] = host;
    }
  });
});

describe('재설정 메일 — /api/auth/request-password-reset (REQ-API-187)', () => {
  it('있는 계정이면 메일이 줄을 선다 — 요청한 화면의 언어로, 링크는 API 를 거쳐 화면의 /reset-password 로', async () => {
    const email = 'reset-en@example.com';
    await signUp(email);
    const res = await requestReset(email, 'en,ko;q=0.8');
    expect(res.statusCode).toBe(200);
    const mail = await resetMail(email);
    expect(mail.locale).toBe('en');
    expect(mail.subject).toBe('[NERV] Link to set a new password');
    // 수명은 상수에서 온다 — 본문이 말하는 숫자와 토큰의 실제 수명이 같아야 한다
    expect(mail.body).toContain('60 minutes');
    expect(mail.callback).toBe(`${WEB}/reset-password`);
    const { rows } = await pool.query<{ minutes: number }>(
      `SELECT round(extract(epoch FROM expires_at - now()) / 60)::int AS minutes
         FROM auth_verification WHERE identifier = $1`,
      [`reset-password:${mail.token}`],
    );
    expect(rows[0]?.minutes).toBe(60);
  });

  it('없는 주소에도 같은 답을 하고, 아무것도 줄 세우지 않는다 — 계정 존재 확인기가 되지 않는다', async () => {
    const email = 'reset-same@example.com';
    await signUp(email);
    const known = await requestReset(email);
    const unknown = await requestReset('nobody@example.com');
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM email_outbox WHERE to_email = 'nobody@example.com'`,
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe('링크를 열면 — GET /api/auth/reset-password/<토큰>', () => {
  it('토큰을 쓰지 않고 화면으로 보낸다 — 살아 있으면 token, 아니면 error', async () => {
    const email = 'reset-open@example.com';
    await signUp(email);
    await requestReset(email);
    const { token, callback } = await resetMail(email);
    const open = (t: string) =>
      app.inject({
        method: 'GET',
        url: `/api/auth/reset-password/${encodeURIComponent(t)}?callbackURL=${encodeURIComponent(callback)}`,
      });
    // 두 번 열어도 같다 — 메일 보안 검사기가 미리 열어도 토큰은 닳지 않는다
    for (let i = 0; i < 2; i++) {
      const res = await open(token);
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toBe(`${WEB}/reset-password?token=${token}`);
    }
    const bad = await open('not-a-token');
    expect(res302(bad)).toBe(`${WEB}/reset-password?error=INVALID_TOKEN`);
  });
});

describe('새 비밀번호를 정하면 — POST /api/auth/reset-password', () => {
  it('옛 비밀번호와 모든 세션이 끝나고, 링크는 한 번뿐이다', async () => {
    const email = 'reset-set@example.com';
    await signUp(email);
    await markVerified(email);
    const before = await signIn(email, PASSWORD);
    expect(before.status).toBe(200);
    await requestReset(email);
    const { token } = await resetMail(email);

    // 짧은 비밀번호는 토큰을 닳게 하지 않는다 — 다시 치면 된다
    const short = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: browser(),
      payload: { newPassword: 'short', token },
    });
    expect(short.statusCode).toBe(400);
    expect((short.json() as Record<string, unknown>)['code']).toBe('PASSWORD_TOO_SHORT');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: browser(),
      payload: { newPassword: NEXT_PASSWORD, token },
    });
    expect(ok.statusCode).toBe(200);

    // "누가 내 비밀번호를 안다" 의 답이기도 하다 — 전에 들어와 있던 세션은 모두 끝난다
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: before.cookie },
    });
    expect(me.statusCode).toBe(401);
    expect((await signIn(email, PASSWORD)).status).toBeGreaterThanOrEqual(400);
    expect((await signIn(email, NEXT_PASSWORD)).status).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: browser(),
      payload: { newPassword: 'third-password', token },
    });
    expect(again.statusCode).toBe(400);
    expect((again.json() as Record<string, unknown>)['code']).toBe('INVALID_TOKEN');
  });

  it('확인하지 않은 계정도 재설정을 마치면 들어온다 — 링크를 연 메일함이 곧 증명이다', async () => {
    const email = 'reset-unverified@example.com';
    await signUp(email);
    const blocked = await signIn(email, PASSWORD);
    expect(blocked.status).toBe(403);
    await requestReset(email);
    const { token } = await resetMail(email);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: browser(),
      payload: { newPassword: NEXT_PASSWORD, token },
    });
    expect(ok.statusCode).toBe(200);
    expect((await signIn(email, NEXT_PASSWORD)).status).toBe(200);
  });
});

describe('메일의 언어', () => {
  it('가입 확인 메일도 가입한 화면의 언어로 나간다 — 전에는 언제나 한국어였다', async () => {
    const email = 'verify-en@example.com';
    await signUp(email, 'en');
    const { rows } = await pool.query<{ locale: string; subject: string }>(
      `SELECT locale, subject FROM email_outbox WHERE kind = 'verify_email' AND to_email = $1`,
      [email],
    );
    expect(rows[0]).toEqual({ locale: 'en', subject: '[NERV] Confirm your email address' });
  });
});

function res302(res: { statusCode: number; headers: Record<string, unknown> }): unknown {
  expect(res.statusCode).toBe(302);
  return res.headers['location'];
}
