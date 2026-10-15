// 이메일 바꾸기 — 옛 주소의 승인과 새 주소의 확인 (2026-10-15 · 사람 결정 · REQ-API-310 · REQ-API-186 개정)
//
// 인증 스택(better-auth 1.7.7)의 두 단계 흐름을 켜고, 그 흐름에 없는 보장을 훅이 메운다. 이 파일이 지키는 것:
// 메일이 꺼진 배치는 켜지 않는다 · 지금 비밀번호를 다시 묻는다 · 옛 주소가 승인하고 새 주소가 확인해야 바뀐다 · 링크는
// 한 번만 쓰인다 · 바뀌면 다른 로그인이 모두 끊기고 옛 주소로 알림이 간다 · 로그인하지 않은 브라우저에 세션을 남기지
// 않는다 · 사람마다 한도가 있다 · 이미 쓰는 주소에도 같은 답을 한다. 라이브러리의 모양에 기댄 자리라 실물로만 판정한다.

import { NERV_ERROR, RATE_LIMIT_SIGN_IN_PER_MIN, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { apiUrlFromEnv } from '../../src/common/origins.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createBetterAuth } from '../../src/modules/auth/better-auth.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const WEB = 'http://web.nerv.test';
const PASSWORD = 'first-password';
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
  process.env['NERV_MAIL_HOST'] = 'mailpit';
  process.env['NERV_MAIL_FROM'] = 'NERV <no-reply@example.com>';
  process.env['NERV_WEB_URL'] = WEB;
  delete process.env['NERV_REQUIRE_EMAIL_VERIFICATION'];

  db = await createScratchDb('nerv_emailchange');
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

/**
 * 브라우저가 싣는 것 — 오리진(REQ-CB-041)과 화면의 언어, 그리고 **검사마다 다른 주소**. 인증 스택의 IP 한도 카운터는
 * 모듈 전역이라(메모리) 같은 주소로 두면 앞선 검사의 요청 수에 따라 429 가 끼어든다(password-reset.spec 과 같은 까닭).
 */
function browser(ip: string, cookie?: string, locale = 'ko'): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: WEB,
    'accept-language': locale,
    'x-forwarded-for': ip,
    ...(cookie === undefined ? {} : { cookie }),
  };
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  return raw.split(';')[0] ?? '';
}

/** 가입하고 확인된 것으로 적은 뒤 로그인한다 — 로그인 쿠키를 돌려준다 */
async function verifiedUser(email: string, ip: string): Promise<{ id: string; cookie: string }> {
  const up = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: browser(ip),
    payload: { email, password: PASSWORD, name: '지민' },
  });
  expect(up.statusCode).toBe(200);
  await pool.query(`UPDATE "user" SET email_verified = true WHERE email = $1`, [email]);
  await pool.query('DELETE FROM email_outbox');
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
    email,
  ]);
  return { id: rows[0]!.id, cookie: await signIn(email, ip) };
}

async function signIn(email: string, ip: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: browser(ip),
    payload: { email, password },
  });
  return res.statusCode === 200 ? cookieOf(res) : '';
}

async function changeEmail(input: {
  cookie: string;
  ip: string;
  newEmail: string;
  password?: string;
  locale?: string;
}) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/change-email',
    headers: browser(input.ip, input.cookie, input.locale),
    payload: {
      newEmail: input.newEmail,
      ...(input.password === undefined ? {} : { password: input.password }),
    },
  });
}

/** 줄 선 메일 — 링크의 토큰과 돌아갈 자리를 꺼낸다 */
async function mailOf(
  kind: string,
  to: string,
): Promise<{ locale: string; subject: string; body: string; token: string; callback: string }> {
  const { rows } = await pool.query<{ locale: string; subject: string; body_text: string }>(
    `SELECT locale, subject, body_text FROM email_outbox WHERE kind = $1 AND to_email = $2`,
    [kind, to],
  );
  expect(rows, `${kind} → ${to}`).toHaveLength(1);
  const body = rows[0]!.body_text;
  const link = /\/api\/auth\/verify-email\?token=([^&\s]+)&callbackURL=(\S+)/.exec(body);
  return {
    locale: rows[0]!.locale,
    subject: rows[0]!.subject,
    body,
    token: link === null ? '' : decodeURIComponent(link[1]!),
    callback: link === null ? '' : decodeURIComponent(link[2]!),
  };
}

async function outboxCount(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM email_outbox`);
  return rows[0]!.n;
}

function openLink(token: string, callback: string, ip: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callback)}`,
    headers: {
      'x-forwarded-for': ip,
      'accept-language': 'ko',
      ...(cookie === undefined ? {} : { cookie }),
    },
  });
}

