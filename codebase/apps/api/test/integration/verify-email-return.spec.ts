// 확인 메일의 링크가 사람을 어디로 돌려보내는가 — REQ-WEB-089 · REQ-WEB-188 (2026-09-24 사람 보고)
//
// better-auth 는 가입 요청의 `callbackURL` 을 자기 확인 링크에 실어 `sendVerificationEmail` 로
// 넘긴다. 우리는 그 링크를 **새로 만들어** 메일에 박는데(API 호스트 · 화면 주소 둘), 그러면서
// 요청의 값을 버리고 늘 화면의 첫 주소를 넣고 있었다. 초대로 가입한 사람은 초대 화면이 아니라
// 홈에 떨어졌다. L1(`verify-link.spec.ts`)은 링크를 만드는 함수를 보고, 여기서는 **실제
// better-auth 가 그 값을 넘겨주는가** — 라이브러리의 모양에 기댄 자리라 실물로만 판정한다.

import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const WEB = 'http://web.nerv.test';
const PASSWORD = 'nerv-dev-password';
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

  db = await createScratchDb('nerv_verifyreturn');
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

/** 가입하고, 줄 선 확인 메일의 링크가 돌려보낼 주소를 꺼낸다 */
async function signUpReturn(email: string, callbackURL?: string): Promise<string | null> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json', origin: WEB },
    payload: {
      email,
      password: PASSWORD,
      name: '처음',
      ...(callbackURL === undefined ? {} : { callbackURL }),
    },
  });
  expect(res.statusCode).toBe(200);
  const { rows } = await pool.query<{ body_text: string }>(
    `SELECT body_text FROM email_outbox WHERE kind = 'verify_email' AND to_email = $1`,
    [email],
  );
  expect(rows).toHaveLength(1);
  const link = /https?:\/\/\S+verify-email\?\S+/.exec(rows[0]?.body_text ?? '')?.[0];
  return link === undefined ? null : new URL(link).searchParams.get('callbackURL');
}

describe('확인 메일의 링크는 가입 요청이 정한 화면으로 돌려보낸다', () => {
  it('초대에서 왔으면 그 초대로 (REQ-WEB-089)', async () => {
    expect(await signUpReturn('invited@example.com', `${WEB}/invite/abc`)).toBe(
      `${WEB}/invite/abc`,
    );
  });

  it('그냥 가입했으면 온보딩으로 (REQ-WEB-188)', async () => {
    expect(await signUpReturn('first@example.com', `${WEB}/onboarding`)).toBe(`${WEB}/onboarding`);
  });

  it('정한 것이 없으면 화면의 첫 주소 — 거기서 소속을 보고 가른다', async () => {
    expect(await signUpReturn('plain@example.com')).toBe(`${WEB}/`);
  });
});
