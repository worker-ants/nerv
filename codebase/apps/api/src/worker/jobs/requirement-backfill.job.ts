// 승인본의 요구사항 행 채우기 (2026-09-28 · REQ-API-241)
//
// 요구사항 행은 **승인할 때** 만들어진다(`SpecService.syncRequirements`). 추출 규칙이 넓어지면 — 가운데 토막의
// 숫자(`REQ-C24NODE-001`)를 읽게 된 것처럼 — 이미 승인된 문서에서 새로 읽히는 줄은 다음 승인까지 행이 없다.
// 그동안 요구사항 탭 · 커버리지 · 검증이 그 약속을 세지 못한다.
//
// 이 잡은 문서마다 최신 승인본을 읽어 **빠진 행만** 더한다. 있는 행은 건드리지 않으므로 멱등이다 — 문장을 고치고
// 빠진 것을 표시하는 일은 여전히 승인이 한다. 워커가 뜰 때 한 번, 그 뒤로 하루에 한 번 돈다.

import { Injectable, Logger } from '@nestjs/common';
import { newId, requirementsOf } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

export interface RequirementBackfillReport {
  /** 읽은 승인본 수 */
  specs: number;
  /** 새로 만든 요구사항 행 수 */
  inserted: number;
}

@Injectable()
export class RequirementBackfillJob {
  readonly name = 'requirement-backfill';
  private readonly logger = new Logger(RequirementBackfillJob.name);

  constructor(@InjectDb() private readonly db: NervDb) {}

  async run(): Promise<RequirementBackfillReport> {
    // 보관한 문서는 되살리지 않는다 — 그 약속은 이미 거둔 것이다
    const { rows } = await this.db.execute<{
      project_id: string;
      spec_id: string;
      version_id: string;
      body_md: string | null;
    }>(sql`
      SELECT DISTINCT ON (sv.spec_id) s.project_id, sv.spec_id, sv.id AS version_id, sv.body_md
        FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
       WHERE sv.status = 'approved' AND s.archived_at IS NULL
       ORDER BY sv.spec_id, sv.version_no DESC
    `);

    let inserted = 0;
    for (const row of rows) {
      const found = requirementsOf(row.body_md ?? '');
      if (found.size === 0) continue;
      // 이미 있는 ref(이 문서든 다른 문서든)는 건너뛴다 — 같은 ref 는 프로젝트에 하나다
      const { rows: existing } = await this.db.execute<{ ref: string }>(sql`
        SELECT ref FROM requirement
         WHERE project_id = ${row.project_id}
           AND ref IN (${sql.join(
             [...found.keys()].map((ref) => sql`${ref}`),
             sql`, `,
           )})
      `);
      const have = new Set(existing.map((r) => r.ref));
      for (const [ref, statement] of found) {
        if (have.has(ref)) continue;
        const { rows: made } = await this.db.execute<{ id: string }>(sql`
          INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                   introduced_in_version_id, current_version_id)
          VALUES (${newId()}, ${row.project_id}, ${row.spec_id}, ${ref}, ${statement},
                  'must'::requirement_priority, ${row.version_id}, ${row.version_id})
          ON CONFLICT (project_id, ref) DO NOTHING
          RETURNING id
        `);
        inserted += made.length;
      }
    }

    if (inserted > 0) {
      this.logger.log(`승인본에서 빠진 요구사항 ${inserted}건을 채웠다 (문서 ${rows.length}편)`);
    }
    return { specs: rows.length, inserted };
  }
}
