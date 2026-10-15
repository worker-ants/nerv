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
import { commitShapedSql, latestTaskCommitSql, sameCommitSql } from '../review/commit-scope.js';

type Queryable = Pick<NervDb, 'execute'>;

/**
 * spec-workflow §1.3 의 파생 규칙표를 그대로 옮긴 것이다.
 *
 * | 상태 | 규칙 |
 * | --- | --- |
 * | `unimplemented` | 착수된 것도 `done` 인 것도 없다(전부 `backlog`/`ready`/`blocked`) |
 * | `in_progress` | 하나 이상이 `claimed`/`in_progress`/`in_review` — 또는 `done` 이 있지만 아직 전부가 아니거나 증적이 없다 |
 * | `implemented` | 전부 `done` **그리고** Evidence 1건 이상(낡은 것 제외) |
 *
 * **간선은 사건이 아니라 조건이다**(2026-09-26 사람 결정 · spec-workflow §1.3 이 유일한 상태도).
 * 그래서 되돌림도 조건에서 나온다 — 착수가 취소되고 `done` 이 없으면 `unimplemented`, 구현된
 * 요구사항에 새 작업이 착수되면 `in_progress`. 두 명세가 그리던 "회귀 실패" 와 "증적 stale →
 * 미구현" 은 여기 없다: 앞의 것은 서버가 테스트 결과를 받지 않아 판정할 수 없고(Phase 2 의
 * 재검토 트리거), 뒤의 것은 이 표와 모순한다 — 낡은 증적은 **증적에서 빠질** 뿐이다.
 *
 * **전부 `done` 인데 증적이 없으면 `in_progress` 에 머문다.** 표가 `implemented` 에 두 조건을
 * 모두 걸었기 때문이고, 그래야 "됐다고 하려면 보일 것을 붙여라" 가 압력으로 남는다.
 *
 * **`verified` 는 이제 파생한다**(2026-09-07 · REQ-API-141). 오래 "스키마가 담지 못한다" 고
 * 적어 두었는데 열은 처음부터 있었다 — `evidence.verified_by`(누가 검증했는가)와
 * `finding.requirement_id`(그 요구사항의 발견). 조건은 셋이다: 전부 `done` · **검증자가 서명한
 * `test` 증적**이 1건 이상 · **커밋 범위에** 열린 `critical` 발견이 0건. 커밋 범위는 2026-10-15 에
 * 들어왔다(E15-S03 · REQ-API-315 — `commitScopeClearSql`). 작업의 커밋을 모르면 예전처럼 요구사항 단위로 본다.
 *
 * **내리지는 않는다.** 이미 `verified` 인 행은 그대로 둔다 — 그 가드가 없으면 발견 하나가
 * 열릴 때마다 검증 사실이 지워졌다 다시 붙는다. **문장이 바뀌었을 때만 예외다**(2026-09-26 ·
 * REQ-API-190): 서명은 그 문장에 대한 것이라, 바뀐 문장에 대한 서명이 없으면 다시 파생한다.
 *
 * **Task 가 하나도 없으면 손대지 않는다.** 표의 첫 줄은 "연결된 Task 가 없거나"까지 포함하지만,
 * 그대로 적용하면 임포터가 문서에서 읽어 넣은 값(clemvion 의 `implemented` 들)을 증적 등록
 * 한 번에 `unimplemented` 로 쓸어버린다. 파생은 파생할 재료가 있을 때만 한다.
 *
 * **값을 쓰면 출처도 쓴다**(2026-10-15 · 사람 결정 · REQ-API-312). 남은 임포트 값은 지우지 않고 「출처: 임포트」로
 * 표시한다 — 그 표시가 참이려면 파생이 값을 쓰는 이 자리에서 `impl_status_source` 를 `derived` 로 바꿔야 한다. 출처를
 * `import` 로 두는 자리는 임포터가 새 요구사항을 만들 때 하나뿐이다. 읽는 쪽은 열을 그대로 돌려줄 뿐 다시 판정하지 않는다.
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
  // 낡은 증적(`stale` — 가리키는 대상이 사라졌다)은 세지 않는다(2026-09-26 · spec-workflow §1.3).
  // 지금 그 값을 세우는 것은 임포터의 경로 실존 검사뿐이고(REQ-IMP-032) 그 증적은 스펙 버전에
  // 붙어 여기 들지 않는다 — 요구사항·작업의 증적을 판정하는 쪽이 생기면 파생이 알아서 `in_progress` 를 낸다
  return sql`EXISTS (
    SELECT 1 FROM evidence e
     WHERE (e.requirement_id = ${ref}
            OR e.task_id IN (SELECT t.id FROM task t
                              WHERE t.source_requirement_id = ${ref} AND t.archived_at IS NULL))
       AND NOT e.stale
  )`;
}

/** 서명된 `test` 증적 — 언제 서명했든(`reverifyRequiredSql` 이 옛 서명을 알아보는 데 쓴다). */
function signedEvidenceSql(reqAlias: string, currentOnly: boolean): SQL {
  const ref = sql.raw(`${reqAlias}.id`);
  const changedAt = sql.raw(`${reqAlias}.statement_changed_at`);
  return sql`EXISTS (
    SELECT 1 FROM evidence e
     WHERE (e.requirement_id = ${ref}
            OR e.task_id IN (SELECT t.id FROM task t
                              WHERE t.source_requirement_id = ${ref} AND t.archived_at IS NULL))
       AND e.kind = 'test' AND e.verified_by IS NOT NULL AND NOT e.stale
       ${currentOnly ? sql`AND (${changedAt} IS NULL OR e.created_at >= ${changedAt})` : sql``}
  )`;
}

