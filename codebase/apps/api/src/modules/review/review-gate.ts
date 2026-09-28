// 리뷰 게이트 판정 — 라운드 하나가 통과했는가 (2026-09-28 · clemvion 요청 N1 · 사람 결정 D1 · D2 · REQ-API-247)
//
// **라운드는 (브랜치 · 종류 · head_sha) 가 같은 리뷰 세션의 묶음이다.** 같은 커밋을 리뷰어 여럿이 따로 제출하면
// 세션이 여럿이 되고, 그 셋이 모두 끝나야 그 커밋의 리뷰가 끝난 것이다. 라운드의 발견은 그 세션들에서
// **관찰된** 발견(`finding_occurrence`)이다 — `finding.last_session_id` 로 고르면 다음 라운드에서 다시 보인
// 발견이 앞 라운드에서 빠진다.
//
// **passed 의 정의**(D2 = B · 3.3 data-model): 라운드의 세션이 모두 끝났고(`complete`), 라운드에서 관찰된 발견
// 가운데 열린 critical · warning 이 0 이다. info 는 막지 않고 수만 준다. 집행(push 훅 · CI)에 써도 되는 판정이다 —
// 표시용인 게이트 현황(EP-REV-04)과 기준이 다르므로 경로를 나눴다(D1).
//
// 판정은 여기 한 곳이다. done 게이트의 종류 조건(N6)도 이 함수를 쓴다.

import { GATE_ROUND_FINDINGS_LIMIT } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { sqlArray } from '../../common/sql-array.js';
import type { NervDb } from '../../common/database.module.js';

export type GateState = 'uncovered' | 'pending' | 'passed';
export type GateReason = 'running' | 'failed' | 'open_critical' | 'open_warning';

export interface RoundFinding {
  id: string;
  severity: string;
  title: string;
  status: string;
  resolution: { kind: string; commit_sha: string | null; resolved_at: string } | null;
}

export interface RoundVerdict {
  kind: string;
  state: GateState;
  round_no: number | null;
  base_sha: string | null;
  head_sha: string | null;
  /** 라운드의 세션이 모두 끝난 때 — 하나라도 돌고 있으면 null */
  completed_at: string | null;
  reasons: GateReason[];
  open: { critical: number; warning: number; info: number };
  findings: RoundFinding[];
  findings_total: number;
}

type Executor = Pick<NervDb, 'execute'>;

/**
 * 종류마다 **가장 최근에 만든 세션의 커밋**이 그 종류의 최신 라운드다. `headSha` 를 주면 그 커밋의 라운드만 본다.
 * `kinds` 에 있는데 라운드가 없는 종류는 `uncovered` 행이 된다 — 없는 것을 빼 버리면 "통과" 와 구분되지 않는다.
 */
