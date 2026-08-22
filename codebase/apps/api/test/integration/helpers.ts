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