/**
 * 검증 증적 — QA·admin 이 **지금 문장에** 서명한 `test` 증적이 있는가(`verified` 의 첫째 조건).
 *
 * **서명은 그 문장에 대한 것이다**(2026-09-26 사람 결정 · REQ-API-190). 문장이 바뀐 뒤
 * (`statement_changed_at`)보다 앞선 서명은 지금 문장을 보증하지 않는다 — 요구사항 관리 도구들이
 * 판정을 내용에 묶어, 위쪽이 바뀌면 아래쪽 링크를 의심으로 되돌리는 것과 같은 규율이다.
 */
export function verifiedEvidenceSql(reqAlias = 'r'): SQL {
  return signedEvidenceSql(reqAlias, true);
}

/**
 * **다시 검증 필요** — 서명된 test 증적이 있는데 모두 지금 문장보다 앞선다(2026-09-26 · REQ-API-190).
 * 상태가 아니라 표시다: 검증이 풀린 이유를 사람에게 말하고, 사람이 다시 서명하면 사라진다.
 */
export function reverifyRequiredSql(reqAlias = 'r'): SQL {
  const changedAt = sql.raw(`${reqAlias}.statement_changed_at`);
  return sql`(${changedAt} IS NOT NULL AND ${signedEvidenceSql(reqAlias, false)}
             AND NOT ${signedEvidenceSql(reqAlias, true)})`;
}

/**
 * 문장 비교의 정규형 — 공백과 서식 기호를 뺀다. 오타가 아닌 서식 정리로 서명이 풀리지 않게
 * 한다(Jama 가 필드 단위로, DOORS 가 "Affects Link Validity" 로 무효화할 변경을 거르는 것과 같다).
 */
export function normalizedStatementSql(expr: SQL): SQL {
  return sql`regexp_replace(${expr}, '[[:space:]*_~\`]+', '', 'g')`;
}

/**
 * **증적 결손** — `implemented` 라고 했는데 증적이 없다(spec-workflow §5.5 산식 셋째 줄).
 *
 * 커버리지의 수(`evidence_missing`)와 요구사항 행의 표시가 **같은 술어**를 쓴다(2026-10-15 · REQ-API-313). 드릴다운이 그
 * 수를 눌러 연 목록과 수가 서로 다른 말을 하면 사람은 어느 쪽도 믿지 못한다.
 */
