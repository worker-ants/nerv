// 임베딩 파이프라인 — 헤딩 청크 · 변경분만 재임베딩 · 최신 판만 유지 (E09-S11)
// 정본: database.md §2.15(REQ-DB-014·015·017) · codebase.md §5.2a(REQ-CB-020·021)
//
// 세 규칙이 이 파일의 전부다.
//   ① **청크 = 헤딩 단위** — 결과가 곧 앵커 스니펫이 되고, 코멘트 앵커 규약(D-09)과 같은 slug 를
//      쓰므로 검색 결과에서 코멘트 위치로 바로 갈 수 있다.
//   ② **변경분만** — chunk_hash 비교로 무변경 재임베딩을 막는다. approved 본문은 불변이라
//      버전당 최대 1회다. 이게 없으면 저장할 때마다 문서 전체를 다시 임베딩하게 된다.
//   ③ **최신 판만** — 스펙별 최신 approved + 현재 draft. 과거 판 검색은 렉시컬로 충분하고,
//      전 버전 임베딩은 비용 대비 무가치다.

import { Injectable, Logger } from '@nestjs/common';
import { newId } from '@nerv/schema';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { EmbeddingClient } from './embedding.client.js';

export interface Chunk {
  anchor: string;
  text: string;
}

export interface IndexReport {
  versions_scanned: number;
  chunks_embedded: number;
  chunks_unchanged: number;
  chunks_deleted: number;
  versions_pruned: number;
  error: string | null;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client = EmbeddingClient.fromEnv();
  readonly model = process.env['NERV_EMBED_MODEL'] ?? 'bge-m3';

  constructor(@InjectDb() private readonly db: NervDb) {}

  /**
   * 본문을 헤딩 단위로 쪼갠다. 헤딩 앞의 도입부는 `_intro` 앵커를 받는다 —
   * 버리면 문서 첫머리(대개 그 문서가 무엇인지 말하는 자리)가 검색에서 사라진다.
   */
  chunk(bodyMd: string): Chunk[] {
    const lines = bodyMd.split('\n');
    const chunks: Chunk[] = [];
    let anchor = '_intro';
    let buffer: string[] = [];

    const flush = (): void => {
      const text = buffer.join('\n').trim();
      if (text !== '') chunks.push({ anchor, text });
      buffer = [];
    };

    for (const line of lines) {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (heading !== null) {
        flush();
        anchor = slugify(heading[2] ?? '');
        buffer.push(line);
        continue;
      }
      buffer.push(line);
    }
    flush();

    // 같은 제목이 두 번 나오면 앵커가 충돌한다 — 뒤쪽에 순번을 붙여 유일하게 만든다.
    const seen = new Map<string, number>();
    return chunks.map((c) => {
      const count = (seen.get(c.anchor) ?? 0) + 1;
      seen.set(c.anchor, count);
      return count === 1 ? c : { ...c, anchor: `${c.anchor}-${count}` };
    });
  }

  /** 인덱싱 대상 — 스펙별 최신 approved + 현재 draft(규칙 ③). */
  async indexableVersions(
    projectId?: string | null,
  ): Promise<{ id: string; spec_id: string; body_md: string }[]> {
    const scope = projectId == null ? sql`` : sql` AND s.project_id = ${projectId}`;
    // DISTINCT ON 은 자기 ORDER BY 를 요구하므로 각 갈래를 서브쿼리로 감싼다 —
    // UNION 뒤의 ORDER BY 는 결합 결과의 정렬이라 DISTINCT ON 과 짝이 되지 않는다.
    const { rows } = await this.db.execute<{ id: string; spec_id: string; body_md: string }>(sql`
      SELECT id, spec_id, body_md FROM (
        SELECT sv.id, sv.spec_id, sv.body_md
          FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.status = 'draft'${scope}
      ) drafts
      UNION
      SELECT id, spec_id, body_md FROM (
        SELECT DISTINCT ON (sv.spec_id) sv.id, sv.spec_id, sv.body_md
          FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.status = 'approved'${scope}
         ORDER BY sv.spec_id, sv.version_no DESC
      ) approved
    `);
    return rows;
  }

