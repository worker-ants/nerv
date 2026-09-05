// 기준선 동결·조회 + as-of/baseline manifest — E09-S06
// 정본: spec-workflow.md §3.6 · data-model.md §2.2 · api.md §2.2(REQ-API-015)
//
// 기준선은 **"이때의 스펙 세트"를 이름으로 고정**하는 장치다. 릴리스·감사·계약의 기준선이라
// 한 번 만들어지면 영원히 같은 답을 내야 한다 — 핀된 버전이 나중에 superseded 가 되어도
// 조회 결과는 그대로다. 그래서 `spec_baseline_item` 은 spec_version_id 를 직접 묶고,
// 어디에서도 "현재 버전"으로 재해석하지 않는다.
//
// 생성은 **사람 전용**이다(EP-SPEC-12 — PAT 불가). 동결은 거버넌스 행위이고, 에이전트가
// 자기 산출물의 기준선을 스스로 그을 수 있으면 기준선이라는 말이 성립하지 않는다.

import { Injectable } from '@nestjs/common';
import { msg, newId, NERV_ERROR, NERV_EVENT } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertHuman } from '../../common/human-only.js';
import type { Actor } from '../../common/human-only.js';
import { EventService } from '../event/event.service.js';

export interface BaselineSummary extends Record<string, unknown> {
  id: string;
  name: string;
  note_md: string | null;
  item_count: number;
  created_by_user_id: string;
  created_at: unknown;
}

@Injectable()
export class BaselineService {
  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /** EP-SPEC-11 */
  async list(projectId: string): Promise<BaselineSummary[]> {
    const { rows } = await this.db.execute<BaselineSummary>(sql`
      SELECT b.id, b.name, b.note_md, b.created_by_user_id, b.created_at,
             (SELECT count(*) FROM spec_baseline_item i WHERE i.baseline_id = b.id)::int AS item_count
        FROM spec_baseline b
       WHERE b.project_id = ${projectId}
       ORDER BY b.created_at DESC
    `);
    return rows;
  }

