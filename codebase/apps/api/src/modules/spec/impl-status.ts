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
 * **`verified` 는 건드리지 않는다.** 그 칸의 조건("QA 역할의 검증 증적" + "그 커밋 범위에
 * 열린 critical 0")은 지금 스키마가 담지 못한다 — 증적에 작성자 역할이 없고 커밋 범위와
 * 발견을 잇는 축도 없다. 없는 근거로 약한 규칙을 만들어 `verified` 를 찍으면 그 값은
 * 검증됐다는 뜻이 아니게 된다. 그래서 이미 `verified` 인 행은 내리지도 않는다.
 *
 * **Task 가 하나도 없으면 손대지 않는다.** 표의 첫 줄은 "연결된 Task 가 없거나"까지 포함하지만,
 * 그대로 적용하면 임포터가 문서에서 읽어 넣은 값(clemvion 의 `implemented` 들)을 증적 등록
 * 한 번에 `unimplemented` 로 쓸어버린다. 파생은 파생할 재료가 있을 때만 한다.
 */
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
           ) AND EXISTS (
             -- 요구사항에 직접 붙은 것과 그 파생 Task 에 붙은 것을 함께 센다.
             -- 완료 게이트가 받는 증적은 task_id 로 달리므로(§4 조건 4), 요구사항 쪽만
             -- 보면 정상 경로로 끝낸 작업이 영영 implemented 가 되지 못한다.
             SELECT 1 FROM evidence e
              WHERE e.requirement_id = r.id
                 OR e.task_id IN (SELECT t.id FROM task t WHERE t.source_requirement_id = r.id)
           ) THEN 'implemented'
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
