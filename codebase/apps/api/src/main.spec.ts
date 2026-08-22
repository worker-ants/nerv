// 부트스트랩 스모크 — 실제 Fastify 인스턴스에 요청을 넣어 표면 배선을 확인한다.
// (네트워크 리슨 없이 app.inject() 로 도는 L1 범위)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DatabaseModule 은 기동 시 DATABASE_URL 을 요구한다(오설정으로 뜨는 것보다 안 뜨는 게 낫다).
// 이 스위트는 모듈 그래프와 라우팅만 보고 **질의를 한 번도 하지 않으므로** 더미 값으로 충분하다 —
// pg.Pool 은 첫 질의 전까지 접속하지 않는다. 실제 DB 검증은 L2 소관이다(codebase.md §4.3).
process.env['DATABASE_URL'] ??= 'postgres://nerv:nerv@127.0.0.1:5432/nerv_l1_no_connect';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { NERV_ERROR } from '@nerv/schema';
import { createApp } from './main.js';

describe('createApp — 표면 배선', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/healthz 는 무인증으로 200 을 준다 — 인프라 전용 liveness (codebase.md §5.4)', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('보호 라우트는 자격증명 없이 401 을 준다 — 미구현 기본값은 열림이 아니라 닫힘', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, code: NERV_ERROR.UNAUTHENTICATED });
  });

  it('POST /mcp 는 다른 Origin 을 403 으로 막는다 (REQ-CB-013)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, code: NERV_ERROR.FORBIDDEN });
  });

  it('에러 봉투는 MCP 와 같은 모양이다 (api.md §1.4)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(Object.keys(res.json()).sort()).toEqual([
      'code',
      'details',
      'message',
      'next_actions',
      'ok',
      'retry_after_s',
    ]);
  });
});
