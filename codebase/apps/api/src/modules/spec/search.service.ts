// 하이브리드 검색 — ID 직행 · 렉시컬(FTS+trgm) · 벡터(HNSW) · RRF 병합 · 관계 확장 (E09-S10)
// 정본: api.md §2.2b(REQ-API-025·026) · database.md §2.12(REQ-DB-016)
//
// **검색 방식은 서버 내부 판정이다** — 표면 계약에 모드 선택 파라미터가 없다. REST 로 부르든
// MCP 로 부르든 같은 코드가 같은 순서로 돌고 같은 순위를 낸다(D-05). 에이전트와 사람이 다른
// 검색 결과를 보면 "같은 문서를 봤다"는 협업의 전제가 깨진다.
//
// 이 파이프라인의 주 소비자는 사람이 아니라 에이전트다 — `nerv_spec_search` 는 P0 도구이고
// 호출 시점이 "컨텍스트 수집·중복 확인"이다. 검색 품질이 곧 중복 스펙 방지(FR-01) 품질이다.

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { specType, specVersionStatus } from '@nerv/schema';
import { InjectDb } from '../../common/database.module.js';
import { assertVocab } from '../../common/query-vocab.js';
import type { NervDb } from '../../common/database.module.js';
import { EmbeddingClient } from './embedding.client.js';

/** RRF 상수 — 순위 역수 합의 완충항. 60 은 원논문 기본값이고 여기서 튜닝 대상이 아니다. */
const RRF_K = 60;

/** 문서 상태 부스트 — 승인된 문서가 초안보다 위다(같은 순위대에서만 갈린다). */
const STATUS_BOOST: Record<string, number> = {
  approved: 0.03,
  in_review: 0.015,
  draft: 0,
  superseded: -0.01,
  deprecated: -0.02,
};

const STABLE_ID_RE = /\b(SPC|REQ|TSK)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i;

export interface SearchHit extends Record<string, unknown> {
  spec_id: string;
  key: string;
  title: string;
  type: string;
  doc_status: string | null;
  anchor: string | null;
  snippet: string;
  score: number;
  /** 이 결과가 어느 경로로 들어왔나 — 디버깅이 아니라 신뢰의 문제다 */
  matched_by: string[];
}

export interface SearchResult extends Record<string, unknown> {
  items: SearchHit[];
  /** 상위 결과의 1-hop 관계 확장 — 본 랭킹에 섞지 않는다(§2.2b ⑤) */
  related: Record<string, unknown>[];
  degraded: string | null;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly embedding = EmbeddingClient.fromEnv();

  constructor(@InjectDb() private readonly db: NervDb) {}

