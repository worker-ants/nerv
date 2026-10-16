// 규약 스펙 — `nerv_bootstrap` 의 접은 목록(REQ-API-277)과 AGENTS.md(EP-PRJ-06 · REQ-API-326)가 같은 질의를 본다
//
// 규약은 종류가 `convention` · `vision` 인 스펙이다. 세션이 첫 호출로 받는 목록과 저장소의 AGENTS.md 가 고르는 규약이
// 다르면, 같은 프로젝트에서 에이전트가 어디서 읽느냐에 따라 다른 규약을 안다 — 그래서 질의를 한 곳에 둔다(D-05).

import { CONVENTIONS_LIMIT } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';

/** bootstrap 규약 목록의 한 줄 — 본문은 담지 않는다. 읽을 때는 `nerv_spec_get`(`spec_id`=키) */
export interface ConventionSummary extends Record<string, unknown> {
  key: string;
  title: string;
  type: string;
  /** 이 규약 밑에 접힌 하위 규약 수 — 규약에서 규약으로 이어지는 하위 전부다. 비전은 접지 않으므로 0 이다 */
  descendants: number;
}

/** 접은 목록의 한 줄에 지금 승인본의 번호를 더한 것 — AGENTS.md 가 쓴다. bootstrap 은 이 칸을 빼고 준다 */
export interface ConventionRow extends ConventionSummary {
  /** 지금 승인본의 번호 — 승인본이 없으면 null */
  approved_version_no: number | null;
}

/**
 * 규약 스펙의 **접은 목록** — 하위 트리의 꼭대기(부모가 없거나, 규약이 아니거나, 보관된 규약인 것)만 `CONVENTIONS_LIMIT`
 * 건까지 담고, 접힌 하위 규약의 수를 `descendants` 로 준다(2026-10-10 · clemvion 보고 · 사람 결정 C1 · REQ-API-277).
 *
 * **접는 이유.** 전부 담았더니 clemvion 은 API 카탈로그 사본 272편(`CLE-C24-*` · `CLE-MKS-*`)이 `convention` 이라 응답이
 * 약 45KB 였고, 세션이 만료될 때마다 다시 부르며 그만큼 컨텍스트가 늘었다. 카탈로그는 하위 트리라서 꼭대기 한 줄로 접으면
 * 일반 규약은 그대로 보인다. 하위 트리가 아니어도 크기는 상한이 막는다. 비전은 접지 않는다 — 모든 영역이 그 밑에 있다.
 * 전체 수도 **같은 문장에서** 센다 — 두 문장으로 나누면 그 사이의 쓰기가 잘림을 꾸미거나 감춘다.
 */
export async function foldedConventions(
  db: NervDb,
  projectId: string,
): Promise<{ items: ConventionRow[]; total: number }> {
  const { rows } = await db.execute<ConventionRow & { total: number }>(sql`
    WITH RECURSIVE conv AS (
      SELECT id, parent_id, key, title, type::text AS type, sort_key FROM spec
       WHERE project_id = ${projectId} AND archived_at IS NULL
         AND type IN ('convention', 'vision')
    ),
    top AS (
      SELECT c.* FROM conv c
       WHERE c.type = 'vision'
          OR NOT EXISTS (SELECT 1 FROM conv p WHERE p.id = c.parent_id AND p.type = 'convention')
    ),
    folded AS (
      SELECT t.id AS top_id, c.id FROM top t
        JOIN conv c ON c.parent_id = t.id AND c.type = 'convention'
       WHERE t.type = 'convention'
      UNION ALL
      SELECT f.top_id, c.id FROM folded f
        JOIN conv c ON c.parent_id = f.id AND c.type = 'convention'
    )
    SELECT t.key, t.title, t.type,
           (SELECT count(*)::int FROM folded f WHERE f.top_id = t.id) AS descendants,
           (SELECT max(v.version_no)::int FROM spec_version v
             WHERE v.spec_id = t.id AND v.status = 'approved') AS approved_version_no,
           (SELECT count(*)::int FROM conv) AS total
      FROM top t
     ORDER BY (t.type = 'vision') DESC, t.sort_key, t.key
     LIMIT ${CONVENTIONS_LIMIT}
  `);
  // 꼭대기가 없으면 규약도 없다 — 비전은 언제나 꼭대기이고, 규약은 꼭대기 아니면 꼭대기의 하위다
  return {
    items: rows.map(({ total: _total, ...row }) => row),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * 규약 버전의 재료 — 보관되지 않은 규약 스펙 **전부**(접힌 하위 규약 포함)의 키 · 종류 · 제목 · 부모 키 · 승인 버전 번호.
 * 키 순서로 준다. 초안은 들어가지 않는다 — 승인된 것만 규약이다.
 */
export async function conventionFingerprintRows(
  db: NervDb,
  projectId: string,
): Promise<
  { key: string; type: string; title: string; parent: string | null; approved: number | null }[]
> {
  const { rows } = await db.execute<{
    key: string;
    type: string;
    title: string;
    parent: string | null;
    approved: number | null;
  }>(sql`
    SELECT s.key, s.type::text AS type, s.title, p.key AS parent,
           (SELECT max(v.version_no)::int FROM spec_version v
             WHERE v.spec_id = s.id AND v.status = 'approved') AS approved
      FROM spec s
      LEFT JOIN spec p ON p.id = s.parent_id
     WHERE s.project_id = ${projectId} AND s.archived_at IS NULL
       AND s.type IN ('convention', 'vision')
     ORDER BY s.key COLLATE "C"
  `);
  return rows;
}
