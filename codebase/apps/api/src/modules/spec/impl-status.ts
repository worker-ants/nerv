// 구현 축 — Requirement 의 `impl_status` 는 **파생값이다**(D-03 · spec-workflow §1.3)
//
// > 이 축의 값은 **사람이 손으로 찍지 않는다.** 서버가 관계 그래프에서 파생한다.
//
// 그 문장은 처음부터 있었는데 파생하는 코드가 없었다(실측 2026-09-05: `impl_status` 를
// 바꾸는 UPDATE 가 저장소에 **0건**). 그래서 요구사항은 임포터가 넣어 준 값에 그대로 멈춰
// 있었고, 웹·에이전트로 만든 요구사항은 영원히 `unimplemented` 였다.
//
// **판정은 여기 한 곳이다.** 부르는 자리는 셋(클레임·Task 전이·증적 등록)인데 규칙을 그
// 셋에 복사하면 세 곳이 갈라지고, 갈라진 뒤에는 화면의 수가 어느 쪽 말인지 알 수 없다.

import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';

type Queryable = Pick<NervDb, 'execute'>;

/**
 * spec-workflow §1.3 의 파생 규칙표를 그대로 옮긴 것이다.
 *
 * | 상태 | 규칙 |
 * | --- | --- |
 * | `unimplemented` | 연결된 Task 가 전부 `backlog`/`ready` |
 * | `in_progress` | 하나 이상이 `claimed`/`in_progress`/`in_review` |
 * | `implemented` | 전부 `done` **그리고** Evidence 1건 이상 |
 *
 * **전부 `done` 인데 증적이 없으면 `in_progress` 에 머문다.** 표가 `implemented` 에 두 조건을
 * 모두 걸었기 때문이고, 그래야 "됐다고 하려면 보일 것을 붙여라" 가 압력으로 남는다.
 *
 * **`verified` 는 이제 파생한다**(2026-09-07 · REQ-API-141). 오래 "스키마가 담지 못한다" 고
 * 적어 두었는데 열은 처음부터 있었다 — `evidence.verified_by`(누가 검증했는가)와
 * `finding.requirement_id`(그 요구사항의 발견). 조건은 셋이다: 전부 `done` · **검증자가 서명한
 * `test` 증적**이 1건 이상 · 그 요구사항에 열린 `critical` 발견이 0건. 정본이 적은 "그 커밋
 * 범위" 축만 아직 없다 — 커밋과 발견을 잇는 축이 Phase 2 라, 지금은 요구사항 단위로 본다.
 *
 * **내리지는 않는다.** 이미 `verified` 인 행은 그대로 둔다(강등은 CR 축이고 Phase 2 다) —
 * 그 가드가 없으면 발견 하나가 열릴 때마다 검증 사실이 지워졌다 다시 붙는다.
 *
 * **Task 가 하나도 없으면 손대지 않는다.** 표의 첫 줄은 "연결된 Task 가 없거나"까지 포함하지만,
 * 그대로 적용하면 임포터가 문서에서 읽어 넣은 값(clemvion 의 `implemented` 들)을 증적 등록
 * 한 번에 `unimplemented` 로 쓸어버린다. 파생은 파생할 재료가 있을 때만 한다.
 */
/**
 * **증적이 있는가 — 술어 한 벌**(2026-09-07 · REQ-API-141).
 *
 * 같은 물음을 파생(`impl-status`)과 커버리지(`coverage()` 의 `evidence_missing`)가 서로 다른
 * 식으로 세고 있었다. 그러면 첫 실사용 `done` 에서 대시보드는 "증적 결손" 을 말하고
 * 요구사항은 `implemented` 라고 말한다 — 둘 다 서버가 한 말이라 사람은 어느 쪽도 못 믿는다.
 *
 * 요구사항에 직접 붙은 것과 그 파생 Task 에 붙은 것을 함께 센다: 완료 게이트가 받는 증적은
 * `task_id` 로 달리므로(§4 조건 4) 요구사항 쪽만 보면 정상 경로로 끝낸 작업이 영영
 * `implemented` 가 되지 못한다.
 */
export function evidenceExistsSql(reqAlias = 'r'): SQL {
  const ref = sql.raw(`${reqAlias}.id`);
  return sql`EXISTS (
    SELECT 1 FROM evidence e
     WHERE e.requirement_id = ${ref}
        OR e.task_id IN (SELECT t.id FROM task t WHERE t.source_requirement_id = ${ref})
  )`;
}

/** 검증 증적 — QA·admin 이 서명한 `test` 증적이 있는가(`verified` 의 첫째 조건). */
export function verifiedEvidenceSql(reqAlias = 'r'): SQL {
  const ref = sql.raw(`${reqAlias}.id`);
  return sql`EXISTS (
    SELECT 1 FROM evidence e
     WHERE (e.requirement_id = ${ref}
            OR e.task_id IN (SELECT t.id FROM task t WHERE t.source_requirement_id = ${ref}))
       AND e.kind = 'test' AND e.verified_by IS NOT NULL
  )`;
}

/** 열린 critical 발견 — 있으면 검증됐다고 말할 수 없다(`verified` 의 둘째 조건). */
export function openCriticalSql(reqAlias = 'r'): SQL {
  const ref = sql.raw(`${reqAlias}.id`);
  return sql`EXISTS (
    SELECT 1 FROM finding f
     WHERE f.requirement_id = ${ref} AND f.severity = 'critical' AND f.status = 'open'
  )`;
}

export async function recomputeImplStatus(db: Queryable, requirementId: string): Promise<void> {
  await db.execute(sql`
    UPDATE requirement r
       SET impl_status = (
         CASE
           WHEN EXISTS (
             SELECT 1 FROM task t
              WHERE t.source_requirement_id = r.id
                AND t.status IN ('claimed', 'in_progress', 'in_review')
           ) THEN 'in_progress'
           WHEN NOT EXISTS (
             SELECT 1 FROM task t WHERE t.source_requirement_id = r.id AND t.status <> 'done'
           ) AND ${evidenceExistsSql()}
             AND ${verifiedEvidenceSql()}
             AND NOT ${openCriticalSql()} THEN 'verified'
           WHEN NOT EXISTS (
             SELECT 1 FROM task t WHERE t.source_requirement_id = r.id AND t.status <> 'done'
           ) AND ${evidenceExistsSql()} THEN 'implemented'
           WHEN EXISTS (
             SELECT 1 FROM task t WHERE t.source_requirement_id = r.id AND t.status = 'done'
           ) THEN 'in_progress'
           ELSE 'unimplemented'
         END
       )::impl_status
     WHERE r.id = ${requirementId}
       AND r.impl_status <> 'verified'
       AND EXISTS (SELECT 1 FROM task t WHERE t.source_requirement_id = r.id)
  `);
}
