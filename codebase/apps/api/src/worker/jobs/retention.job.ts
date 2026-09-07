// 보존 정책 집행 — Activity 원문 TTL · 리뷰 프롬프트 blob TTL (spec-workflow §5.6)
//
// **결론은 영구, 재생성 가능한 입력은 TTL.** clemvion 이 이미 검증한 절충이다 —
// `_prompts/`(리뷰 전체의 약 70%)를 "커밋 해시 + 스킬로 항상 재생성 가능"을 근거로
// 버렸는데도 결론만으로 60.7MB 에 도달했다. 그 교훈이 이 잡의 전부다.
//
// 프로젝트별 `retention` jsonb 가 기본값을 덮는다(api.md §2.1a) — 프로젝트마다 규제 요건이
// 다르기 때문이다. 상수는 최후의 기본값이고 정책이 있으면 정책이 이긴다.
import { Injectable, Logger } from '@nestjs/common';
import { IDEMPOTENCY_TTL_HOURS, REVIEW_PROMPT_BLOB_TTL_DAYS, RetentionSchema } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

export interface RetentionReport {
  activities_deleted: number;
  blobs_expired: number;
  projects_scanned: number;
  /** 만료된 멱등 키 행 수(api.md §1.5 — 24시간) */
  idempotency_keys_deleted: number;
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
      idempotency_keys_deleted: 0,
    };

    // 멱등 키는 **24시간**이다(api.md §1.5). 프로젝트 정책이 아니라 계약이 정한 값이라
    // 프로젝트 순회 밖에서 한 번에 지운다 — 행에 project_id 가 없는 이유이기도 하다
    // (주체는 프로젝트가 아니라 자격증명이다).
    //
    // 오래된 키를 남겨 두는 것은 저장 비용의 문제가 아니다: 하루 지난 키의 재생은
    // 재시도가 아니라 사고다 — 어제의 응답을 오늘의 요청에 돌려주는 일이 된다.
    const { rows: staleKeys } = await this.db.execute<{ id: string }>(sql`
      DELETE FROM idempotency_key
       WHERE created_at < now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})
      RETURNING id
    `);
    report.idempotency_keys_deleted = staleKeys.length;

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
      //
      // **키별로 더한다**(2026-09-07 · REQ-CB-032). 예전에는 jsonb `||` 였는데 그 연산자는
      // 같은 키를 **덮어쓴다** — 활동이 90일 경계를 여러 시간에 걸쳐 넘는 세션은 두 번째
      // 실행에서 첫 번째 집계가 통째로 지워지고 마지막 몫만 남았다. 수는 남아 있으니
      // 아무도 눈치채지 못한다: 규모를 남기려고 접는 것인데 규모가 틀린다.
      //
      // 합산은 **재실행에 멱등하지 않다** — 접었는데 삭제 전에 죽으면 다음 실행이 같은
      // 행을 다시 더한다. 그래서 접기와 삭제를 한 트랜잭션에 묶는다(예전 `||` 는 덮어써서
      // 우연히 멱등이었고, 그 우연이 사라지는 것이 이 변경의 대가다).
      const deletedIds = await this.db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE agent_session s
             SET activity_summary = (
                   SELECT coalesce(jsonb_object_agg(m.k, m.v), '{}'::jsonb)
                     FROM (
                       SELECT u.k, sum(u.v)::int AS v
                         FROM (
                           SELECT key AS k, value::int AS v
                             FROM jsonb_each_text(coalesce(s.activity_summary, '{}'::jsonb))
                           UNION ALL
                           SELECT key, value::int FROM jsonb_each_text(rolled.counts)
                         ) u
                        GROUP BY u.k
                     ) m
                 )
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
        const { rows } = await tx.execute<{ id: string }>(sql`
          DELETE FROM activity a
           USING agent_session s
           WHERE a.session_id = s.id
             AND s.project_id = ${project.id}
             AND a.created_at < now() - make_interval(days => ${policy.activity_days})
          RETURNING a.id
        `);
        return rows;
      });
      report.activities_deleted += deletedIds.length;

      // 리뷰 프롬프트 blob — 재생성 가능한 입력이라 TTL 이 짧다.
      // 리뷰 수집은 Phase 2 지만 스키마는 MVP 에 있으므로 집행도 지금부터 한다.
      //
      // **행에 적힌 만료 시각도 읽는다**(2026-09-07 · REQ-CB-032). `prompt_expires_at` 은
      // 삽입 시점에 채워지는데(review.service — `now() + 30 days`) 아무도 읽지 않아,
      // 그 열은 "만료를 정하는 값" 이 아니라 흔적이었다. 둘 중 **먼저 오는 쪽**이 만료다:
      // 프로젝트 정책을 줄이면 옛 행도 함께 짧아지고, 행이 스스로 더 짧은 수명을 적었으면
      // 그것도 지켜진다.
      const { rows: expired } = await this.db.execute<{ id: string }>(sql`
        UPDATE review_session
           SET prompt_blob_uri = NULL
         WHERE project_id = ${project.id}
           AND prompt_blob_uri IS NOT NULL
           AND (created_at < now() - make_interval(days => ${policy.prompt_blob_ttl_days})
                OR prompt_expires_at < now())
        RETURNING id
      `);
      report.blobs_expired += expired.length;
    }

    if (
      report.activities_deleted > 0 ||
      report.blobs_expired > 0 ||
      report.idempotency_keys_deleted > 0
    ) {
      this.logger.log(
        `보존 정책 집행 — Activity ${report.activities_deleted}건 삭제 · blob ${report.blobs_expired}건 만료` +
          ` · 멱등 키 ${report.idempotency_keys_deleted}건 만료`,
      );
    }
    return report;
  }
}