  /**
   * EP-SPEC-12 — 항목 생략 시 스펙별 최신 approved 전체를 담는다.
   *
   * **approved 가 아닌 항목이 하나라도 있으면 전체를 거부한다.** 부분 성공을 허용하면
   * "이 기준선에 뭐가 빠졌는지"를 매번 확인해야 하고, 그 순간 기준선의 값어치가 사라진다.
   */
  async create(input: {
    /** 사람 전용 게이트의 축 — 판정은 표면이 아니라 여기다(D-05 · REQ-API-111) */
    actor: Actor;
    projectId: string;
    name: string;
    noteMd?: string | null;
    specVersionIds?: string[] | null;
    userId: string;
  }): Promise<Record<string, unknown>> {
    assertHuman(input.actor, 'baseline', '/settings');
    if (input.name.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.baseline.name_required'), {
        kind: 'missing_name',
      });
    }

    return this.events.transact(async (tx, emit) => {
      const { rows: dup } = await tx.execute<{ id: string }>(
        sql`SELECT id FROM spec_baseline WHERE project_id = ${input.projectId} AND name = ${input.name}`,
      );
      if (dup[0] !== undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.baseline.duplicate'), {
          kind: 'duplicate_name',
          name: input.name,
        });
      }

      const explicit = input.specVersionIds ?? null;
      const items =
        explicit === null || explicit.length === 0
          ? (
              await tx.execute<{ spec_id: string; id: string; status: string; key: string }>(sql`
                SELECT DISTINCT ON (sv.spec_id)
                       sv.spec_id, sv.id, sv.status::text AS status, s.key
                  FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
                 WHERE s.project_id = ${input.projectId} AND sv.status = 'approved'
                 ORDER BY sv.spec_id, sv.version_no DESC
              `)
            ).rows
          : (
              await tx.execute<{ spec_id: string; id: string; status: string; key: string }>(sql`
                SELECT sv.spec_id, sv.id, sv.status::text AS status, s.key
                  FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
                 WHERE s.project_id = ${input.projectId}
                   AND sv.id IN (${sql.join(
                     explicit.map((v) => sql`${v}`),
                     sql`, `,
                   )})
              `)
            ).rows;

      const notApproved = items.filter((i) => i.status !== 'approved');
      if (notApproved.length > 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.baseline.not_approved'), {
          kind: 'not_approved',
          items: notApproved.map((i) => ({ spec: i.key, status: i.status })),
        });
      }
      if (items.length === 0) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.baseline.empty'), {
          kind: 'empty',
        });
      }

      const baselineId = newId();
      await tx.execute(sql`
        INSERT INTO spec_baseline (id, project_id, name, note_md, created_by_user_id)
        VALUES (${baselineId}, ${input.projectId}, ${input.name}, ${input.noteMd ?? null}, ${input.userId})
      `);
      for (const item of items) {
        await tx.execute(sql`
          INSERT INTO spec_baseline_item (baseline_id, spec_id, spec_version_id)
          VALUES (${baselineId}, ${item.spec_id}, ${item.id})
        `);
      }

      await emit({
        type: NERV_EVENT.BASELINE_CREATED,
        projectId: input.projectId,
        subjectType: 'spec_baseline',
        subjectId: baselineId,
        actorUserId: input.userId,
        isAgent: false,
        payload: { name: input.name, item_count: items.length },
      });

      return { baseline_id: baselineId, name: input.name, item_count: items.length };
    });
  }

  /**
   * EP-SPEC-13 — 항목 전량. 핀 버전과 **현재 최신 approved 의 차이**를 함께 표시한다.
   * 그 차이가 곧 "이 기준선 이후 무엇이 움직였나"이고, 릴리스 노트의 원재료다.
   */
  async get(input: { projectId: string; name: string }): Promise<Record<string, unknown>> {
    const baseline = await this.require(input.projectId, input.name);
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT s.id AS spec_id, s.key, s.title,
             pinned.version_no AS pinned_version_no, pinned.status::text AS pinned_status,
             latest.version_no AS latest_approved_version_no,
             (latest.version_no IS DISTINCT FROM pinned.version_no) AS drifted
        FROM spec_baseline_item i
        JOIN spec s ON s.id = i.spec_id
        JOIN spec_version pinned ON pinned.id = i.spec_version_id
   LEFT JOIN LATERAL (
             SELECT sv.version_no FROM spec_version sv
              WHERE sv.spec_id = s.id AND sv.status = 'approved'
              ORDER BY sv.version_no DESC LIMIT 1
           ) latest ON true
       WHERE i.baseline_id = ${baseline.id}
       ORDER BY s.key
    `);
    return { ...baseline, items: rows };
  }

  /**
   * EP-SPEC-14 — manifest. `baseline` 이름 또는 `as_of` 시각 중 하나로 본다.
   * git export 의 `manifest.json` 과 같은 내용을 API 로 낸다(architecture §2.4b).
   */
  async manifest(input: {
    projectId: string;
    baselineName?: string | null;
    asOf?: string | null;
  }): Promise<Record<string, unknown>> {
    if (input.baselineName != null && input.asOf != null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.baseline.conflicting_args'), {
        kind: 'exclusive_params',
      });
    }

    if (input.baselineName != null) {
      const detail = await this.get({ projectId: input.projectId, name: input.baselineName });
      const items = detail['items'] as Record<string, unknown>[];
      return {
        source: 'baseline',
        baseline: input.baselineName,
        specs: Object.fromEntries(
          items.map((i) => [
            i['key'] as string,
            { version_no: i['pinned_version_no'], status: i['pinned_status'] },
          ]),
        ),
      };
    }

    // as_of — 그 시점까지 승인된 것 중 스펙별 최신. 시각 생략 시 현재다.
    const cutoff = input.asOf ?? null;
    const bound = cutoff === null ? sql`` : sql` AND sv.approved_at <= ${cutoff}::timestamptz`;
    const { rows } = await this.db.execute<{
      key: string;
      version_no: number;
      status: string;
      approved_at: unknown;
    }>(sql`
      SELECT DISTINCT ON (s.id) s.key, sv.version_no, sv.status::text AS status, sv.approved_at
        FROM spec s JOIN spec_version sv ON sv.spec_id = s.id
       WHERE s.project_id = ${input.projectId} AND sv.status IN ('approved', 'superseded')
         AND sv.approved_at IS NOT NULL${bound}
       ORDER BY s.id, sv.version_no DESC
    `);
    return {
      source: cutoff === null ? 'current' : 'as_of',
      as_of: cutoff,
      specs: Object.fromEntries(
        rows.map((r) => [
          r.key,
          { version_no: r.version_no, status: r.status, approved_at: r.approved_at },
        ]),
      ),
    };
  }

  private async require(
    projectId: string,
    name: string,
  ): Promise<{ id: string; name: string; note_md: string | null }> {
    const { rows } = await this.db.execute<{ id: string; name: string; note_md: string | null }>(
      sql`SELECT id, name, note_md FROM spec_baseline WHERE project_id = ${projectId} AND name = ${name}`,
    );
    const baseline = rows[0];
    if (baseline === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.baseline.not_found'), {
        kind: 'not_found',
        baseline: name,
      });
    }
    return baseline;
  }
}
