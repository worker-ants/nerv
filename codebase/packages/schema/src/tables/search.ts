// 검색 인덱스 테이블 — spec_chunk_embedding
// 정본: docs/04-mvp/database.md §2.15
//
// **이 테이블은 데이터 모델의 엔티티가 아니다.** 원문(spec_version.body_md)에서 언제든
// 재생성 가능한 검색 인덱스의 물리 테이블이며, 엔티티 29종 카운트와 ERD 에 들지 않는다.
// 백업 대상에서도 제외 가능하다([4.2](codebase.md) §6.5 — 유실 시 재임베딩).
//
// 운영 규칙(집행 주체는 워커 embedding.job):
//   1. 인덱싱 대상은 최신 버전만 — 스펙별 최신 approved + 현재 draft
//   2. 갱신은 청크 해시 비교 후 변경분만. approved 본문은 불변이라 버전당 최대 1회
//   3. 모델 교체는 새 model 행을 쓰고 전량 재임베딩 후 구 행 드랍(검색은 단일 모델만 질의)

import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, idPk, vector } from './_columns.js';
import { specVersion } from './spec.js';

/** 전 제공자 1024차원 고정 — 프로필 정본 codebase.md §5.2a (REQ-CB-021) */
export const EMBEDDING_DIMENSIONS = 1024;

export const specChunkEmbedding = pgTable(
  'spec_chunk_embedding',
  {
    id: idPk(),
    /** 원문이 사라지면 인덱스도 사라진다 — 이 테이블에만 CASCADE 를 둔다(파생 데이터라서) */
    specVersionId: uuid('spec_version_id')
      .notNull()
      .references(() => specVersion.id, { onDelete: 'cascade' }),
    /** 헤딩 slug — 코멘트 앵커와 동일 규약(D-09). 청크 = 헤딩 단위 */
    anchor: text('anchor').notNull(),
    /** sha256(청크 본문) — 무변경 재임베딩 차단 */
    chunkHash: bytea('chunk_hash').notNull(),
    embedding: vector('embedding', EMBEDDING_DIMENSIONS).notNull(),
    /** 모델 식별자 — 교체 시 재임베딩 관리 축 */
    model: text('model').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('chunk_embedding_uq').on(t.specVersionId, t.anchor, t.model),
    index('spec_chunk_embedding_hnsw').using('hnsw', sql`${t.embedding} vector_cosine_ops`),
  ],
);
