// 접근 로그 — 실제 앱 배선으로 (REQ-CB-052)
//
// L1(`src/common/access-log.spec.ts`)은 훅을 맨 Fastify 에 달아 본다. 여기서는 **Nest 가 실제로
// 세운 앱**에서 세 가지를 센다 — 가드가 거절한 요청도 한 줄이 남는가(인터셉터였다면 남지 않는다),
// 필터가 단 에러 코드가 그 줄에 실리는가, Nest 라우트가 아닌 better-auth 경로도 타는가.
// 줄은 전역 로거(NervLogger)가 stdout 에 쓰는 그대로 읽는다.

import { NERV_ERROR } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/main.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let app: NestFastifyApplication;

beforeAll(async () => {
  db = await createScratchDb('nerv_access');
  await runMigrations(db.url);
  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** stdout 에 쓰인 `[Access]` 줄 — 응답이 끝난 뒤 `close` 에서 쓰이므로 한 틱 기다린다 */
async function accessLines(send: () => Promise<unknown>): Promise<string[]> {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    written.push(String(chunk));
    return original(chunk as string, ...(rest as []));
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  await send();
  await new Promise((resolve) => setImmediate(resolve));
  return written.filter((line) => line.includes('[Access]'));
}

describe('접근 로그 — Nest 앱 배선', () => {
  it('가드가 거절한 요청도 한 줄 — 에러 코드와 요청 ID 를 싣는다', async () => {
    const id = 'l2-access-guard-0001';
    let status = 0;
    let echoed: unknown;
    const lines = await accessLines(async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/notifications?q=secret-value',
        headers: { 'x-request-id': id },
      });
      status = res.statusCode;
      echoed = res.headers['x-request-id'];
    });
    expect(status).toBe(401);
    expect(echoed).toBe(id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WARN');
    expect(lines[0]).toContain(`[req=${id}]`);
    expect(lines[0]).toContain('GET /api/v1/me/notifications 401');
    expect(lines[0]).toContain(`code=${NERV_ERROR.UNAUTHENTICATED}`);
    expect(lines[0]).not.toContain('secret-value');
    expect(lines[0]).not.toContain('aborted'); // 끝까지 쓴 응답이다
  });

  it('Nest 라우트가 아닌 better-auth 경로도 탄다', async () => {
    const lines = await accessLines(() =>
      app.inject({ method: 'GET', url: '/api/auth/get-session' }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('surface=auth');
  });

  it('/healthz 는 남기지 않는다', async () => {
    const lines = await accessLines(() => app.inject({ method: 'GET', url: '/healthz' }));
    expect(lines).toHaveLength(0);
  });
});
