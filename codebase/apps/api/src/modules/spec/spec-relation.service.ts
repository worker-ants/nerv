// spec_relation — 본문에서의 자동 추출(E09-S09) + 양방향 조회(E09-S12)
// 정본: api.md §2.2(REQ-API-024·027) · importer.md §2.4
//
// **역참조(backlink)가 1급이다.** 이 서비스가 있는 이유는 "누가 나를 참조하나"를 수정 **전에**
// 알기 위해서다 — 그것을 모르면 스펙 수정은 매번 도박이 된다. clemvion 에서 문서 간 참조는
// 사람의 기억 속에만 있었고, 그래서 폐기된 결정이 다른 문서에서 계속 살아 있었다(R-3).
//
// 추출은 임포터 링크 패스와 **같은 규칙**이다: 본문의 **링크**가 가리키는 실존 스펙 →
// `references` 관계. 미실존 대상은 오류가 아니라 경고다 — 아직 안 쓴 문서를 미리 참조하는
// 것은 정상적인 집필 순서다.

import { Injectable } from '@nestjs/common';
import { msg, newId, NERV_ERROR } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { entityRef } from '../../common/entity-ref.js';
import { NervError } from '../../common/nerv-exception.filter.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

/**
 * 인라인 링크 — `[텍스트](대상)`. **이미지(`![...](...)`)는 참조가 아니다.**
 *
 * 코드 블록 안의 링크도 센다. 코드 예시에 스펙 링크를 적었다면 그것도 그 문서를 가리킨 것이다.
 */
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** 앱의 스펙 경로 — `/p/<slug>/specs/<key>` 든 절대 URL 이든 끝의 키만 본다 */
const SPEC_ROUTE_RE = /\/specs\/([^/]+)$/;

/** 스킴이 붙은 주소(`https:`·`mailto:` …) — 남의 주소일 수 있으므로 스펙 경로일 때만 받는다 */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * 링크 대상 → 스펙 키. 아니면 null.
 *
 * **산문에서 키를 줍지 않는다**(2026-08-30 개정 — 사람 결정). 예전 규칙은 `SPC-` 로 시작하는
 * 문자열을 본문 아무 데서나 주웠는데, 두 가지가 동시에 틀렸다:
 *
 * - 접두 `SPC-` 는 **한 프로젝트의 작명 습관**이다. 키는 만드는 쪽이 정하므로 `SUD-…` 로
 *   지은 프로젝트에서는 규칙이 통째로 죽는다(실측: sudoku 13편 · 관계 0건).
 * - 그렇다고 접두를 프로젝트의 실제 키로 바꾸면 더 나쁘다. clemvion 의 키에는
 *   `migrations`·`conventions`·`data-model` 같은 **일상어**가 있어 문장 한 줄이 관계가 된다.
 *
 * 링크는 사람이 **"이건 그 문서다"라고 적은 자리**라 이 둘이 다 없다.
 */
export function specKeyOfLink(rawTarget: string): string | null {
  const target = (rawTarget.split('#')[0] ?? '').split('?')[0]?.trim().replace(/\/+$/, '') ?? '';
  if (target === '') return null;

  const routed = SPEC_ROUTE_RE.exec(target);
  if (routed !== null) return decode(routed[1] ?? '');
  // 스펙 경로가 아닌 외부 주소는 참조가 아니다 — `https://x.com/migrations` 가 문서를 가리키지 않는다
  if (HAS_SCHEME_RE.test(target)) return null;
  // 상대 경로(`../play/index.md`)는 **서버가 해소할 수 없다**. 원본 체크아웃을 보는
  // 임포터 CLI 의 몫이고(importer.md §2.4), 서버가 마지막 조각을 키로 넘겨짚으면
  // `index` 같은 이름이 남의 문서에 붙는다.
  if (target.includes('/')) return null;
  return decode(target);
}

function decode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded === '' ? null : decoded;
  } catch {
    return value.trim() === '' ? null : value.trim();
  }
}

