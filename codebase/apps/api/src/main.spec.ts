// 부트스트랩 스모크 — 실제 Fastify 인스턴스에 요청을 넣어 표면 배선을 확인한다.
// (네트워크 리슨 없이 app.inject() 로 도는 L1 범위)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
