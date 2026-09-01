// 보존 정책 집행 — Activity 원문 TTL · 리뷰 프롬프트 blob TTL (spec-workflow §5.6)
//
// **결론은 영구, 재생성 가능한 입력은 TTL.** clemvion 이 이미 검증한 절충이다 —
// `_prompts/`(리뷰 전체의 약 70%)를 "커밋 해시 + 스킬로 항상 재생성 가능"을 근거로
// 버렸는데도 결론만으로 60.7MB 에 도달했다. 그 교훈이 이 잡의 전부다.
//
// 프로젝트별 `retention` jsonb 가 기본값을 덮는다(api.md §2.1a) — 프로젝트마다 규제 요건이
// 다르기 때문이다. 상수는 최후의 기본값이고 정책이 있으면 정책이 이긴다.
import { Injectable, Logger } from '@nestjs/common';
import { REVIEW_PROMPT_BLOB_TTL_DAYS, RetentionSchema } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

export interface RetentionReport {
  activities_deleted: number;
  blobs_expired: number;
  projects_scanned: number;
}

@Injectable()
export class RetentionJob {
  readonly name = 'retention';
  readonly blobTtlDays = REVIEW_PROMPT_BLOB_TTL_DAYS;
  private readonly logger = new Logger(RetentionJob.name);

  constructor(@InjectDb() private readonly db: NervDb) {}

  async run(): Promise<RetentionReport> {
    const report: RetentionReport = {
      activities_deleted: 0,
      blobs_expired: 0,
      projects_scanned: 0,
    };

    const { rows: projects } = await this.db.execute<{ id: string; retention: unknown }>(
      sql`SELECT id, retention FROM project WHERE archived_at IS NULL`,
    );

    for (const project of projects) {
      report.projects_scanned += 1;
      const parsed = RetentionSchema.safeParse(project.retention ?? {});
      // 정책이 깨져 있어도 잡을 멈추지 않는다 — 기본값으로 돌고 경고를 남긴다.
      // 여기서 던지면 한 프로젝트의 오타가 전체 보존 정책을 멈춘다.
      const policy = parsed.success ? parsed.data : RetentionSchema.parse({});
      if (!parsed.success) {
        this.logger.warn(
          `retention 정책이 유효하지 않습니다 — 기본값 사용 (project=${project.id})`,
        );
      }

      // **지우기 전에 접는다**(2026-09-01 · REQ-API-067). 예전에는 그냥 지웠고, 지우고 나면
      // 그 세션은 아무것도 안 한 것처럼 보였다 — 빈 레일은 "기록이 없다" 와 "아무것도 안
      // 했다" 를 구별하지 못한다. 도구별 횟수를 세션에 남기면 원문이 사라져도 규모는 남는다.
      await this.db.execute(sql`
        UPDATE agent_session s
           SET activity_summary = coalesce(s.activity_summary, '{}'::jsonb) || rolled.counts
          FROM (
            SELECT a.session_id,
                   jsonb_object_agg(coalesce(a.tool_name, a.type), a.n) AS counts
              FROM (
                SELECT a2.session_id, a2.tool_name, a2.type::text AS type, count(*)::int AS n
                  FROM activity a2
                  JOIN agent_session s2 ON s2.id = a2.session_id
                 WHERE s2.project_id = ${project.id}
                   AND a2.created_at < now() - make_interval(days => ${policy.activity_days})
                 GROUP BY a2.session_id, a2.tool_name, a2.type
              ) a
             GROUP BY a.session_id
          ) rolled
         WHERE s.id = rolled.session_id
      `);

      // Activity 원문을 지운다. 접어 둔 요약과 세션의 diff·토큰 집계는 영구다 —
      // "무엇을 했나"의 결론은 남기고 "어떻게 말했나"의 원문을 버리는 것이 그 축이다.
      const { rows: deleted } = await this.db.execute<{ id: string }>(sql`
        DELETE FROM activity a
         USING agent_session s
         WHERE a.session_id = s.id
           AND s.project_id = ${project.id}
           AND a.created_at < now() - make_interval(days => ${policy.activity_days})
        RETURNING a.id
      `);
      report.activities_deleted += deleted.length;

      // 리뷰 프롬프트 blob — 재생성 가능한 입력이라 TTL 이 짧다.
      // 리뷰 수집은 Phase 2 지만 스키마는 MVP 에 있으므로 집행도 지금부터 한다.
      const { rows: expired } = await this.db.execute<{ id: string }>(sql`
        UPDATE review_session
           SET prompt_blob_uri = NULL
         WHERE project_id = ${project.id}
           AND prompt_blob_uri IS NOT NULL
           AND created_at < now() - make_interval(days => ${policy.prompt_blob_ttl_days})
        RETURNING id
      `);
      report.blobs_expired += expired.length;
    }

    if (report.activities_deleted > 0 || report.blobs_expired > 0) {
      this.logger.log(
        `보존 정책 집행 — Activity ${report.activities_deleted}건 삭제 · blob ${report.blobs_expired}건 만료`,
      );
    }
    return report;
  }
}
