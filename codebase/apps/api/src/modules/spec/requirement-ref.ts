// 요구사항 참조 — 고정 ID(`REQ-…`)든 UUID 든 **그 프로젝트 안에서** 요구사항 UUID 로 푼다
// (2026-10-15 · 사람 결정 · REQ-API-311)
//
// 에이전트가 도구로 읽을 수 있는 요구사항은 고정 ID 뿐이다(`nerv_spec_get` 의 `requirements[].ref`). 그런데 발견의
// `requirement_id` 와 작업의 `source_requirement_id` 는 uuid 열에 그대로 들어가서, 고정 ID 를 넣으면 요청 전체가
// 22P02(형식 오류)로 거절되고 리뷰 라운드도 남지 않았다. 반대로 다른 프로젝트의 요구사항 UUID 는 FK 를 지나 그대로
// 들어갔다. 리뷰 제출과 작업 생성이 이 함수 하나로 푼다(D-05) — 표면마다 따로 풀면 한쪽만 고정 ID 를 받게 된다.
// 검색의 `requirement_id`(그 요구사항이 속한 스펙으로 좁히기 · REQ-API-110)도 같은 날 이 함수로 옮겼다 — 따로 풀던
// 동안 거절의 문구와 칸이 달라 같은 값의 거절을 도구마다 다르게 읽어야 했다.

import { sql } from 'drizzle-orm';
import { msg, NERV_ERROR } from '@nerv/schema';
import { entityRef } from '../../common/entity-ref.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import type { NervDb } from '../../common/database.module.js';

type Queryable = Pick<NervDb, 'execute'>;

/**
 * 요구사항 참조를 UUID 로 푼다. 비었으면(`null` · 공백) 안 준 것이라 `null` 이다.
 *
 * 값의 **형태**로 가른다(api.md §1.4b) — UUID 모양이면 id 로, 아니면 고정 ID 로 찾는다. 둘 다 `project_id` 를 함께
 * 본다: 고정 ID 는 프로젝트 안에서만 유일하고(`requirement_ref_uq`), UUID 도 다른 프로젝트의 것을 받지 않는다.
 * 문서에서 빠진 요구사항(`removed_in_version_id`)도 푼다 — 행은 남아 있고 빠진 요구사항을 가리키는 지적도 지적이다.
 *
 * **못 풀면 거절한다**(409 `not_found`) — 조용히 버리면 출처 없는 발견 · 작업이 성공으로 남는다. 고정 ID 도 UUID 도
 * 아닌 값도 같은 거절이다: 형태로는 어느 쪽인지 알 수 없어 고정 ID 로 찾아보고 없으면 없다고 말한다.
 * `field` 는 요청 안의 자리(`findings[2].requirement_id` 등)이고 `context` 는 그 자리를 사람이 알아볼 단서다.
 */
export async function resolveRequirementRef(
  db: Queryable,
  projectId: string,
  ref: string | null | undefined,
  field: string,
  context: Record<string, unknown> = {},
): Promise<string | null> {
  const parsed = entityRef(ref);
  if (parsed.id === null && parsed.key === null) return null;
  const { rows } = await db.execute<{ id: string }>(
    parsed.id !== null
      ? sql`SELECT id FROM requirement WHERE project_id = ${projectId} AND id = ${parsed.id}`
      : sql`SELECT id FROM requirement WHERE project_id = ${projectId} AND ref = ${parsed.key ?? ''}`,
  );
  const found = rows[0]?.id;
  if (found === undefined) {
    const value = (ref ?? '').trim();
    throw new NervError(
      NERV_ERROR.PRECONDITION,
      msg('error.requirement.unresolved', { ref: value, field }),
      { kind: 'not_found', field, value, ...context },
    );
  }
  return found;
}
