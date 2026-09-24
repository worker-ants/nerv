// 스키마가 뒤처진 채 뜨지 않는다 (REQ-CB-056)
//
// 2026-09-24 실측: 개발 DB 에 31건 중 27건만 적용된 채 api 가 떠 있었고, 없는 칸을 읽는
// 질의마다 500 이 흩어졌다. 판정은 L2 가 실제 Postgres 로 본다(migrate.spec) — 여기서는
// 기동 검사의 모양(무엇을 막고 무엇을 막지 않는가)만 본다.

import { describe, expect, it, vi } from 'vitest';
import { assertSchemaCurrent, schemaBehindMessage } from './schema-guard.js';

const ENV = { DATABASE_URL: 'postgres://x@127.0.0.1:5432/nerv' } as NodeJS.ProcessEnv;

describe('assertSchemaCurrent', () => {
  it('남은 파일이 없으면 뜬다', async () => {
    const read = vi.fn(async () => ({ applied: 31, expected: 31, pending: [] }));
    await expect(assertSchemaCurrent(ENV, read)).resolves.toBeUndefined();
  });

  it('뒤처졌으면 무엇이 남았는지와 명령을 말하고 멈춘다', async () => {
    const read = vi.fn(async () => ({
      applied: 27,
      expected: 31,
      pending: ['0027_email_outbox', '0028_email_verified_backfill'],
    }));
    const failure = assertSchemaCurrent(ENV, read);
    await expect(failure).rejects.toThrow('0027_email_outbox');
    await expect(failure).rejects.toThrow('pnpm db:migrate');
  });

  it('DB 에 닿지 못하면 막지 않는다 — 그것은 이 검사의 일이 아니다', async () => {
    const read = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(assertSchemaCurrent(ENV, read)).resolves.toBeUndefined();
  });

  it('DATABASE_URL 이 없으면 묻지 않는다 — DatabaseModule 이 따로 멈춘다', async () => {
    const read = vi.fn();
    await expect(assertSchemaCurrent({} as NodeJS.ProcessEnv, read)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});

describe('schemaBehindMessage', () => {
  it('뒤처지지 않았으면 할 말이 없다', () => {
    expect(schemaBehindMessage({ applied: 31, expected: 31, pending: [] })).toBeNull();
  });

  it('적용 수와 코드 수를 함께 말한다', () => {
    expect(schemaBehindMessage({ applied: 27, expected: 31, pending: ['0030_x'] })).toContain(
      '적용 27건 · 코드 31건',
    );
  });
});
