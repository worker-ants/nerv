// 일괄 결정의 상한을 넘긴 요청 — 봉투가 상한을 말한다 (EP-APR-06 · REQ-API-191)
//
// 웹은 이제 50건을 넘겨 고르지 못하게 하지만(REQ-WEB-181), 이 경로는 API 다 — 다른 클라이언트가
// 51건을 보내면 "요청 본문이 스키마와 맞지 않습니다" 한 줄만 돌아왔다. 무엇을 줄여야 하는지는
// `details.issues` 를 뒤져야 알 수 있었다. 상태(400)와 `details.issues` 는 그대로이고 문장만
// 바뀐다 — 그 문장이 요청 로케일을 따르는지까지 여기서 본다(REQ-CB-024).

import { BULK_DECISION_LIMIT, NERV_ERROR } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { DEFAULT_ORIGIN } from '../../src/common/origins.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const EMAIL = 'bulk-limit@example.com';
const PASSWORD = 'correct-horse-battery';

let db: ScratchDb;
let app: NestFastifyApplication;
let cookie: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_bulk_limit');
  await runMigrations(db.url);
  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const signUp = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: EMAIL, password: PASSWORD, name: '지민' },
  });
  expect(signUp.statusCode).toBe(200);
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: EMAIL, password: PASSWORD },
  });
  expect(signIn.statusCode).toBe(200);
  const setCookie = signIn.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '');
  cookie = raw.split(';')[0] ?? '';
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

/** 봉투 — 이 검사가 읽는 칸만 적는다 */
interface Envelope {
  code?: string;
  message?: string;
  details?: { issues?: unknown };
  failed?: number;
  results?: { kind?: string }[];
}

async function decide(count: number, locale: string): Promise<{ status: number; body: Envelope }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/approvals/decisions',
    headers: {
      cookie,
      origin: DEFAULT_ORIGIN,
      'content-type': 'application/json',
      'accept-language': locale,
    },
    payload: {
      decision: 'approve',
      items: Array.from({ length: count }, (_, i) => ({ id: `missing-${i}` })),
    },
  });
  return { status: res.statusCode, body: res.json<Envelope>() };
}

describe('EP-APR-06 — 상한을 넘긴 일괄 결정 (REQ-API-191)', () => {
  it('51건이면 400 과 함께 상한을 말한다 — 요청 로케일로', async () => {
    const ko = await decide(BULK_DECISION_LIMIT + 1, 'ko');
    expect(ko.status).toBe(400);
    expect(ko.body.code).toBe(NERV_ERROR.PRECONDITION);
    expect(ko.body.message).toBe('한 번에 50건까지 결정할 수 있습니다.');
    // 무엇이 틀렸는지의 기계용 사실은 그대로 있다
    expect(ko.body.details?.issues).toBeDefined();

    const en = await decide(BULK_DECISION_LIMIT + 1, 'en');
    expect(en.status).toBe(400);
    expect(en.body.message).toBe('You can decide up to 50 items at once.');
  });

  it('키를 달지 않은 위반은 예전 문장이다 — 빈 목록', async () => {
    const res = await decide(0, 'ko');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('요청 본문이 스키마와 맞지 않습니다.');
  });

  it('상한까지는 모양 검사를 지나 항목별 결과로 답한다 — 없는 결재는 not_found 다', async () => {
    const res = await decide(BULK_DECISION_LIMIT, 'ko');
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(BULK_DECISION_LIMIT);
    expect(res.body.results?.[0]?.kind).toBe('not_found');
  });
});
