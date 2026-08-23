// spec_relation — 본문에서의 자동 추출(E09-S09) + 양방향 조회(E09-S12)
// 정본: api.md §2.2(REQ-API-024·027) · importer.md §2.4
//
// **역참조(backlink)가 1급이다.** 이 서비스가 있는 이유는 "누가 나를 참조하나"를 수정 **전에**
// 알기 위해서다 — 그것을 모르면 스펙 수정은 매번 도박이 된다. clemvion 에서 문서 간 참조는
// 사람의 기억 속에만 있었고, 그래서 폐기된 결정이 다른 문서에서 계속 살아 있었다(R-3).
//
// 추출은 임포터 링크 패스와 **같은 규칙**이다: 본문의 실존 스펙 안정 ID → `references` 관계.
// 미실존 ID 는 오류가 아니라 경고다 — 아직 안 쓴 문서를 미리 참조하는 것은 정상적인 집필 순서다.

import { Injectable } from '@nestjs/common';
import { msg, newId, NERV_ERROR } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

/** 스펙 안정 ID — `SPC-<영역>-<식별>`. 코드 블록·인라인 코드 안이어도 참조는 참조다. */
const SPEC_KEY_RE = /\bSPC-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;

export interface RelationSyncResult {
  added: string[];
  removed: string[];
  /** 본문이 참조하지만 이 프로젝트에 없는 키 — 경고로만 돌려준다(REQ-API-024) */
  unknown: string[];
}

export interface RelationEntry extends Record<string, unknown> {
  kind: string;
  direction: 'out' | 'in';
  spec_id: string;
  key: string;
  title: string;
  doc_status: string | null;
  version_no: number | null;
}

@Injectable()
export class SpecRelationService {
  constructor(@InjectDb() private readonly db: NervDb) {}

  /** 본문에서 참조 후보 키를 뽑는다 — 자기 자신은 참조가 아니다. */
  extractKeys(bodyMd: string, selfKey?: string | null): string[] {
    const found = new Set(bodyMd.match(SPEC_KEY_RE) ?? []);
    if (selfKey != null) found.delete(selfKey);
    return [...found].sort();
  }

  /**
   * REQ-API-024 — draft 저장 커밋 시 `references` 관계를 본문 기준으로 **동기화**한다.
   *
   * 추가만 하고 제거하지 않으면 관계 그래프는 한 방향으로만 자라 결국 신뢰를 잃는다.
   * 그래서 자동 추출분(`references`)은 전량 대체한다 — 사람이 손으로 넣는 `depends_on`·
   * `refines` 같은 다른 kind 는 건드리지 않는다.
   */
  async syncFromBody(
    tx: Tx,
    input: { projectId: string; specId: string; specKey: string; bodyMd: string },
  ): Promise<RelationSyncResult> {
    const keys = this.extractKeys(input.bodyMd, input.specKey);

    // 키는 본문에서 온 문자열이다 — 절대 SQL 에 이어붙이지 않고 파라미터로 바인딩한다.
    const resolved =
      keys.length === 0
        ? []
        : (
            await tx.execute<{ id: string; key: string }>(sql`
              SELECT id, key FROM spec
               WHERE project_id = ${input.projectId}
                 AND key IN (${sql.join(
                   keys.map((k) => sql`${k}`),
                   sql`, `,
                 )})
            `)
          ).rows;
    const wanted = new Map(resolved.map((r) => [r.id, r.key]));
    const unknown = keys.filter((k) => !resolved.some((r) => r.key === k));

    const { rows: existing } = await tx.execute<{ to_spec_id: string; key: string }>(sql`
      SELECT r.to_spec_id, s.key
        FROM spec_relation r JOIN spec s ON s.id = r.to_spec_id
       WHERE r.from_spec_id = ${input.specId} AND r.kind = 'references'
    `);
    const have = new Map(existing.map((r) => [r.to_spec_id, r.key]));

    const added: string[] = [];
    for (const [toId, key] of wanted) {
      if (have.has(toId) || toId === input.specId) continue;
      await tx.execute(sql`
        INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
        VALUES (${newId()}, ${input.projectId}, ${input.specId}, ${toId}, 'references')
        ON CONFLICT DO NOTHING
      `);
      added.push(key);
    }

    const removed: string[] = [];
    for (const [toId, key] of have) {
      if (wanted.has(toId)) continue;
      await tx.execute(sql`
        DELETE FROM spec_relation
         WHERE from_spec_id = ${input.specId} AND to_spec_id = ${toId} AND kind = 'references'
      `);
      removed.push(key);
    }

    return { added: added.sort(), removed: removed.sort(), unknown };
  }

  /** EP-SPEC-18 — direction=out/in/both. 역참조가 같은 표에 1급으로 섞여 나온다. */
  async list(input: {
    projectId: string;
    specKey: string;
    direction?: 'out' | 'in' | 'both';
    kind?: string | null;
    limit?: number;
  }): Promise<{ items: RelationEntry[]; total: number }> {
    const specId = await this.specIdOf(input.projectId, input.specKey);
    const direction = input.direction ?? 'both';
    const kindFilter =
      input.kind == null ? sql`` : sql` AND r.kind = ${input.kind}::spec_relation_kind`;
    const limit = Math.min(input.limit ?? 50, 200);

    const outQ = sql`
      SELECT r.kind::text AS kind, 'out' AS direction, s.id AS spec_id, s.key, s.title,
             sv.status::text AS doc_status, sv.version_no
        FROM spec_relation r
        JOIN spec s ON s.id = r.to_spec_id
   LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE r.from_spec_id = ${specId}${kindFilter}
    `;
    const inQ = sql`
      SELECT r.kind::text AS kind, 'in' AS direction, s.id AS spec_id, s.key, s.title,
             sv.status::text AS doc_status, sv.version_no
        FROM spec_relation r
        JOIN spec s ON s.id = r.from_spec_id
   LEFT JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE r.to_spec_id = ${specId}${kindFilter}
    `;
    const query =
      direction === 'out' ? outQ : direction === 'in' ? inQ : sql`${outQ} UNION ALL ${inQ}`;

    const { rows } = await this.db.execute<RelationEntry>(sql`
      SELECT * FROM (${query}) rel ORDER BY direction, kind, key LIMIT ${limit + 1}
    `);
    return { items: rows.slice(0, limit), total: rows.length };
  }

  /** EP-SPEC-03 `include=relations` — 총계 + 상위 N 요약. 전량은 EP-SPEC-18 이다. */
  async summary(input: {
    projectId: string;
    specKey: string;
  }): Promise<{ out_count: number; in_count: number; items: RelationEntry[] }> {
    const { items } = await this.list({ ...input, direction: 'both', limit: 20 });
    const specId = await this.specIdOf(input.projectId, input.specKey);
    const { rows } = await this.db.execute<{ out_count: string; in_count: string }>(sql`
      SELECT (SELECT count(*) FROM spec_relation WHERE from_spec_id = ${specId}) AS out_count,
             (SELECT count(*) FROM spec_relation WHERE to_spec_id = ${specId}) AS in_count
    `);
    return {
      out_count: Number(rows[0]?.out_count ?? 0),
      in_count: Number(rows[0]?.in_count ?? 0),
      items,
    };
  }

  private async specIdOf(projectId: string, key: string): Promise<string> {
    const { rows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM spec WHERE project_id = ${projectId} AND key = ${key}`,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'not_found',
        spec: key,
      });
    }
    return id;
  }
}
