// 커밋 범위 — 작업의 최신 커밋과 리뷰 라운드가 본 커밋을 맞춘다
// (2026-10-15 · Phase 2 E16-S01 · E15-S03 · api.md REQ-API-314 · 315)
//
// **판정은 여기 한 곳이다**(D-05). done 게이트의 커밋 신선도와 구현 축의 `verified`(커밋 범위)가 같은 커밋을 같은
// 규칙으로 본다. 둘이 다른 커밋을 보면 작업은 닫혔는데 요구사항은 검증되지 못하거나 그 반대가 된다.
//
// **작업의 최신 커밋은 서버가 가장 나중에 받은 `commit` 증적이다.** 서버는 git 의 커밋 그래프를 갖고 있지 않다 — 증적에는
// SHA 만 있고 커밋 시각도 부모도 없다. 그래서 받은 순서(`created_at`, 같으면 `id` — UUIDv7 이라 넣은 순서)를 쓴다. push
// 웹훅의 `after` 와 에이전트 · 사람이 전이에 붙이는 커밋이 모두 이 표에 들어간다. 커밋 시각(`committer date`)은 rebase 가
// 바꾸므로 순서의 근거로 쓰지 않는다(spec-workflow §5.4 — clemvion 이 rewrite-immune 시계를 따로 만든 이유다). 웹훅이 같은
// SHA 를 다시 보내면 새 행이 생기지 않아(재전송 dedup) 옛 push 의 재전송이 최신을 바꾸지 않는다. 순서가 틀렸으면(늦게 온
// 옛 push) done 에 지금 커밋을 증적으로 붙이면 된다 — 새 행이 곧 최신이다.
//
// **같은 커밋인가**는 대소문자를 가리지 않고, 둘 다 커밋 모양이면 짧은 SHA(7자 이상)가 긴 SHA 의 앞부분일 때도 같다.
// 에이전트는 짧은 SHA(`git log --oneline`)를, 웹훅은 40자를 준다 — 문자열이 같을 때만 같다고 하면 같은 커밋의 리뷰가
// "새 커밋 뒤" 로 막힌다.

import { checkEvidenceLocator, COMMIT_SHA_PATTERN } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';

type Executor = Pick<NervDb, 'execute'>;

/** 작업의 최신 커밋 — 값 하나를 내는 서브쿼리다(없으면 NULL). 낡은 증적(`stale`)은 세지 않는다 */
export function latestTaskCommitSql(taskId: SQL): SQL {
  return sql`(SELECT btrim(e.locator) FROM evidence e
               WHERE e.task_id = ${taskId} AND e.kind = 'commit' AND NOT e.stale
               ORDER BY e.created_at DESC, e.id DESC
               LIMIT 1)`;
}

/** 값이 커밋 SHA 모양인가 — 증적 형식 검사(`checkEvidenceLocator`)와 같은 정규식이다 */
export function commitShapedSql(expr: SQL): SQL {
  return sql`((${expr})::text ~* ${COMMIT_SHA_PATTERN}::text)`;
}

/** 두 값이 같은 커밋인가 — 대소문자 무시, 둘 다 커밋 모양이면 짧은 쪽이 긴 쪽의 앞부분이어도 같다 */
export function sameCommitSql(left: SQL, right: SQL): SQL {
  const l = sql`lower((${left})::text)`;
  const r = sql`lower((${right})::text)`;
  return sql`(${l} = ${r}
              OR (${commitShapedSql(left)} AND ${commitShapedSql(right)}
                  AND (starts_with(${l}, ${r}) OR starts_with(${r}, ${l}))))`;
}

/** 값이 커밋 SHA 모양인가 — `commitShapedSql` 의 TS 쪽(같은 정규식) */
export function isCommitSha(value: string): boolean {
  return checkEvidenceLocator('commit', value).ok;
}

/** 작업의 최신 커밋 — 모르면 `null`(그 작업에 `commit` 증적이 없다) */
export async function latestTaskCommit(db: Executor, taskId: string): Promise<string | null> {
  const { rows } = await db.execute<{ sha: string | null }>(
    sql`SELECT ${latestTaskCommitSql(sql`${taskId}`)} AS sha`,
  );
  return rows[0]?.sha ?? null;
}

/**
 * 그 작업의 리뷰가 **가장 최근에 본 커밋**. 신선도 판정이 "그 커밋의 라운드는 없는데 앞 커밋의 라운드는 있는가" 를 묻는 데
 * 쓴다. `kinds` 를 주면 종류마다 하나씩(종류 목록 조건), 주지 않으면 종류와 상관없이 하나다(`review_coverage: true` — 그때는
 * 끝난 세션만 본다. 그 조건이 도는 세션을 세지 않기 때문이다).
 */
export async function latestRoundHeads(
  db: Executor,
  input: { projectId: string; taskId: string; kinds: readonly string[] | null },
): Promise<Map<string | null, string>> {
  const heads = new Map<string | null, string>();
  if (input.kinds === null) {
    const { rows } = await db.execute<{ head_sha: string }>(sql`
      SELECT rs.head_sha FROM review_session rs
       WHERE rs.project_id = ${input.projectId} AND rs.task_id = ${input.taskId} AND rs.state <> 'running'
       ORDER BY rs.created_at DESC, rs.id DESC
       LIMIT 1
    `);
    if (rows[0] !== undefined) heads.set(null, rows[0].head_sha);
    return heads;
  }
  if (input.kinds.length === 0) return heads;
  const { rows } = await db.execute<{ kind: string; head_sha: string }>(sql`
    SELECT DISTINCT ON (rs.kind) rs.kind::text AS kind, rs.head_sha
      FROM review_session rs
     WHERE rs.project_id = ${input.projectId} AND rs.task_id = ${input.taskId}
       AND rs.kind::text IN (${sql.join(
         input.kinds.map((k) => sql`${k}`),
         sql`, `,
       )})
     ORDER BY rs.kind, rs.created_at DESC, rs.id DESC
  `);
  for (const row of rows) heads.set(row.kind, row.head_sha);
  return heads;
}