export function evidenceMissingSql(reqAlias = 'r'): SQL {
  const status = sql.raw(`${reqAlias}.impl_status`);
  return sql`(${status} = 'implemented' AND NOT ${evidenceExistsSql(reqAlias)})`;
}

/**
 * **빈 약속** — 아직 구현되지 않았는데 맡은 작업이 하나도 없다(§5.5 산식 넷째 줄). 보관한 작업만 남은 요구사항도 빈 약속이다
 * (REQ-API-286). 커버리지의 수(`empty_promises`)와 요구사항 행의 표시가 같은 술어를 쓴다(REQ-API-313).
 */
export function emptyPromiseSql(reqAlias = 'r'): SQL {
  const ref = sql.raw(`${reqAlias}.id`);
  const status = sql.raw(`${reqAlias}.impl_status`);
  return sql`(${status} = 'unimplemented'
              AND NOT EXISTS (SELECT 1 FROM task t
                               WHERE t.source_requirement_id = ${ref} AND t.archived_at IS NULL))`;
}

/**
 * **`verified` 의 셋째 조건 — 커밋 범위에 열린 critical 이 없다**(2026-10-15 · Phase 2 E15-S03 · REQ-API-315).
 *
 * 예전 조건은 "그 요구사항에 열린 critical 0" 이었다. 그러면 리뷰가 본 커밋 뒤에 새 커밋이 와도 검증이 서고(리뷰가 본
 * 적 없는 코드), 반대로 이미 고친 커밋의 리뷰에서 다시 보이지 않은 옛 발견이 열린 채 남아 있으면 검증이 서지 못했다.
 * 정본(spec-workflow §1.3)이 적은 "해당 커밋 범위" 는 **파생 작업의 최신 커밋을 본 리뷰 라운드**다 — done 게이트의
 * 커밋 신선도와 같은 커밋 · 같은 규칙이다(`commit-scope.ts` · REQ-API-314).
 *
 * 작업마다 셋 중 하나다. ① 커밋을 알고 그 커밋을 본 라운드가 있다 → 그 라운드에서 관찰된 열린 critical 이 없고 도는
 * 세션이 없어야 한다. ② 커밋을 알고 앞 커밋의 라운드만 있다(앞 라운드가 커밋 모양) → 리뷰가 본 뒤에 새 커밋이 왔으니
 * 검증되지 않는다. ③ 커밋을 모르거나 리뷰가 없거나 앞 라운드가 본 것이 커밋 모양이 아니다 → 견줄 수 없다. 커밋 범위로
 * 본 작업(①②)이 하나라도 있으면 그것들로 판정하고, 하나도 없으면 **예전처럼 요구사항 단위로 본다** — 리뷰를 쓰지 않는
 * 프로젝트의 검증이 이 조건 때문에 막히지 않는다.
 */
export function commitScopeClearSql(reqAlias = 'r'): SQL {
  const ref = sql.raw(`${reqAlias}.id`);
  const atHead = sql`rs.task_id = t.id AND ${sameCommitSql(sql`rs.head_sha`, sql`h.sha`)}`;
  const scoped = sql`
    SELECT x.at_head, x.blocked
      FROM task t
     CROSS JOIN LATERAL (SELECT ${latestTaskCommitSql(sql`t.id`)} AS sha) h
     CROSS JOIN LATERAL (
       SELECT EXISTS (SELECT 1 FROM review_session rs WHERE ${atHead}) AS at_head,
              (EXISTS (SELECT 1 FROM review_session rs WHERE ${atHead} AND rs.state = 'running')
               OR EXISTS (SELECT 1 FROM review_session rs
                            JOIN finding_occurrence o ON o.review_session_id = rs.id
                            JOIN finding f ON f.id = o.finding_id
                           WHERE ${atHead} AND f.status = 'open' AND f.severity = 'critical')) AS blocked,
              (SELECT rs.head_sha FROM review_session rs WHERE rs.task_id = t.id
                ORDER BY rs.created_at DESC, rs.id DESC LIMIT 1) AS last_head
     ) x
     WHERE t.source_requirement_id = ${ref} AND t.archived_at IS NULL AND h.sha IS NOT NULL
       AND (x.at_head OR coalesce(${commitShapedSql(sql`x.last_head`)}, false))`;
  return sql`(CASE WHEN EXISTS (${scoped})
                   THEN NOT EXISTS (SELECT 1 FROM (${scoped}) s WHERE NOT s.at_head OR s.blocked)
                   ELSE NOT ${openCriticalSql(reqAlias)}
              END)`;
}

