// 요구사항 번호의 소유 — **다른 문서가 가진 번호는 덮지 않는다**(2026-10-15 · 사람 결정 · REQ-API-309 · REQ-IMP-034)
//
// `requirement` 는 `(project_id, ref)` 가 유일하다. 그래서 두 문서가 같은 번호를 정의하면 `ON CONFLICT` 가 한 행을 두고
// 다툰다. 승인 경로가 먼저 소유를 보게 됐는데(REQ-API-309) 임포터(EP-IMP-02)는 그 뒤에도 `spec_id` 를 보지 않아, 다른
// 문서가 가진 행의 `current_version_id` · `acceptance_md` 를 조용히 덮었다. 판정을 여기 한 곳에 두고 두 쓰기가 함께
// 쓴다(D-05) — 경로마다 규칙을 따로 들면 한쪽만 고쳐지는 일이 또 생긴다.
//
// **규칙**: 이 문서가 가진 번호이거나 소유가 풀린 번호 — 가진 문서의 최신 승인본에서 그 줄이 빠져
// `removed_in_version_id` 가 적힌 것 — 만 쓴다. **판정은 쓰기의 갱신 조건에 있다**(`ON CONFLICT … DO UPDATE … WHERE`).
// 미리 읽고 판단하면 동시에 쓰는 두 문서가 둘 다 "덮어도 된다" 를 본다. 갱신 조건이면 나중에 잠금을 얻은 쪽은 앞의
// 쓰기가 끝난 행을 다시 보고 갱신된 행이 없어(`RETURNING` 0행) 거절된다.

import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { NERV_ERROR } from '@nerv/schema';
import type { Message } from '@nerv/schema';
import { sqlArray } from '../../common/sql-array.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import type { NervDb } from '../../common/database.module.js';

type Queryable = Pick<NervDb, 'execute'>;

/** `ON CONFLICT (project_id, ref) DO UPDATE … WHERE` 의 조건 — 이 문서가 쓸 수 있는 행인가 */
export function writableBy(specId: string): SQL {
  return sql`(requirement.spec_id = ${specId} OR requirement.removed_in_version_id IS NOT NULL)`;
}

/**
 * 갱신 `SET` 의 소유 칸 — 소유를 이 문서로 두고 다른 문서에서 옮겨 온 번호면 들어온 버전도 이 버전으로 바꾸며,
 * 다시 살아 있는 것으로 적는다. 들어온 버전을 옮기는 이유: 기준선 검색이 버전 번호를 문서마다 견주므로 옛 문서의
 * 버전을 가리키면 견줄 수 없다. 같은 문서의 행이면 들어온 버전은 그대로다.
 */
export function ownershipColumns(specId: string, versionId: string): SQL {
  return sql`spec_id = ${specId},
             introduced_in_version_id = CASE WHEN requirement.spec_id = ${specId}
                                             THEN requirement.introduced_in_version_id
                                             ELSE ${versionId}::uuid END,
             removed_in_version_id = NULL`;
}

/**
 * 쓰기 전에 소유가 풀려 있는 **다른 문서의** 번호 — 옮겨 오면 어디서 왔는지 남기기 위해 읽는다(`requirements_moved`).
 * 판정에는 쓰지 않는다(판정은 갱신 조건이다).
 */
export async function releasedOwners(
  db: Queryable,
  input: { projectId: string; specId: string; refs: readonly string[] },
): Promise<Map<string, string>> {
  if (input.refs.length === 0) return new Map();
  const { rows } = await db.execute<{ ref: string; owner_key: string }>(sql`
    SELECT r.ref, s.key AS owner_key
      FROM requirement r JOIN spec s ON s.id = r.spec_id
     WHERE r.project_id = ${input.projectId} AND r.spec_id <> ${input.specId}
       AND r.removed_in_version_id IS NOT NULL
       AND r.ref = ANY(${sqlArray([...input.refs], 'text')})
  `);
  return new Map(rows.map((row) => [row.ref, row.owner_key]));
}

/**
 * 갱신되지 않은 번호는 **다른 문서가 가진 번호**다 — 가진 문서와 함께 409 `requirement_owned` 로 거절한다. 트랜잭션이
 * 함께 되돌아가므로 그 사이에 쓴 다른 줄도 남지 않는다. 문구는 경로가 정한다(승인 · 임포트).
 */
export async function refuseOwned(
  db: Queryable,
  projectId: string,
  refused: readonly string[],
  message: (refs: string) => Message,
): Promise<void> {
  if (refused.length === 0) return;
  const { rows: owners } = await db.execute<{ ref: string; owner_key: string }>(sql`
    SELECT r.ref, s.key AS owner_key
      FROM requirement r JOIN spec s ON s.id = r.spec_id
     WHERE r.project_id = ${projectId} AND r.ref = ANY(${sqlArray([...refused], 'text')})
     ORDER BY r.ref
  `);
  throw new NervError(
    NERV_ERROR.PRECONDITION,
    message(owners.map((o) => `${o.ref} → ${o.owner_key}`).join(', ')),
    {
      kind: 'requirement_owned',
      owned: owners.map((o) => ({ ref: o.ref, owner_key: o.owner_key })),
    },
  );
}