  async search(input: {
    projectId: string;
    query: string;
    limit?: number;
    includeArchived?: boolean;
    /** 이 스펙을 참조하는 문서만 — 역참조 필터(EP-SPEC-02) */
    references?: string | null;
    /**
     * 문서 종류·상태로 좁힌다 — **전표가 처음부터 적고 있던 필터다**(EP-SPEC-02 ·
     * 2026-09-05 배선). 두 표면 어디에도 없어서, 이 인자를 보낸 쪽은 걸러지지 않은
     * 전체를 받고도 걸러졌다고 믿었다.
     *
     * 쉼표 목록이고 서로 AND 다 — `nerv_spec_tree` 와 같은 표기·같은 판정을 쓴다.
     * 어휘 밖 값은 **거절이지 무시가 아니다**(REQ-API-074).
     */
    types?: readonly string[] | null;
    statuses?: readonly string[] | null;
  }): Promise<SearchResult> {
    const query = input.query.trim();
    const limit = Math.min(input.limit ?? 10, 50);
    if (query === '') return { items: [], related: [], degraded: null };

    // ① ID 직행 — 안정 ID 는 전문 검색을 거치지 않는다. 사람도 에이전트도 ID 를 칠 때는
    //    "찾아줘"가 아니라 "열어줘"라는 뜻이다.
    const direct = await this.byStableId(input.projectId, query);

    // ② 렉시컬 — FTS(영문·ID 토큰) + trgm(한국어 조사 변형). 둘은 서로의 사각을 덮는다.
    const lexical = await this.lexical(input.projectId, query, limit * 3, input.includeArchived);

    // ③ 벡터 — 무응답이면 건너뛴다. 검색은 조정 경로가 아니라 fail-open 이 맞다(D-14의 정신).
    const vectors = await this.embedding.embedOrNull([query]);
    const degraded = vectors === null ? 'lexical-only' : null;
    const semantic =
      vectors === null || vectors[0] === undefined
        ? []
        : await this.vector(input.projectId, vectors[0], limit * 3, input.includeArchived);

    // ④ RRF 병합 — 점수 정규화 없이 **순위만** 쓴다. 렉시컬 점수와 코사인 거리는 단위가 달라
    //    가중합이 성립하지 않는다. 순위 역수 합은 그 비교를 아예 피한다.
    const merged = this.rrf([direct, lexical, semantic]);

    // **자르기 전에 거른다.** 뒤에서 거르면 요청한 limit 보다 적게 나오고, 그 부족분이
    // "더 없다" 로 읽힌다 — 종류·상태는 이미 실려 온 값이라 여기서 판정할 수 있다.
    // 어휘의 정본은 `@nerv/schema` 의 enum 이다(목록을 여기 다시 적지 않는다).
    const types =
      input.types == null || input.types.length === 0
        ? null
        : assertVocab([...input.types], specType.enumValues, 'type');
    const statuses =
      input.statuses == null || input.statuses.length === 0
        ? null
        : assertVocab([...input.statuses], specVersionStatus.enumValues, 'status');
    const narrowed = merged.filter(
      (hit) =>
        (types === null || types.includes(hit.type)) &&
        // 버전이 없는 노드(임포터의 골격 배치)는 문서 상태가 없다 — 상태로 거르면 빠진다
        (statuses === null || (hit.doc_status !== null && statuses.includes(hit.doc_status))),
    );

    let items = narrowed.slice(0, limit);
    if (input.references != null && input.references !== '') {
      items = await this.filterByReference(input.projectId, items, input.references);
    }

    // ⑤ 관계 확장 — 별도 그룹이다. "언급되지 않았지만 걸려 있는 스펙"을 에이전트가 컨텍스트에
    //    넣을 수 있게 하되, 질의 일치가 아니므로 본 랭킹에는 섞지 않는다.
    const related = await this.expandRelations(
      input.projectId,
      items.map((i) => i.spec_id),
    );

    return { items, related, degraded };
  }

  // ── 단계별 ────────────────────────────────────────────────────────────────

  private async byStableId(projectId: string, query: string): Promise<SearchHit[]> {
    const match = STABLE_ID_RE.exec(query);
    if (match === null) return [];
    const id = match[0].toUpperCase();

    const { rows } = await this.db.execute<SearchHit>(sql`
      SELECT s.id AS spec_id, s.key, s.title, s.type::text AS type,
             sv.status::text AS doc_status, NULL::text AS anchor,
             left(coalesce(sv.body_md, ''), 200) AS snippet
        FROM spec s
   LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE s.project_id = ${projectId} AND s.key = ${id}
       UNION ALL
      SELECT s.id, s.key, s.title, s.type::text, sv.status::text, r.ref AS anchor,
             r.statement_md AS snippet
        FROM requirement r
        JOIN spec s ON s.id = r.spec_id
   LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE r.project_id = ${projectId} AND r.ref = ${id} AND r.removed_in_version_id IS NULL
    `);
    return rows.map((r) => ({ ...r, score: 1, matched_by: ['id'] }));
  }

  private async lexical(
    projectId: string,
    query: string,
    limit: number,
    includeArchived?: boolean,
  ): Promise<SearchHit[]> {
    const archived = includeArchived === true ? sql`` : sql` AND s.archived_at IS NULL`;
    const { rows } = await this.db.execute<SearchHit & { rank: number }>(sql`
      WITH scored AS (
        SELECT s.id AS spec_id, s.key, s.title, s.type::text AS type,
               sv.status::text AS doc_status, NULL::text AS anchor,
               left(coalesce(sv.body_md, ''), 240) AS snippet,
               GREATEST(
                 ts_rank(to_tsvector('simple', coalesce(sv.body_md, '')), plainto_tsquery('simple', ${query})),
                 ts_rank(to_tsvector('simple', s.title), plainto_tsquery('simple', ${query})),
                 similarity(s.title, ${query}),
                 similarity(left(coalesce(sv.body_md, ''), 4000), ${query})
               ) AS rank
          FROM spec s
     LEFT JOIN spec_version sv ON sv.id = s.current_version_id
         WHERE s.project_id = ${projectId}${archived}
        UNION ALL
        SELECT s.id, s.key, s.title, s.type::text, sv.status::text, r.ref AS anchor,
               r.statement_md AS snippet, similarity(r.statement_md, ${query}) AS rank
          FROM requirement r
          JOIN spec s ON s.id = r.spec_id
     LEFT JOIN spec_version sv ON sv.id = s.current_version_id
         WHERE r.project_id = ${projectId} AND r.removed_in_version_id IS NULL${archived}
      )
      SELECT * FROM scored WHERE rank > 0.02 ORDER BY rank DESC LIMIT ${limit}
    `);
    return rows.map((r) => ({ ...r, score: r.rank, matched_by: ['lexical'] }));
  }

