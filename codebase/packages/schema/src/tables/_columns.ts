// drizzle 기본 제공에 없는 컬럼 타입과 전 테이블 공통 컬럼.
// 표 파일이 아니라 그들이 함께 쓰는 조각이라 밑줄 접두를 붙였다(tables/ 안의 비-테이블 모듈).
//
// 전역 규약 정본: docs/04-mvp/database.md §1.3
//   - 별도 표기가 없으면 모든 테이블은 `id uuid PRIMARY KEY` + `created_at timestamptz NOT NULL DEFAULT now()`
//   - **id 에 DB DEFAULT 를 두지 않는 것은 의도다** — 발급 주체는 앱 계층 하나뿐이어야 한다
//     (서버 발급 UUIDv7, 클라이언트 발급 금지 — data-model §5.1)

import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** citext — user.email 대소문자 무시 유니크 (확장 citext) */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** bytea — content_hash · token_hash · fingerprint · changeset_hash */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** vector(N) — pgvector. 차원은 전 프로필 1024 고정(REQ-CB-021) */
export const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value: number[]) => JSON.stringify(value),
  })(name);

/** 서버 발급 uuid PK — DB DEFAULT 없음(§1.3) */
export const idPk = () => uuid('id').primaryKey();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

/** nullable timestamptz — 결정·완료·해제 시각 등 */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
