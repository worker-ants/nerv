// L2 공용 — 테스트마다 격리된 데이터베이스를 만든다.
//
// 스키마 전체를 적용하고 지우는 테스트라 공유 DB 를 쓰면 서로를 밟는다. 매 스위트가
// 자기 DB 를 만들고 끝나면 드랍한다 — CI 서비스 컨테이너에서도 같은 방식으로 돈다.

import { randomUUID } from 'node:crypto';
import pg from 'pg';

export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('L2 통합 테스트에는 DATABASE_URL 이 필요하다 (codebase.md §4.3)');
  }
  return url;
}

export interface ScratchDb {
  url: string;
  name: string;
  drop: () => Promise<void>;
}

/** 관리 커넥션으로 새 DB 를 만들고, 그 DB 를 가리키는 URL 을 돌려준다. */
export async function createScratchDb(prefix = 'nerv_test'): Promise<ScratchDb> {
  const adminUrl = databaseUrl();
  const name = `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    name,
    drop: async () => {
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      // **남은 연결이 스스로 닫히기를 잠깐 기다린다**(2026-09-25 — CI 에서만 드러난 경쟁). `pool.end()` 는 소켓이
      // 실제로 닫히기 **전에** 끝날 수 있다(끊기를 보내 놓고 기다리지 않는다). 그 틈에 `WITH (FORCE)` 가 연결을
      // 끊으면 닫히던 클라이언트가 57P01 을 받고, 이미 풀에서 빠져 듣는 이가 없어 잡히지 않은 예외가 된다 —
      // 검사 969건이 다 통과해도 러너가 빨갛다(ingest.spec 정리 단계 실측). 강제는 그래도 남은 것만 맡는다.
      for (let i = 0; i < 40; i += 1) {
        const { rows } = await cleanup.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`,
          [name],
        );
        if ((rows[0]?.n ?? 0) === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
