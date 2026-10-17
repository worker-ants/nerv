// 워치와 핀 — 정본: docs/04-mvp/api.md §2.7 (EP-NTF-11 ~ 17) · spec-workflow §6.1 ② · screens.md §1.3a
// (2026-10-16 · 사람 결정 D5 = B · Phase 2 E17-S02 · REQ-API-342 ~ 345)
//
// **표가 둘이다.** 워치는 알림의 구독이고(카탈로그 §6.3 의 「워처」 수신자), 핀은 퀵 스위처의 이동 수단이다 — 핀은 알림을 만들지
// 않는다. 둘 다 그 사람의 설정이라 **본인의 것만** 읽고 바꾸며, 대상은 **지금 내가 속한 프로젝트**의 것만 받는다. 워치는 사람이
// 누를 때만 생긴다 — 자동 등록은 하지 않는다(spec-workflow §2.2 결정 기록).
//
// 워처를 알림으로 산출하는 것은 여기가 아니라 알림 라우팅(`notification.service.ts` · `watcherTargets`)이다 — 수신자 판정은 한
// 곳이다(관여 라우팅 REQ-API-316 과 같은 자리).

import { Injectable } from '@nestjs/common';
import { msg, NERV_ERROR, newId, PIN_LIMIT, PIN_TARGETS, WATCH_TARGETS } from '@nerv/schema';
import type { PinTarget, WatchTarget } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { entityRef } from '../../common/entity-ref.js';
import { memberOfProjectSql, resolveMemberProject } from '../../common/member-scope.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertVocab } from '../../common/query-vocab.js';

type Executor = Pick<NervDb, 'execute'>;

/** 워치 · 핀이 가리키는 것 — 화면이 그 줄을 그리는 데 쓰는 값 */
type ResolvedTarget = {
  id: string;
  key: string;
  title: string;
  /** 스펙이면 그 종류(`area` 인지 보려고) */
  spec_type: string | null;
};

/** 목록의 대상 칸 — 대상 종류마다 키 · 제목 · 종류 · 상태를 고른다(스위처 줄과 같은 모양) */
const TARGET_COLUMNS = sql`
  coalesce(s.key, t.key, cr.key) AS key,
  coalesce(s.title, t.title, cr.title) AS title,
  -- 스위처 줄의 type 칸 — 스펙은 종류, 작업 · 변경 요청은 상태다(검색의 ID 직행과 같은 규칙)
  coalesce(s.type::text, t.status::text, cr.status::text) AS type,
  -- 문서 상태 — 버린 초안은 세지 않는다(가장 새 버전을 묻는 자리가 건너뛴다)
  (SELECT sv.status::text FROM spec_version sv
    WHERE sv.spec_id = s.id AND sv.status <> 'discarded'
    ORDER BY sv.version_no DESC LIMIT 1) AS doc_status,
  coalesce(s.archived_at, t.archived_at) AS archived_at`;

/** 대상 종류마다 이은 표 — `x` 는 워치 또는 핀 행이다 */
const TARGET_JOINS = sql`
  LEFT JOIN spec s ON x.target_type::text IN ('spec', 'area') AND s.id = x.target_id
  LEFT JOIN task t ON x.target_type::text = 'task' AND t.id = x.target_id
  LEFT JOIN change_request cr ON x.target_type::text = 'change_request' AND cr.id = x.target_id`;

@Injectable()
export class WatchService {
  constructor(@InjectDb() private readonly db: NervDb) {}