async function status(cookie: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/me/email-change',
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    mail_enabled: boolean;
    pending: { new_email: string; stage: string; expires_at: string } | null;
  };
}

async function meStatus(cookie: string): Promise<number> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  return res.statusCode;
}

async function emailOf(id: string): Promise<{ email: string; email_verified: boolean }> {
  const { rows } = await pool.query<{ email: string; email_verified: boolean }>(
    `SELECT email, email_verified FROM "user" WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

// **맨 앞에 둔다** — 따로 만든 인스턴스도 같은 모듈의 한도 카운터를 쓴다(password-reset.spec 과 같다)
describe('메일이 꺼진 배치', () => {
  it('이메일 바꾸기를 켜지 않는다 — CHANGE_EMAIL_DISABLED 로 거절하고, 진행 상태도 꺼짐을 말한다', async () => {
    const user = await verifiedUser('off@example.com', '198.51.100.1');
    const host = process.env['NERV_MAIL_HOST'];
    delete process.env['NERV_MAIL_HOST'];
    const calls: string[] = [];
    try {
      const auth = createBetterAuth(pool, {
        enqueueVerifyEmail: async () => false,
        enqueueResetPassword: async () => false,
        enqueueChangeEmailApprove: async ({ email }) => {
          calls.push(email);
          return false;
        },
        enqueueChangeEmailConfirm: async () => false,
        enqueueEmailChanged: async () => false,
      });
      const res = await auth.handler(
        new Request(`${apiUrlFromEnv().replace(/\/+$/, '')}/api/auth/change-email`, {
          method: 'POST',
          headers: browser('198.51.100.1', user.cookie),
          body: JSON.stringify({ newEmail: 'off-next@example.com', password: PASSWORD }),
        }),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as Record<string, unknown>)['code']).toBe('CHANGE_EMAIL_DISABLED');
      expect(calls).toEqual([]);
      // 화면은 양식 대신 운영자에게 문의하라고 적는다 — 그 판단은 이 값이다
      expect((await status(user.cookie)).mail_enabled).toBe(false);
    } finally {
      process.env['NERV_MAIL_HOST'] = host;
    }
    expect(await outboxCount()).toBe(0);
    expect((await emailOf(user.id)).email).toBe('off@example.com');
  });
});

describe('요청 — POST /api/auth/change-email', () => {
  it('지금 비밀번호가 틀리거나 없으면 거절하고 아무 메일도 보내지 않는다', async () => {
    const user = await verifiedUser('wrongpw@example.com', '198.51.100.2');
    for (const password of ['not-my-password', undefined]) {
      const res = await changeEmail({
        cookie: user.cookie,
        ip: '198.51.100.2',
        newEmail: 'wrongpw-next@example.com',
        ...(password === undefined ? {} : { password }),
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as Record<string, unknown>)['code']).toBe('INVALID_PASSWORD');
    }
    expect(await outboxCount()).toBe(0);
    expect((await status(user.cookie)).pending).toBeNull();
  });

  it('로그인하지 않았으면 401 이다', async () => {
    const res = await changeEmail({
      cookie: '',
      ip: '198.51.100.3',
      newEmail: 'nobody-next@example.com',
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(401);
  });

  it('이미 다른 계정이 쓰는 주소에도 같은 답을 하고, 진행 상태도 같은 모양이다 — 계정이 있는지 알려 주지 않는다', async () => {
    const ip = '198.51.100.4';
    const user = await verifiedUser('taken-a@example.com', ip);
    await verifiedUser('taken-b@example.com', ip);
    const fresh = await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'taken-free@example.com',
      password: PASSWORD,
    });
    const freshState = await status(user.cookie);
    const taken = await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'Taken-B@example.com',
      password: PASSWORD,
    });
    const takenState = await status(user.cookie);
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(taken.json()).toEqual(fresh.json());
    expect(freshState.pending).toMatchObject({
      new_email: 'taken-free@example.com',
      stage: 'approve',
    });
    expect(takenState.pending).toMatchObject({
      new_email: 'taken-b@example.com',
      stage: 'approve',
    });
    // 이미 쓰는 주소 쪽 요청은 메일을 보내지 않는다(인증 스택의 동작) — 앞 요청의 승인 메일 한 통뿐이다
    expect(await outboxCount()).toBe(1);
  });

  it(`사람마다 1분에 ${RATE_LIMIT_SIGN_IN_PER_MIN}번까지다 — 주소를 바꿔 가며 비밀번호를 맞혀 볼 수 없다`, async () => {
    const user = await verifiedUser('limit@example.com', '198.51.100.5');
    for (let i = 0; i < RATE_LIMIT_SIGN_IN_PER_MIN; i++) {
      const res = await changeEmail({
        cookie: user.cookie,
        ip: `203.0.113.${i + 1}`,
        newEmail: 'limit-next@example.com',
        password: 'guess-' + String(i),
      });
      expect(res.statusCode).toBe(400);
    }
    // 처음 보는 주소에서 와도, 맞는 비밀번호여도 이 사람의 한도는 찼다
    const over = await changeEmail({
      cookie: user.cookie,
      ip: '203.0.113.200',
      newEmail: 'limit-next@example.com',
      password: PASSWORD,
    });
    expect(over.statusCode).toBe(429);
    expect(await outboxCount()).toBe(0);
  });
});

describe('두 단계 — 옛 주소가 승인하고 새 주소가 확인한다', () => {
  it('승인 메일 → 확인 메일 → 바뀐다. 링크는 한 번뿐이고, 다른 로그인은 끊기며, 옛 주소로 알림이 간다', async () => {
    const ip = '198.51.100.6';
    const user = await verifiedUser('two-old@example.com', ip);
    const other = await signIn('two-old@example.com', ip);
    expect(await meStatus(other)).toBe(200);

    const req = await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'two-new@example.com',
      password: PASSWORD,
      locale: 'en,ko;q=0.8',
    });
    expect(req.statusCode).toBe(200);
    // 아직 바뀌지 않았다 — 옛 주소로 승인 메일이 갔을 뿐이다(요청한 화면의 언어로 · 두 주소를 함께 적는다)
    expect((await emailOf(user.id)).email).toBe('two-old@example.com');
    const approve = await mailOf('change_email_approve', 'two-old@example.com');
    expect(approve.locale).toBe('en');
    expect(approve.subject).toBe('[NERV] Approve your email address change');
    expect(approve.body).toContain('two-new@example.com');
    expect(approve.body).toContain('60 minutes');
    expect(approve.callback).toBe(`${WEB}/email-change?step=approved`);
    expect((await status(user.cookie)).pending).toMatchObject({
      new_email: 'two-new@example.com',
      stage: 'approve',
    });

    // 옛 주소의 승인 — 로그인하지 않은 브라우저에서 열어도 된다(세션을 만들지 않는다)
    const approved = await openLink(approve.token, approve.callback, ip);
    expect(approved.statusCode).toBe(302);
    expect(approved.headers['location']).toBe(`${WEB}/email-change?step=approved`);
    expect(cookieOf(approved)).not.toMatch(/session_token=[^;]+/);
    const confirm = await mailOf('change_email_confirm', 'two-new@example.com');
    expect(confirm.callback).toBe(`${WEB}/email-change?step=done`);
    expect((await status(user.cookie)).pending).toMatchObject({ stage: 'confirm' });

    // 승인 링크는 다시 쓰이지 않는다 — 인증 스택의 토큰은 60분 동안 몇 번이고 쓸 수 있는 JWT 다
    const again = await openLink(approve.token, approve.callback, ip);
    expect(again.headers['location']).toBe(`${WEB}/email-change?step=approved&error=INVALID_TOKEN`);
    expect((await emailOf(user.id)).email).toBe('two-old@example.com');

    // 새 주소의 확인 — 로그인하지 않은 브라우저다
    const done = await openLink(confirm.token, confirm.callback, ip);
    expect(done.statusCode).toBe(302);
    expect(done.headers['location']).toBe(`${WEB}/email-change?step=done`);
    expect(await emailOf(user.id)).toEqual({ email: 'two-new@example.com', email_verified: true });

    // 그 브라우저에 세션을 남기지 않는다 — 인증 스택이 만든 세션도 지웠고, 쿠키는 비우는 쪽이 마지막이다
    const { rows: sessions } = await pool.query(`SELECT id FROM auth_session WHERE user_id = $1`, [
      user.id,
    ]);
    expect(sessions).toEqual([]);
    const setCookies = ([] as string[]).concat(
      (done.headers['set-cookie'] as string[] | string | undefined) ?? [],
    );
    const tokenCookies = setCookies.filter((c) => c.includes('session_token='));
    expect(tokenCookies.at(-1)).toMatch(/session_token=;|Max-Age=0/);
    // 전에 들어와 있던 두 로그인도 끝났다
    expect(await meStatus(user.cookie)).toBe(401);
    expect(await meStatus(other)).toBe(401);

    // 옛 주소로 알림 — 무엇에서 무엇으로 바뀌었는지
    const notice = await mailOf('email_changed', 'two-old@example.com');
    expect(notice.body).toContain('two-new@example.com');
    expect(notice.token).toBe('');

    // 새 주소로 들어오고, 옛 주소로는 들어오지 못한다
    expect(await signIn('two-old@example.com', ip)).toBe('');
    const fresh = await signIn('two-new@example.com', ip);
    expect(await meStatus(fresh)).toBe(200);
    expect((await status(fresh)).pending).toBeNull();

    // 확인 링크도 다시 쓰이지 않는다
    const twice = await openLink(confirm.token, confirm.callback, ip);
    expect(String(twice.headers['location'])).toContain('error=');
    expect((await emailOf(user.id)).email).toBe('two-new@example.com');
  });

  it('새 주소의 링크를 그 사람이 로그인한 브라우저에서 열면 그 로그인만 남는다', async () => {
    const ip = '198.51.100.7';
    const user = await verifiedUser('keep-old@example.com', ip);
    const other = await signIn('keep-old@example.com', ip);
    await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'keep-new@example.com',
      password: PASSWORD,
    });
    const approve = await mailOf('change_email_approve', 'keep-old@example.com');
    await openLink(approve.token, approve.callback, ip, user.cookie);
    const confirm = await mailOf('change_email_confirm', 'keep-new@example.com');
    const done = await openLink(confirm.token, confirm.callback, ip, user.cookie);
    expect(done.headers['location']).toBe(`${WEB}/email-change?step=done`);
    expect(await meStatus(user.cookie)).toBe(200);
    expect(await meStatus(other)).toBe(401);
    const { rows } = await pool.query(`SELECT id FROM auth_session WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(1);
  });

  it('새로 요청하면 앞 요청의 링크는 쓸 수 없다 — 가장 새 요청 하나만 산다', async () => {
    const ip = '198.51.100.8';
    const user = await verifiedUser('swap-old@example.com', ip);
    await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'swap-a@example.com',
      password: PASSWORD,
    });
    const first = await mailOf('change_email_approve', 'swap-old@example.com');
    await pool.query('DELETE FROM email_outbox');
    await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'swap-b@example.com',
      password: PASSWORD,
    });
    const stale = await openLink(first.token, first.callback, ip);
    expect(stale.headers['location']).toBe(`${WEB}/email-change?step=approved&error=INVALID_TOKEN`);
    expect(await outboxCount()).toBe(1);
    expect((await status(user.cookie)).pending).toMatchObject({ new_email: 'swap-b@example.com' });
  });

  it('승인한 사이 새 주소를 다른 계정이 차지했으면 끝까지 가지 않는다 — 500 이 아니라 쓸 수 없는 링크다', async () => {
    const ip = '198.51.100.9';
    const user = await verifiedUser('race-old@example.com', ip);
    await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'race-new@example.com',
      password: PASSWORD,
    });
    const approve = await mailOf('change_email_approve', 'race-old@example.com');
    await openLink(approve.token, approve.callback, ip);
    const confirm = await mailOf('change_email_confirm', 'race-new@example.com');
    await verifiedUser('race-new@example.com', ip);
    const done = await openLink(confirm.token, confirm.callback, ip);
    expect(done.statusCode).toBe(302);
    expect(done.headers['location']).toBe(`${WEB}/email-change?step=done&error=INVALID_TOKEN`);
    expect((await emailOf(user.id)).email).toBe('race-old@example.com');
    expect((await status(user.cookie)).pending).toBeNull();
  });

  it('에이전트 토큰은 사용자에 묶여 있어 바뀐 뒤에도 그대로 쓰이고, 진행 상태는 읽지 못한다 (D-08)', async () => {
    const ip = '198.51.100.10';
    const user = await verifiedUser('pat-old@example.com', ip);
    const orgId = newId();
    const projectId = newId();
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'pat-org','PAT')`, [
      orgId,
    ]);
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'pat','PAT','pat')`,
      [projectId, orgId],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
      [newId(), orgId, projectId, user.id],
    );
    const pat = (
      await app
        .get(AuthService)
        .issueToken({ projectId, userId: user.id, name: 'agent', scopes: ['spec:read'] })
    ).token;
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/me/email-change',
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(read.statusCode).toBe(403);
    expect((read.json() as Record<string, unknown>)['code']).toBe(NERV_ERROR.HUMAN_ONLY);

    await changeEmail({
      cookie: user.cookie,
      ip,
      newEmail: 'pat-new@example.com',
      password: PASSWORD,
    });
    const approve = await mailOf('change_email_approve', 'pat-old@example.com');
    await openLink(approve.token, approve.callback, ip);
    const confirm = await mailOf('change_email_confirm', 'pat-new@example.com');
    await openLink(confirm.token, confirm.callback, ip);
    expect((await emailOf(user.id)).email).toBe('pat-new@example.com');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as Record<string, unknown>)['email']).toBe('pat-new@example.com');
  });
});