/** 열린 critical 발견 — 있으면 검증됐다고 말할 수 없다(`verified` 의 둘째 조건 · 커밋을 모를 때). */
export function openCriticalSql(reqAlias = 'r'): SQL {
  const ref = sql.raw(`${reqAlias}.id`);
  return sql`EXISTS (
    SELECT 1 FROM finding f
     WHERE f.requirement_id = ${ref} AND f.severity = 'critical' AND f.status = 'open'
  )`;
}

export async function recomputeImplStatus(db: Queryable, requirementId: string): Promise<void> {
  // **보관한 작업은 세지 않는다**(2026-10-10 · REQ-API-286). 보관은 상태를 그대로 두므로, 세면 보관한 `in_review` 작업이
  // 요구사항을 `in_progress` 에 붙잡고 보관한 backlog 작업이 `implemented` 를 영영 막는다. 작업이 모두 보관됐으면
  // 작업이 하나도 없는 요구사항처럼 손대지 않는다(아래 가드) — 임포트가 정한 값을 중복 하나 보관한 일로 지우지 않는다
  const next = sql`(
         CASE
           WHEN EXISTS (
             SELECT 1 FROM task t
              WHERE t.source_requirement_id = r.id AND t.archived_at IS NULL
                AND t.status IN ('claimed', 'in_progress', 'in_review')
           ) THEN 'in_progress'
           WHEN NOT EXISTS (
             SELECT 1 FROM task t
              WHERE t.source_requirement_id = r.id AND t.status <> 'done' AND t.archived_at IS NULL
           ) AND ${evidenceExistsSql()}
             AND ${verifiedEvidenceSql()}
             AND ${commitScopeClearSql()} THEN 'verified'
           WHEN NOT EXISTS (
             SELECT 1 FROM task t
              WHERE t.source_requirement_id = r.id AND t.status <> 'done' AND t.archived_at IS NULL
           ) AND ${evidenceExistsSql()} THEN 'implemented'
           WHEN EXISTS (
             SELECT 1 FROM task t WHERE t.source_requirement_id = r.id AND t.status = 'done'
           ) THEN 'in_progress'
           ELSE 'unimplemented'
         END
       )::impl_status`;
  await db.execute(sql`
    UPDATE requirement r
       SET impl_status = ${next},
           -- 파생이 쓴 값이다 — 임포트 값이 이 자리에서 끝난다(REQ-API-312)
           impl_status_source = 'derived',
           -- 검증된 시각 — 처음 선 때를 지키고, 풀리면 비운다(REQ-API-190)
           verified_at = CASE WHEN ${next} = 'verified' THEN coalesce(r.verified_at, now()) END
     WHERE r.id = ${requirementId}
       -- 한번 선 검증은 내리지 않는다 — **문장이 바뀌어 지금 문장의 서명이 없을 때만** 다시
       -- 파생한다(2026-09-26 사람 결정). 발견이 열린 것으로는 풀리지 않는다(REQ-API-141)
       AND (r.impl_status <> 'verified'
            OR (r.statement_changed_at IS NOT NULL AND NOT ${verifiedEvidenceSql()}))
       -- 살아 있는 작업이 하나는 있어야 다시 파생한다 — 보관한 작업만 남았으면 작업이 없는 요구사항과 같다
       AND EXISTS (SELECT 1 FROM task t
                    WHERE t.source_requirement_id = r.id AND t.archived_at IS NULL)
  `);
}