export async function roundVerdicts(
  db: Executor,
  input: {
    projectId: string;
    branch: string;
    kinds: readonly string[] | null;
    headSha: string | null;
  },
): Promise<RoundVerdict[]> {
  const kindFilter: SQL =
    input.kinds === null ? sql`` : sql` AND rs.kind::text = ANY(${sqlArray(input.kinds, 'text')})`;
  const headFilter: SQL = input.headSha === null ? sql`` : sql` AND rs.head_sha = ${input.headSha}`;
  const { rows: rounds } = await db.execute<{
    kind: string;
    head_sha: string;
    round_no: number;
    base_sha: string;
    running: boolean;
    failed: boolean;
    completed_at: unknown;
    session_ids: string[];
  }>(sql`
    WITH scoped AS (
      SELECT rs.id, rs.kind::text AS kind, rs.head_sha, rs.base_sha, rs.round_no, rs.state::text AS state,
             rs.completed_at, rs.created_at
        FROM review_session rs
       WHERE rs.project_id = ${input.projectId} AND rs.branch = ${input.branch}${kindFilter}${headFilter}
    ),
    latest AS (
      SELECT DISTINCT ON (kind) kind, head_sha FROM scoped ORDER BY kind, created_at DESC, id DESC
    )
    SELECT s.kind, l.head_sha,
           max(s.round_no)::int AS round_no,
           (array_agg(s.base_sha ORDER BY s.created_at DESC, s.id DESC))[1] AS base_sha,
           bool_or(s.state = 'running') AS running,
           bool_or(s.state = 'failed') AS failed,
           CASE WHEN bool_or(s.state = 'running') THEN NULL ELSE max(s.completed_at) END AS completed_at,
           array_agg(s.id::text) AS session_ids
      FROM scoped s JOIN latest l ON l.kind = s.kind AND l.head_sha = s.head_sha
     GROUP BY s.kind, l.head_sha
     ORDER BY s.kind
  `);

  const verdicts = new Map<string, RoundVerdict>();
  for (const round of rounds) {
    const { rows: counts } = await db.execute<{ severity: string; n: number }>(sql`
      SELECT f.severity::text AS severity, count(DISTINCT f.id)::int AS n
        FROM finding_occurrence o JOIN finding f ON f.id = o.finding_id
       WHERE o.review_session_id = ANY(${sqlArray(round.session_ids, 'uuid')}) AND f.status = 'open'
       GROUP BY f.severity
    `);
    const open = { critical: 0, warning: 0, info: 0 };
    for (const c of counts) {
      if (c.severity === 'critical' || c.severity === 'warning' || c.severity === 'info') {
        open[c.severity] = c.n;
      }
    }
    // **막는 발견이 먼저다**(열린 critical · warning) — 상한에 걸려도 막는 것은 잘리지 않게. 그다음은 무거운 순서다
    const { rows: found } = await db.execute<{
      id: string;
      severity: string;
      title: string;
      status: string;
      resolution_kind: string | null;
      commit_sha: string | null;
      resolved_at: unknown;
      total: number;
    }>(sql`
      WITH seen AS (
        SELECT DISTINCT f.id, f.severity, f.title, f.status, f.created_at
          FROM finding_occurrence o JOIN finding f ON f.id = o.finding_id
         WHERE o.review_session_id = ANY(${sqlArray(round.session_ids, 'uuid')})
      )
      SELECT s.id, s.severity::text AS severity, s.title, s.status::text AS status,
             r.kind::text AS resolution_kind, r.commit_sha, r.created_at AS resolved_at,
             count(*) OVER ()::int AS total
        FROM seen s
   LEFT JOIN LATERAL (SELECT kind, commit_sha, created_at FROM resolution
                       WHERE finding_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1) r ON true
       ORDER BY (s.status = 'open' AND s.severity IN ('critical', 'warning')) DESC,
                s.severity, (s.status = 'open') DESC, s.created_at, s.id
       LIMIT ${GATE_ROUND_FINDINGS_LIMIT}
    `);
    const reasons: GateReason[] = [];
    if (round.running) reasons.push('running');
    if (round.failed) reasons.push('failed');
    if (open.critical > 0) reasons.push('open_critical');
    if (open.warning > 0) reasons.push('open_warning');
    verdicts.set(round.kind, {
      kind: round.kind,
      state: reasons.length === 0 ? 'passed' : 'pending',
      round_no: round.round_no,
      base_sha: round.base_sha,
      head_sha: round.head_sha,
      completed_at: isoOrNull(round.completed_at),
      reasons,
      open,
      findings: found.map((f) => ({
        id: f.id,
        severity: f.severity,
        title: f.title,
        status: f.status,
        resolution:
          f.resolution_kind === null
            ? null
            : {
                kind: f.resolution_kind,
                commit_sha: f.commit_sha,
                resolved_at: isoOrNull(f.resolved_at) ?? '',
              },
      })),
      findings_total: found[0]?.total ?? 0,
    });
  }

  for (const kind of input.kinds ?? []) {
    if (verdicts.has(kind)) continue;
    verdicts.set(kind, {
      kind,
      state: 'uncovered',
      round_no: null,
      base_sha: null,
      head_sha: input.headSha,
      completed_at: null,
      reasons: [],
      open: { critical: 0, warning: 0, info: 0 },
      findings: [],
      findings_total: 0,
    });
  }
  return [...verdicts.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}