  private async vector(
    projectId: string,
    embedding: number[],
    limit: number,
    includeArchived?: boolean,
  ): Promise<SearchHit[]> {
    const archived = includeArchived === true ? sql`` : sql` AND s.archived_at IS NULL`;
    const literal = `[${embedding.join(',')}]`;
    const { rows } = await this.db.execute<SearchHit>(sql`
      SELECT DISTINCT ON (s.id)
             s.id AS spec_id, s.key, s.title, s.type::text AS type,
             sv.status::text AS doc_status, e.anchor,
             left(coalesce(sv.body_md, ''), 240) AS snippet,
             1 - (e.embedding <=> ${literal}::vector) AS score
        FROM spec_chunk_embedding e
        JOIN spec_version sv ON sv.id = e.spec_version_id
        JOIN spec s ON s.id = sv.spec_id
       WHERE s.project_id = ${projectId}${archived}
       ORDER BY s.id, e.embedding <=> ${literal}::vector
       LIMIT ${limit}
    `);
    return rows
      .map((r) => ({ ...r, matched_by: ['vector'] }))
      .sort((a, b) => Number(b.score) - Number(a.score));
  }

  /**
   * RRF — 각 랭커의 **순위**만 쓰는 결정적 병합. 같은 스펙이 여러 경로로 들어오면 합쳐지고,
   * 그때 matched_by 가 누적된다. 문서 상태 부스트는 마지막에 얹는다(같은 순위대의 타이브레이크).
   */
  private rrf(rankings: SearchHit[][]): SearchHit[] {
    const acc = new Map<string, SearchHit & { score: number }>();
    for (const ranking of rankings) {
      ranking.forEach((hit, index) => {
        const key = `${hit.spec_id}:${hit.anchor ?? ''}`;
        const contribution = 1 / (RRF_K + index + 1);
        const existing = acc.get(key);
        if (existing === undefined) {
          acc.set(key, { ...hit, score: contribution, matched_by: [...hit.matched_by] });
          return;
        }
        existing.score += contribution;
        for (const source of hit.matched_by) {
          if (!existing.matched_by.includes(source)) existing.matched_by.push(source);
        }
      });
    }
    return [...acc.values()]
      .map((hit) => ({ ...hit, score: hit.score + (STATUS_BOOST[hit.doc_status ?? ''] ?? 0) }))
      .sort((a, b) => b.score - a.score);
  }

  private async filterByReference(
    projectId: string,
    items: SearchHit[],
    referencesKey: string,
  ): Promise<SearchHit[]> {
    const { rows } = await this.db.execute<{ from_spec_id: string }>(sql`
      SELECT r.from_spec_id FROM spec_relation r
        JOIN spec target ON target.id = r.to_spec_id
       WHERE r.project_id = ${projectId} AND target.key = ${referencesKey}
    `);
    const allowed = new Set(rows.map((r) => r.from_spec_id));
    return items.filter((i) => allowed.has(i.spec_id));
  }

  private async expandRelations(
    projectId: string,
    specIds: string[],
  ): Promise<Record<string, unknown>[]> {
    if (specIds.length === 0) return [];
    const ids = sql.join(
      specIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT DISTINCT s.id AS spec_id, s.key, s.title, s.type::text AS type,
             sv.status::text AS doc_status, r.kind::text AS via_kind
        FROM spec_relation r
        JOIN spec s ON s.id = CASE WHEN r.from_spec_id IN (${ids}) THEN r.to_spec_id ELSE r.from_spec_id END
   LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE r.project_id = ${projectId}
         AND (r.from_spec_id IN (${ids}) OR r.to_spec_id IN (${ids}))
         AND s.id NOT IN (${ids})
         AND s.archived_at IS NULL
       ORDER BY s.key
       LIMIT 20
    `);
    return rows;
  }
}