  /**
   * EP-NTF-11 — **내 워치**(REQ-API-342). 지금 멤버이고 보관하지 않은 프로젝트의 것만 — 범위를 주면 그 프로젝트(내가 속한
   * 것 하나로 푼다)의 것만이다. 새로 건 것이 위다.
   */
  async listWatches(input: {
    userId: string;
    project?: string | null;
    org?: string | null;
  }): Promise<{ items: Record<string, unknown>[] }> {
    const scope =
      input.project == null || input.project === ''
        ? sql``
        : sql` AND p.id = ${(await resolveMemberProject(this.db, input.userId, { project: input.project, org: input.org ?? null })).id}`;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT x.id, x.target_type::text AS target_type, x.target_id, x.created_at,
             p.id AS project_id, p.slug AS project_slug, p.name AS project_name, o.slug AS org_slug,
             ${TARGET_COLUMNS}
        FROM watch x
        JOIN project p ON p.id = x.project_id
        JOIN organization o ON o.id = p.org_id
        ${TARGET_JOINS}
       WHERE x.user_id = ${input.userId} AND p.archived_at IS NULL
         AND ${memberOfProjectSql(input.userId)}${scope}
       ORDER BY x.created_at DESC, x.id DESC
    `);
    return { items: rows };
  }

  /**
   * EP-NTF-12 — **워치를 건다**(REQ-API-342). 같은 대상을 다시 걸면 새 행을 만들지 않고 있던 것을 `created: false` 로 준다(멱등).
   * `area` 는 영역 문서(`spec.type = area`)에만 걸린다 — 그 아래 문서와 작업까지 포함하는 워치라, 영역이 아닌 문서에 걸면 사람이
   * 기대한 범위와 다르다.
   */
  async watch(input: {
    userId: string;
    project: string;
    org?: string | null;
    targetType: string;
    target: string;
  }): Promise<{ watch: Record<string, unknown>; created: boolean }> {
    const [type] = assertVocab([input.targetType], WATCH_TARGETS, 'target_type') as [WatchTarget];
    const project = await resolveMemberProject(this.db, input.userId, {
      project: input.project,
      org: input.org ?? null,
    });
    const target = await this.resolveTarget(this.db, project.id, type, input.target, 'watch');
    if (type === 'area' && target.spec_type !== 'area') {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.watch.not_area', { target: target.key }),
        {
          kind: 'not_area',
          target: target.key,
          spec_type: target.spec_type,
        },
      );
    }
    const { rows } = await this.db.execute<{ id: string; created: boolean }>(sql`
      WITH ins AS (
        INSERT INTO watch (id, user_id, project_id, target_type, target_id)
        VALUES (${newId()}, ${input.userId}, ${project.id}, ${type}::watch_target, ${target.id})
        ON CONFLICT (user_id, target_type, target_id) DO NOTHING
        RETURNING id
      )
      SELECT id, true AS created FROM ins
      UNION ALL
      SELECT id, false FROM watch
       WHERE user_id = ${input.userId} AND target_type = ${type}::watch_target AND target_id = ${target.id}
         AND NOT EXISTS (SELECT 1 FROM ins)
    `);
    // 동시에 같은 워치를 걸면 둘째의 읽기가 첫째의 행을 못 볼 수 있다 — 그때는 한 번 더 읽는다
    const row =
      rows[0] ??
      (
        await this.db.execute<{ id: string; created: boolean }>(sql`
          SELECT id, false AS created FROM watch
           WHERE user_id = ${input.userId} AND target_type = ${type}::watch_target AND target_id = ${target.id}
        `)
      ).rows[0]!;
    return {
      watch: {
        id: row.id,
        target_type: type,
        target_id: target.id,
        key: target.key,
        title: target.title,
        project_id: project.id,
        project_slug: project.slug,
        org_slug: project.org_slug,
      },
      created: row.created,
    };
  }

  /** EP-NTF-13 — **워치를 푼다**(REQ-API-342). 본인의 것만 — 남의 워치 · 없는 워치는 같은 답이다(409 `not_found`) */
  async unwatch(input: { userId: string; watchId: string }): Promise<{ ok: true }> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      DELETE FROM watch WHERE id = ${entityRef(input.watchId).id} AND user_id = ${input.userId} RETURNING id
    `);
    if (rows.length === 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.watch.not_found'), {
        kind: 'not_found',
        watch: input.watchId,
      });
    }
    return { ok: true };
  }

  /**
   * EP-NTF-14 — **내 핀**(REQ-API-344). 프로젝트를 넘는 한 목록이고 순서는 `position` 오름차순이다. 지금 멤버가 아니거나 보관한
   * 프로젝트의 핀은 남아도 보이지 않는다 — 다시 멤버가 되면 돌아온다.
   */
  async listPins(input: { userId: string }): Promise<{ items: Record<string, unknown>[] }> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT x.id, x.target_type::text AS target_type, x.target_id, x.position, x.created_at,
             p.id AS project_id, p.slug AS project_slug, p.name AS project_name, o.slug AS org_slug,
             ${TARGET_COLUMNS}
        FROM pin x
        JOIN project p ON p.id = x.project_id
        JOIN organization o ON o.id = p.org_id
        ${TARGET_JOINS}
       WHERE x.user_id = ${input.userId} AND p.archived_at IS NULL
         AND ${memberOfProjectSql(input.userId)}
       ORDER BY x.position, x.created_at DESC, x.id
    `);
    return { items: rows };
  }

  /**
   * EP-NTF-15 — **핀을 고정한다**(REQ-API-344). 새 핀이 맨 위다(그 사람의 가장 작은 `position` 보다 하나 작게). 같은 대상을
   * 다시 고정하면 자리를 바꾸지 않고 `created: false` 다. 한 사람에 `PIN_LIMIT` 개까지 — 넘으면 409 `pin_limit`.
   */
  async pin(input: {
    userId: string;
    project: string;
    org?: string | null;
    targetType: string;
    target: string;
  }): Promise<{ pin: Record<string, unknown>; created: boolean }> {
    const [type] = assertVocab([input.targetType], PIN_TARGETS, 'target_type') as [PinTarget];
    const project = await resolveMemberProject(this.db, input.userId, {
      project: input.project,
      org: input.org ?? null,
    });
    const target = await this.resolveTarget(this.db, project.id, type, input.target, 'pin');
    return this.db.transaction(async (tx) => {
      const added = await this.addPin(tx, input.userId, project.id, type, target.id, 'top');
      return {
        pin: {
          id: added.id,
          target_type: type,
          target_id: target.id,
          key: target.key,
          title: target.title,
          project_id: project.id,
          project_slug: project.slug,
          org_slug: project.org_slug,
        },
        created: added.created,
      };
    });
  }

  /** EP-NTF-16 — **핀을 푼다**(REQ-API-344). 본인의 것만이다 */
  async unpin(input: { userId: string; pinId: string }): Promise<{ ok: true }> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      DELETE FROM pin WHERE id = ${entityRef(input.pinId).id} AND user_id = ${input.userId} RETURNING id
    `);
    if (rows.length === 0) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.pin.not_found'), {
        kind: 'not_found',
        pin: input.pinId,
      });
    }
    return { ok: true };
  }

  /**
   * EP-NTF-17 — **브라우저의 핀을 옮긴다**(REQ-API-345). 웹이 처음 한 번 localStorage 의 핀을 보낸다. 받은 순서대로 **지금 서버의
   * 핀 아래에** 둔다 — 서버에 이미 있는 핀은 다른 기기에서 더 나중에 고른 것이다. 이미 고정한 것 · 찾지 못한 것 · 내가 속하지 않은
   * 프로젝트의 것 · 상한을 넘은 것은 건너뛰고 까닭과 함께 돌려준다 — 한 줄이 틀려도 나머지는 옮긴다(옮긴 뒤 브라우저는 지운다).
   */
  async importPins(input: {
    userId: string;
    items: readonly {
      project: string;
      org?: string | null | undefined;
      target_type: string;
      target: string;
    }[];
  }): Promise<{ imported: number; skipped: { target: string; reason: string }[] }> {
    const skipped: { target: string; reason: string }[] = [];
    let imported = 0;
    for (const item of input.items) {
      if (!(PIN_TARGETS as readonly string[]).includes(item.target_type)) {
        skipped.push({ target: item.target, reason: 'invalid_input' });
        continue;
      }
      let project: { id: string };
      let target: ResolvedTarget;
      try {
        project = await resolveMemberProject(this.db, input.userId, {
          project: item.project,
          org: item.org ?? null,
        });
        target = await this.resolveTarget(
          this.db,
          project.id,
          item.target_type as PinTarget,
          item.target,
          'pin',
        );
      } catch (err) {
        if (!(err instanceof NervError)) throw err;
        skipped.push({ target: item.target, reason: 'not_found' });
        continue;
      }
      try {
        const added = await this.db.transaction((tx) =>
          this.addPin(
            tx,
            input.userId,
            project.id,
            item.target_type as PinTarget,
            target.id,
            'bottom',
          ),
        );
        if (added.created) imported += 1;
        else skipped.push({ target: item.target, reason: 'exists' });
      } catch (err) {
        if (err instanceof NervError && err.details?.['kind'] === 'pin_limit') {
          skipped.push({ target: item.target, reason: 'pin_limit' });
          continue;
        }
        throw err;
      }
    }
    return { imported, skipped };
  }

  /**
   * 핀 한 줄을 더한다 — 위(`top` · 새 핀)나 아래(`bottom` · 옮겨 오는 핀)에. 그 사람의 핀을 잠가 자리와 상한 판정이 겹치지 않게
   * 한다(같은 사람이 두 기기에서 동시에 눌러도 같은 자리를 받지 않는다).
   */
  private async addPin(
    tx: Executor,
    userId: string,
    projectId: string,
    type: PinTarget,
    targetId: string,
    where: 'top' | 'bottom',
  ): Promise<{ id: string; created: boolean }> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pin:${userId}`}))`);
    const { rows: existing } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM pin WHERE user_id = ${userId} AND target_type = ${type}::pin_target AND target_id = ${targetId}
    `);
    if (existing[0] !== undefined) return { id: existing[0].id, created: false };
    const { rows: stat } = await tx.execute<{
      n: number;
      lo: number | null;
      hi: number | null;
    }>(sql`
      SELECT count(*)::int AS n, min(position) AS lo, max(position) AS hi FROM pin WHERE user_id = ${userId}
    `);
    const { n, lo, hi } = stat[0] ?? { n: 0, lo: null, hi: null };
    if (n >= PIN_LIMIT) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.pin.limit', { max: PIN_LIMIT }), {
        kind: 'pin_limit',
        max: PIN_LIMIT,
      });
    }
    const position = n === 0 ? 0 : where === 'top' ? (lo ?? 0) - 1 : (hi ?? 0) + 1;
    const id = newId();
    await tx.execute(sql`
      INSERT INTO pin (id, user_id, project_id, target_type, target_id, position)
      VALUES (${id}, ${userId}, ${projectId}, ${type}::pin_target, ${targetId}, ${position})
    `);
    return { id, created: true };
  }

  /** 대상을 이 프로젝트 안에서 키 또는 UUID 로 푼다 — 없으면 409 `not_found`(워치 · 핀 각자의 문구) */
  private async resolveTarget(
    db: Executor,
    projectId: string,
    type: WatchTarget | PinTarget,
    raw: string,
    surface: 'watch' | 'pin',
  ): Promise<ResolvedTarget> {
    const ref = entityRef(raw);
    const match = (table: SQL): SQL =>
      ref.id === null
        ? sql`lower(${table}.key) = lower(${ref.key ?? ''})`
        : sql`${table}.id = ${ref.id}`;
    const query =
      type === 'task'
        ? sql`SELECT t.id, t.key, t.title, NULL::text AS spec_type FROM task t
               WHERE t.project_id = ${projectId} AND ${match(sql`t`)}`
        : type === 'change_request'
          ? sql`SELECT cr.id, cr.key, cr.title, NULL::text AS spec_type FROM change_request cr
                 WHERE cr.project_id = ${projectId} AND ${match(sql`cr`)}`
          : sql`SELECT s.id, s.key, s.title, s.type::text AS spec_type FROM spec s
                 WHERE s.project_id = ${projectId} AND ${match(sql`s`)}`;
    const { rows } = await db.execute<ResolvedTarget>(query);
    const found = rows[0];
    if (found === undefined) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg(surface === 'watch' ? 'error.watch.target_not_found' : 'error.pin.target_not_found', {
          target: raw,
        }),
        { kind: 'not_found', target: raw, target_type: type },
      );
    }
    return found;
  }
}