/** 본문의 링크에서 참조 후보 키 — 자기 자신은 참조가 아니다. */
export function extractLinkedKeys(bodyMd: string, selfKey?: string | null): string[] {
  const found = new Set<string>();
  for (const match of bodyMd.matchAll(MD_LINK_RE)) {
    const key = specKeyOfLink(match[1] ?? '');
    if (key !== null) found.add(key);
  }
  if (selfKey != null) found.delete(selfKey);
  return [...found].sort();
}

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

  /**
   * 사람·에이전트가 **명시적으로** 선언하는 관계 — `refines`·`depends_on` 등.
   *
   * `references` 는 여기서 다루지 않는다. 그것은 본문에서 자동으로 동기화되므로(syncFromBody)
   * 손으로 넣으면 다음 저장에 지워진다 — 두 주인을 가진 데이터를 만들지 않는다.
   */
  async declare(input: {
    projectId: string;
    fromKey: string;
    toKey: string;
    kind: string;
    remove: boolean;
  }): Promise<{ ok: true; from: string; to: string; kind: string; removed: boolean }> {
    if (input.kind === 'references') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.relation.auto_kind'), {
        kind: 'auto_managed',
      });
    }
    if (input.fromKey === input.toKey) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.relation.self'), { kind: 'self' });
    }
    // 키든 UUID 든 같은 문서를 가리킨다(§1.4b) — 옆 도구들과 같은 규칙이다
    const fromId = await this.resolveSpec(this.db, input.projectId, input.fromKey);
    const toId = await this.resolveSpec(this.db, input.projectId, input.toKey);
    if (fromId === null || toId === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'unknown_key',
        missing: [
          ...(fromId === null ? [input.fromKey] : []),
          ...(toId === null ? [input.toKey] : []),
        ],
      });
    }
    if (input.remove) {
      await this.db.execute(sql`
        DELETE FROM spec_relation
         WHERE project_id = ${input.projectId} AND from_spec_id = ${fromId}
           AND to_spec_id = ${toId} AND kind = ${input.kind}::spec_relation_kind
      `);
    } else {
      await this.db.execute(sql`
        INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
        VALUES (${newId()}, ${input.projectId}, ${fromId}, ${toId}, ${input.kind}::spec_relation_kind)
        ON CONFLICT DO NOTHING
      `);
    }
    return {
      ok: true,
      from: input.fromKey,
      to: input.toKey,
      kind: input.kind,
      removed: input.remove,
    };
  }

  /** 본문의 **링크**에서 참조 후보 키를 뽑는다 — 규칙은 `specKeyOfLink` 가 갖는다. */
  extractKeys(bodyMd: string, selfKey?: string | null): string[] {
    return extractLinkedKeys(bodyMd, selfKey);
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

  /**
   * 저장 한 번에 **선언 관계까지** 확정한다(REQ-API-043).
   *
   * `references` 는 여기서 다루지 않는다 — 본문(링크)이 그것의 주인이다. 두 주인을 두면
   * 산문에서 지운 참조가 배열에 남아 유령이 되고, 그래프는 한 번 틀리는 순간 신뢰를 잃는다.
   *
   * **주지 않은 것(`undefined`)과 빈 배열은 다르다**: 앞은 "건드리지 마라"(본문만 고치는
   * 저장), 뒤는 "선언 관계를 전부 지워라"다. 이 구분이 없으면 본문만 고치는 저장이
   * 매번 선언 관계를 쓸어버린다.
   */
  async syncDeclared(
    tx: Tx,
    input: {
      projectId: string;
      specId: string;
      declared: readonly { to: string; kind: string }[];
    },
  ): Promise<string[]> {
    const wanted: { toId: string; kind: string; to: string }[] = [];
    for (const entry of input.declared) {
      if (entry.kind === 'references') {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.relation.auto_kind'), {
          kind: 'auto_managed',
          field: 'relations',
        });
      }
      const toId = await this.resolveSpec(tx, input.projectId, entry.to);
      if (toId === null) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
          kind: 'not_found',
          field: 'relations.to',
          value: entry.to,
        });
      }
      if (toId === input.specId) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.relation.self'), { kind: 'self' });
      }
      wanted.push({ toId, kind: entry.kind, to: entry.to });
    }

    await tx.execute(sql`
      DELETE FROM spec_relation
       WHERE from_spec_id = ${input.specId} AND kind <> 'references'
    `);
    for (const entry of wanted) {
      await tx.execute(sql`
        INSERT INTO spec_relation (id, project_id, from_spec_id, to_spec_id, kind)
        VALUES (${newId()}, ${input.projectId}, ${input.specId}, ${entry.toId},
                ${entry.kind}::spec_relation_kind)
        ON CONFLICT DO NOTHING
      `);
    }
    return wanted.map((w) => `${w.kind}:${w.to}`).sort();
  }

  /** 키든 UUID 든 이 프로젝트의 스펙 하나로 — 못 찾으면 null(부르는 쪽이 문맥을 안다) */
  private async resolveSpec(
    db: Tx | NervDb,
    projectId: string,
    ref: string,
  ): Promise<string | null> {
    const parsed = entityRef(ref);
    const match = parsed.id !== null ? sql`id = ${parsed.id}` : sql`key = ${parsed.key ?? ''}`;
    const { rows } = await db.execute<{ id: string }>(
      sql`SELECT id FROM spec WHERE project_id = ${projectId} AND ${match}`,
    );
    return rows[0]?.id ?? null;
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
