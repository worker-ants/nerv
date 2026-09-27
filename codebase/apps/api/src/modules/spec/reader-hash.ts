// 읽는 사람이 보게 되는 버전의 지문 — 비교-교환의 기준값 (api.md §1.4g·§1.4h)
//
// **`get()` 의 버전 선택 규칙과 같아야 한다**: 최신 approved, 없으면 현재 버전. 다르면
// 에이전트가 받은 지문과 서버가 견주는 지문이 어긋나 "안 바뀌었는데 stale" 이 된다 —
// 그건 계약이 아니라 함정이다. 그래서 자기 문서(spec.service)와 관계 대상(spec-relation)이
// **한 함수**를 쓴다.

import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';

/** 트랜잭션이든 풀이든 같은 질의다 — 옆 서비스들과 같은 표기다 */
type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

export async function readerHash(db: Tx | NervDb, specId: string): Promise<string | null> {
  const { rows } = await db.execute<{ content_hash: string }>(sql`
    SELECT encode(sv.content_hash, 'hex') AS content_hash
      FROM spec s
      JOIN spec_version sv ON sv.id = coalesce(
            (SELECT a.id FROM spec_version a
              WHERE a.spec_id = s.id AND a.status = 'approved'
              ORDER BY a.version_no DESC LIMIT 1),
            s.current_version_id)
     WHERE s.id = ${specId}
  `);
  return rows[0]?.content_hash ?? null;
}

export interface VersionRef extends Record<string, unknown> {
  id: string;
  version_no: number;
  status: string;
  content_hash: string;
}

/**
 * 읽는 사람이 보게 되는 버전 **그 자체**(번호 · 상태 · 지문) — `readerHash` 와 같은 규칙이다.
 * 오류가 "그 버전을 다시 읽으라" 고 말하려면 지문만으로는 모자란다(REQ-API-199).
 */
export async function readerVersion(db: Tx | NervDb, specId: string): Promise<VersionRef | null> {
  const { rows } = await db.execute<VersionRef>(sql`
    SELECT sv.id, sv.version_no, sv.status::text AS status,
           encode(sv.content_hash, 'hex') AS content_hash
      FROM spec s
      JOIN spec_version sv ON sv.id = coalesce(
            (SELECT a.id FROM spec_version a
              WHERE a.spec_id = s.id AND a.status = 'approved'
              ORDER BY a.version_no DESC LIMIT 1),
            s.current_version_id)
     WHERE s.id = ${specId}
  `);
  return rows[0] ?? null;
}

/**
 * 번호가 가장 큰 버전 — 최신 기준으로 읽은 사람이 받은 버전이다(REQ-API-193).
 * 관계 선언은 이 지문도 받는다(2026-09-27 사람 결정 M13 · REQ-API-205).
 */
export async function latestVersion(db: Tx | NervDb, specId: string): Promise<VersionRef | null> {
  const { rows } = await db.execute<VersionRef>(sql`
    SELECT id, version_no, status::text AS status, encode(content_hash, 'hex') AS content_hash
      FROM spec_version WHERE spec_id = ${specId}
     ORDER BY version_no DESC LIMIT 1
  `);
  return rows[0] ?? null;
}
