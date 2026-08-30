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
