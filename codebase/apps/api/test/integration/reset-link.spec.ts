// 운영자 비밀번호 재설정 링크 — 메일을 보내지 않는 배치 (2026-10-15 · 사람 결정 · codebase.md §5.2 · REQ-CB-061)
//
// 메일이 꺼진 배치에서 비밀번호를 잊은 사람은 "서버 운영자에게 문의" 에서 멈췄다(api.md REQ-API-187). 운영자 명령
// (`node dist/reset-link.js <이메일>`)이 인증 스택과 같은 검증 행을 만들고 링크를 내놓는다. 이 파일이 지키는 것:
// 메일이 꺼져 있어도 그 링크로 재설정이 된다 · 링크는 한 번뿐이다 · 재설정하면 모든 세션이 끊긴다 · 없는 이메일이면
// 0 이 아닌 코드로 끝난다. 인증 스택의 재설정 문을 그대로 지나는지가 요점이라 실물로만 판정한다.

import { PASSWORD_RESET_TTL_MINUTES } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { issueResetLink } from '../../src/modules/auth/operator-reset.js';
import { runResetLink } from '../../src/reset-link.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const WEB = 'http://web.nerv.test';
const PASSWORD = 'first-password';
const NEXT_PASSWORD = 'operator-reset-password';
const KEYS = ['NERV_MAIL_HOST', 'NERV_WEB_URL', 'NERV_REQUIRE_EMAIL_VERIFICATION'];

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of KEYS) saved[key] = process.env[key];
  // 메일이 꺼진 배치 — 이 명령이 있는 까닭이다. 인증 강제도 메일에서 유도되어 꺼진다
  delete process.env['NERV_MAIL_HOST'];
  delete process.env['NERV_REQUIRE_EMAIL_VERIFICATION'];
  process.env['NERV_WEB_URL'] = WEB;

  db = await createScratchDb('nerv_resetlink');
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

function browser(ip: string, cookie?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: WEB,
    'x-forwarded-for': ip,
    ...(cookie === undefined ? {} : { cookie }),
  };
}

async function signUp(email: string, ip: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: browser(ip),
    payload: { email, password: PASSWORD, name: '서연' },
  });
  expect(res.statusCode).toBe(200);
}

async function signIn(email: string, password: string, ip: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: browser(ip),
    payload: { email, password },
  });
  if (res.statusCode !== 200) return '';
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  return raw.split(';')[0] ?? '';
}

async function meStatus(cookie: string): Promise<number> {
  return (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode;
}

/** 링크에서 토큰과 돌아갈 자리를 꺼낸다 — 메일로 보내는 링크와 같은 모양이어야 한다 */
function parseLink(url: string): { path: string; token: string; callback: string } {
  const link = new URL(url);
  const token = decodeURIComponent(link.pathname.split('/').pop() ?? '');
  return { path: link.pathname, token, callback: link.searchParams.get('callbackURL') ?? '' };
}

function resetWith(token: string, ip: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/reset-password',
    headers: browser(ip),
    payload: { newPassword: NEXT_PASSWORD, token },
  });
}

describe('메일이 꺼진 배치에서 운영자가 링크를 발급한다 (REQ-CB-061)', () => {
  it('메일 요청은 거절되는 배치다 — 그래서 이 명령이 있다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: browser('198.51.100.30'),
      payload: { email: 'anyone@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as Record<string, unknown>)['code']).toBe('RESET_PASSWORD_DISABLED');
  });

  it('발급한 링크로 비밀번호를 정하면 모든 세션이 끊기고, 같은 링크는 두 번 쓰이지 않는다', async () => {
    const ip = '198.51.100.31';
    await signUp('seoyeon@example.com', ip);
    const before = await signIn('seoyeon@example.com', PASSWORD, ip);
    expect(await meStatus(before)).toBe(200);

    // 대소문자 · 앞뒤 공백은 가리지 않는다 — 운영자가 받아 적은 그대로 넣는다
    const issued = await issueResetLink(pool, '  SeoYeon@Example.com ');
    expect(issued).not.toBeNull();
    const link = parseLink(issued!.url);
    expect(link.path).toBe(`/api/auth/reset-password/${encodeURIComponent(link.token)}`);
    expect(link.callback).toBe(`${WEB}/reset-password`);
    const { rows } = await pool.query<{ minutes: number; value: string }>(
      `SELECT round(extract(epoch FROM expires_at - now()) / 60)::int AS minutes, value
         FROM auth_verification WHERE identifier = $1`,
      [`reset-password:${link.token}`],
    );
    expect(rows[0]).toEqual({ minutes: PASSWORD_RESET_TTL_MINUTES, value: issued!.userId });

    // 링크를 열면 메일로 받은 링크와 똑같이 화면으로 간다 — 토큰은 닳지 않는다
    const open = await app.inject({
      method: 'GET',
      url: `/api/auth/reset-password/${encodeURIComponent(link.token)}?callbackURL=${encodeURIComponent(link.callback)}`,
    });
    expect(open.statusCode).toBe(302);
    expect(open.headers['location']).toBe(`${WEB}/reset-password?token=${link.token}`);

    const ok = await resetWith(link.token, ip);
    expect(ok.statusCode).toBe(200);
    expect(await meStatus(before)).toBe(401);
    expect(await signIn('seoyeon@example.com', PASSWORD, ip)).toBe('');
    expect(await meStatus(await signIn('seoyeon@example.com', NEXT_PASSWORD, ip))).toBe(200);

    const again = await resetWith(link.token, ip);
    expect(again.statusCode).toBe(400);
    expect((again.json() as Record<string, unknown>)['code']).toBe('INVALID_TOKEN');
  });

  it('명령은 링크를 마지막 줄로 내고 0 으로 끝난다 — 없는 이메일은 1, 이메일이 없으면 2 다', async () => {
    await signUp('dohyun@example.com', '198.51.100.32');
    const env = { DATABASE_URL: db.url };
    const lines: string[] = [];
    expect(await runResetLink(['dohyun@example.com'], env, (line) => lines.push(line))).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^https?:\/\/\S+\/api\/auth\/reset-password\/\S+\?callbackURL=\S+\n$/);

    const none: string[] = [];
    expect(await runResetLink(['nobody@example.com'], env, (line) => none.push(line))).toBe(1);
    expect(none).toEqual([]);
    expect(await runResetLink([], env, (line) => none.push(line))).toBe(2);
    expect(await runResetLink(['dohyun@example.com'], {}, (line) => none.push(line))).toBe(1);
    expect(none).toEqual([]);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_verification v JOIN "user" u ON u.id::text = v.value
        WHERE u.email = 'dohyun@example.com' AND v.identifier LIKE 'reset-password:%'`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});