  /**
   * 한 판 돌린다. 제공자가 죽어 있으면 **아무것도 적재하지 않고** 보고만 한다 —
   * 검색은 렉시컬로 degrade 되지만(REQ-API-026), 인덱스에 반쪽짜리를 남기지는 않는다.
   */
  async runOnce(
    input: { projectId?: string | null; limitVersions?: number } = {},
  ): Promise<IndexReport> {
    const report: IndexReport = {
      versions_scanned: 0,
      chunks_embedded: 0,
      chunks_unchanged: 0,
      chunks_deleted: 0,
      versions_pruned: 0,
      error: null,
    };

    report.versions_pruned = await this.pruneStaleVersions(input.projectId ?? null);

    const versions = (await this.indexableVersions(input.projectId ?? null)).slice(
      0,
      input.limitVersions ?? 200,
    );

    for (const version of versions) {
      report.versions_scanned += 1;
      const chunks = this.chunk(version.body_md ?? '');

      const { rows: existing } = await this.db.execute<{ anchor: string; hash: string }>(sql`
        SELECT anchor, encode(chunk_hash, 'hex') AS hash
          FROM spec_chunk_embedding
         WHERE spec_version_id = ${version.id} AND model = ${this.model}
      `);
      const have = new Map(existing.map((e) => [e.anchor, e.hash]));

      const pending: { anchor: string; text: string; hash: string }[] = [];
      for (const chunk of chunks) {
        const hash = createHash('sha256').update(chunk.text, 'utf8').digest('hex');
        if (have.get(chunk.anchor) === hash) {
          report.chunks_unchanged += 1;
          have.delete(chunk.anchor);
          continue;
        }
        pending.push({ ...chunk, hash });
        have.delete(chunk.anchor);
      }

      // 본문에서 사라진 앵커의 행은 지운다 — 남겨두면 없는 절이 검색에 계속 뜬다.
      for (const anchor of have.keys()) {
        await this.db.execute(sql`
          DELETE FROM spec_chunk_embedding
           WHERE spec_version_id = ${version.id} AND anchor = ${anchor} AND model = ${this.model}
        `);
        report.chunks_deleted += 1;
      }

      if (pending.length === 0) continue;

      let vectors: number[][];
      try {
        vectors = await this.client.embed(pending.map((p) => p.text.slice(0, 8000)));
      } catch (error) {
        // REQ-CB-021 위반(차원 불일치)도 여기로 온다 — 적재하지 않고 오류로 기록한다.
        report.error = String(error);
        this.logger.warn(`임베딩 중단 — ${report.error}`);
        return report;
      }

      for (const [index, item] of pending.entries()) {
        const vector = vectors[index];
        if (vector === undefined) continue;
        const literal = `[${vector.join(',')}]`;
        await this.db.execute(sql`
          INSERT INTO spec_chunk_embedding (id, spec_version_id, anchor, chunk_hash, embedding, model)
          VALUES (${newId()}, ${version.id}, ${item.anchor}, decode(${item.hash}, 'hex'),
                  ${literal}::vector, ${this.model})
          ON CONFLICT (spec_version_id, anchor, model)
          DO UPDATE SET chunk_hash = EXCLUDED.chunk_hash, embedding = EXCLUDED.embedding
        `);
        report.chunks_embedded += 1;
      }
    }

    return report;
  }

  /** 규칙 ③의 집행 — 최신 판이 아니게 된 버전의 임베딩 행을 지운다(supersede·draft 폐기). */
  private async pruneStaleVersions(projectId: string | null): Promise<number> {
    const scope = projectId == null ? sql`` : sql` AND s.project_id = ${projectId}`;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      DELETE FROM spec_chunk_embedding e
       WHERE e.spec_version_id IN (
         SELECT sv.id FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
          WHERE sv.status NOT IN ('draft', 'approved')${scope}
       )
      RETURNING e.id
    `);
    return rows.length;
  }
}

/** 헤딩 → slug. 코멘트 앵커와 같은 규약이다(D-09 · screens.md §3.3). */
export function slugify(heading: string): string {
  return (
    heading
      .toLowerCase()
      // `_` 는 지우지 않는다 — 이 저장소의 헤딩에는 `nerv_spec_get` 같은 식별자가 흔하고,
      // 밑줄을 지우면 앵커가 원문에 없는 문자열이 된다(강조 표기보다 식별자가 우선이다).
      .replace(/[`*~[\]()]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  );
}
