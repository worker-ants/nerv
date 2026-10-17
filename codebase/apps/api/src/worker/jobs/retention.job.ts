// 보존 정책 집행 — Activity 원문 TTL · 리뷰 프롬프트 blob TTL (spec-workflow §5.6) · 알림 180일 · 빈 activity 파티션 드랍
//
// **결론은 영구, 재생성 가능한 입력은 TTL.** clemvion 이 이미 검증한 절충이다 —
// `_prompts/`(리뷰 전체의 약 70%)를 "커밋 해시 + 스킬로 항상 재생성 가능"을 근거로
// 버렸는데도 결론만으로 60.7MB 에 도달했다. 그 교훈이 이 잡의 전부다.
//
// 프로젝트별 `retention` jsonb 가 기본값을 덮는다(api.md §2.1a) — 프로젝트마다 규제 요건이
// 다르기 때문이다. 상수는 최후의 기본값이고 정책이 있으면 정책이 이긴다.
import { Injectable, Logger } from '@nestjs/common';
import {
  effectiveRetention,
  IDEMPOTENCY_TTL_HOURS,
  NOTIFICATION_RETENTION_DAYS,
  SENT_MAIL_RETENTION_DAYS,
  SLACK_OUTBOX_RETENTION_DAYS,
} from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

export interface RetentionReport {
  activities_deleted: number;
  blobs_expired: number;
  projects_scanned: number;
  /** 만료된 멱등 키 행 수(api.md §1.5 — 24시간) */
  idempotency_keys_deleted: number;
  /** 치운 보낸 메일 행 수(database.md §2.17 — `SENT_MAIL_RETENTION_DAYS`) */
  sent_mail_deleted: number;
  /** 치운 Slack 발송 줄 수 — 보냈거나 건너뛴 것(database.md §2.18 — `SLACK_OUTBOX_RETENTION_DAYS`) */
  slack_deleted: number;
  /** 지운 알림 줄 수(database.md REQ-DB-046 — `NOTIFICATION_RETENTION_DAYS`) */
  notifications_deleted: number;
  /** 드랍한 빈 `activity` 월 파티션 수(database.md REQ-DB-047) */
  activity_partitions_dropped: number;
}

/** 월 파티션 이름 — `nerv_ensure_month_partitions` 의 `'"y"YYYY"m"MM'` 과 같은 규칙이다(database.md §2.14) */
const ACTIVITY_PARTITION_NAME = /^activity_y[0-9]{4}m[0-9]{2}$/;

@Injectable()
export class RetentionJob {
  readonly name = 'retention';
  private readonly logger = new Logger(RetentionJob.name);

  constructor(@InjectDb() private readonly db: NervDb) {}

  async run(): Promise<RetentionReport> {
    const report: RetentionReport = {
      activities_deleted: 0,
      blobs_expired: 0,
      projects_scanned: 0,
      idempotency_keys_deleted: 0,
      sent_mail_deleted: 0,
      slack_deleted: 0,
      notifications_deleted: 0,
      activity_partitions_dropped: 0,
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

    // **보낸 메일을 치운다**(2026-09-28 · 사람 결정 EM9 · REQ-DB-033). 스키마 주석과 DDL 정본은 처음부터
    // "보존 잡이 보낸 지 오래된 것을 치운다" 고 적었는데 이 잡에 그 삭제가 없었다 — 본문에는 링크와
    // 문서 제목이 들어 있고, 알림 메일 요약이 들어오면 날마다 쌓인다. 링크가 모두 죽은 뒤에는 남길
    // 까닭이 없다. 재시도를 포기한 줄(`failed_at`)은 원인을 보려고 남긴다(REQ-DB-026).
    const { rows: sentMail } = await this.db.execute<{ id: string }>(sql`
      DELETE FROM email_outbox
       WHERE sent_at IS NOT NULL
         AND sent_at < now() - make_interval(days => ${SENT_MAIL_RETENTION_DAYS})
      RETURNING id
    `);
    report.sent_mail_deleted = sentMail.length;

    // Slack 도 메일과 같다(2026-10-17 · REQ-DB-054) — 보냈거나 보내지 않기로 한 줄은 30일 뒤에 치우고, 포기한 줄은 원인을
    // 보려고 남긴다. 글에는 프로젝트 이름과 사람 이름이 있다
    const { rows: slackRows } = await this.db.execute<{ id: string }>(sql`
      DELETE FROM slack_outbox
       WHERE coalesce(sent_at, skipped_at) < now() - make_interval(days => ${SLACK_OUTBOX_RETENTION_DAYS})
      RETURNING id
    `);
    report.slack_deleted = slackRows.length;

    // **알림은 180일이다**(2026-10-16 · 사람 결정 ② · REQ-DB-046). 데이터 모델의 보존 표가 처음부터 정한 값인데 집행이 없어
    // 영구히 쌓였다. 알림은 이벤트에서 다시 만들 수 있는 파생 데이터라 지워도 잃는 것이 없다 — 원천(`event`)은 영구다.
    // 프로젝트 정책이 아니라 상수라 멱등 키처럼 프로젝트 순회 밖에서 한 번에 지운다(보관한 프로젝트의 알림도 같다).
    //
    // 기준은 `last_at` 이다 — 묶음은 처음 이벤트가 오래됐어도 어제 더해졌으면 어제의 알림이고, 목록도 그 순서로 줄을 세운다.
    // 읽음 · 안 읽음은 가리지 않는다(보존 표가 상태를 나누지 않는다). 묶음에 든 이벤트(`notification_batch_event`)는
    // FK 의 `ON DELETE CASCADE` 로 함께 지워진다. 지운 알림의 이벤트는 다시 알림이 되지 않는다: 도는 워커의 커서는 앞으로만
    // 가고, 새로 뜬 워커도 최근 한 시간만 다시 본다(REQ-API-317) — 180일 전의 이벤트는 어느 창에도 들지 않는다
    const { rows: staleNotifications } = await this.db.execute<{ id: string }>(sql`
      DELETE FROM notification
       WHERE last_at < now() - make_interval(days => ${NOTIFICATION_RETENTION_DAYS})
      RETURNING id
    `);
    report.notifications_deleted = staleNotifications.length;

    const { rows: projects } = await this.db.execute<{ id: string; retention: unknown }>(
      sql`SELECT id, retention FROM project WHERE archived_at IS NULL`,
    );

    for (const project of projects) {
      report.projects_scanned += 1;
      // 정책이 깨져 있어도 잡을 멈추지 않는다 — 기본값으로 돌고 경고를 남긴다.
      // 여기서 던지면 한 프로젝트의 오타가 전체 보존 정책을 멈춘다. 리뷰 제출이 원문의 만료를 정할 때도 같은 함수다
      const { retention: policy, valid } = effectiveRetention(project.retention);
      if (!valid) {
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
      // 삽입 시점에 채워지는데 아무도 읽지 않아, 그 열은 "만료를 정하는 값" 이 아니라 흔적이었다.
      // 둘 중 **먼저 오는 쪽**이 만료다: 프로젝트 정책을 줄이면 옛 행도 함께 짧아지고, 행이
      // 스스로 더 짧은 수명을 적었으면 그것도 지켜진다.
      //
      // **행의 만료는 받을 때의 정책이다**(2026-10-15 · 사람 결정). 예전에는 리뷰를 받을 때 상수
      // 30일을 적어서, 정책을 30일보다 늘려도 이 줄이 30일에 지웠다 — 늘리는 정책은 효과가 없었다.
      // 이제 review.service 가 그 프로젝트의 정책으로 적고, 정책을 바꾸면 EP-PRJ-04 가 남아 있는 원문의 만료를 새
      // 정책으로 다시 적는다(2026-10-16 · 사람 결정) — 늘린 정책도 줄인 정책도 이미 받은 원문에 적용된다.
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

    // 행을 지운 **뒤에** 빈 파티션을 본다 — 같은 판에서 마지막 행이 지워진 달도 곧바로 드랍된다
    report.activity_partitions_dropped = await this.dropEmptyActivityPartitions();

    if (
      report.activities_deleted > 0 ||
      report.blobs_expired > 0 ||
      report.idempotency_keys_deleted > 0 ||
      report.sent_mail_deleted > 0 ||
      report.slack_deleted > 0 ||
      report.notifications_deleted > 0 ||
      report.activity_partitions_dropped > 0
    ) {
      this.logger.log(
        `보존 정책 집행 — Activity ${report.activities_deleted}건 삭제 · blob ${report.blobs_expired}건 만료` +
          ` · 멱등 키 ${report.idempotency_keys_deleted}건 만료` +
          ` · 보낸 메일 ${report.sent_mail_deleted}건 정리` +
          ` · Slack 줄 ${report.slack_deleted}건 정리` +
          ` · 알림 ${report.notifications_deleted}건 삭제` +
          ` · 빈 activity 파티션 ${report.activity_partitions_dropped}개 드랍`,
      );
    }
    return report;
  }

  /**
   * **보존 기간을 넘긴 빈 `activity` 월 파티션을 드랍한다**(2026-10-16 · 사람 결정 ② · REQ-DB-047).
   *
   * 행은 위의 프로젝트 순회가 지운다. 그 뒤에 남는 것은 빈 테이블이고, 파티션은 달마다 하나씩 늘기만 했다(§2.14 의 재검토
   * 트리거가 세는 수다). 드랍하는 파티션은 셋을 모두 만족한다:
   *
   * 1. 이름이 마이그레이션의 함수(`nerv_ensure_month_partitions`)가 만드는 모양이고 `activity` 에 붙어 있다
   * 2. 그 달의 끝이 **모든 프로젝트의 `activity_days` 가운데 가장 긴 값**보다 오래됐다 — 어느 프로젝트에게도 아직 보존 기간
   *    안인 달은 남긴다. 보관한 프로젝트(보존 잡이 행을 지우지 않는다)의 정책도 센다. 현재 · 미래 달은 끝이 오지 않아 늘 남는다
   * 3. 행이 0 이다 — 남은 행이 있으면 드랍하지 않는다. 행을 지우는 것은 보존 잡의 접기 · 삭제이고(세션 요약에 남긴다),
   *    드랍은 그 뒤의 빈 껍데기만 치운다. 보관한 프로젝트의 행이 남은 달은 그래서 남는다
   *
   * **잠금은 기다리지 않는다**(`NOWAIT`). 파티션 드랍은 부모(`activity`)의 ACCESS EXCLUSIVE 잠금을 잡는데, 그것을 기다리는
   * 동안 뒤에 온 활동 쓰기(훅 수집)가 모두 그 뒤에 줄을 선다 — 백업(`pg_dump`)이 도는 몇 분이면 수집이 그만큼 멈춘다. 그래서
   * 곧바로 잡지 못하면 이번 판은 건너뛰고 다음 판(1시간 뒤)에 다시 본다. 빈 테이블이 한 시간 더 남는 것이 대가다.
   * 트랜잭션 advisory lock 은 드랍하는 쪽이 둘 이상이어도(잡 루프 밖에서 부른 호출) 같은 파티션을 한 번만 보게 한다.
   */
  private async dropEmptyActivityPartitions(): Promise<number> {
    const { rows: projects } = await this.db.execute<{ retention: unknown }>(
      sql`SELECT retention FROM project`,
    );
    // 프로젝트가 없으면 기본값이다 — 정책이 깨진 프로젝트도 보존 잡처럼 기본값으로 센다
    const keepDays = Math.max(
      effectiveRetention({}).retention.activity_days,
      ...projects.map((p) => effectiveRetention(p.retention).retention.activity_days),
    );

    const { rows: candidates } = await this.db.execute<{ name: string }>(sql`
      SELECT c.relname AS name
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = 'activity'::regclass
         AND c.relname ~ '^activity_y[0-9]{4}m[0-9]{2}$'
         AND to_date(c.relname, '"activity_y"YYYY"m"MM') + interval '1 month'
               <= now() - make_interval(days => ${keepDays})
       ORDER BY c.relname
    `);

    let dropped = 0;
    for (const { name } of candidates) {
      // 이름은 카탈로그에서 왔지만 식별자로 넣기 전에 모양을 한 번 더 본다
      if (!ACTIVITY_PARTITION_NAME.test(name)) continue;
      const partition = sql.identifier(name);
      try {
        const done = await this.db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${'retention:activity-partitions'}, 0))`,
          );
          // 앞선 호출이 이미 드랍했으면 카탈로그에 없다
          const { rows: still } = await tx.execute<{ attached: boolean }>(sql`
            SELECT EXISTS (
              SELECT 1 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
               WHERE i.inhparent = 'activity'::regclass AND c.relname = ${name}
            ) AS attached
          `);
          if (still[0]?.attached !== true) return false;
          await tx.execute(sql`LOCK TABLE ONLY activity IN ACCESS EXCLUSIVE MODE NOWAIT`);
          await tx.execute(sql`LOCK TABLE ${partition} IN ACCESS EXCLUSIVE MODE NOWAIT`);
          const { rows: sample } = await tx.execute<{ has_rows: boolean }>(
            sql`SELECT EXISTS (SELECT 1 FROM ${partition}) AS has_rows`,
          );
          if (sample[0]?.has_rows !== false) return false;
          await tx.execute(sql`DROP TABLE ${partition}`);
          return true;
        });
        if (done) dropped += 1;
      } catch (error) {
        // 잠금을 곧바로 얻지 못했다(55P03) — 다음 판에 다시 본다. 그 밖의 실패도 보존 잡 전체를 멈추지 않는다.
        // drizzle 은 원래 오류를 `cause` 에 둔다 — 문장보다 SQLSTATE 가 원인을 바로 말한다
        const cause = (error as { cause?: { code?: unknown } }).cause;
        const code = typeof cause?.code === 'string' ? cause.code : 'unknown';
        this.logger.warn(
          `activity 파티션 ${name}을 드랍하지 못했습니다(SQLSTATE ${code}) — 다음 판에 다시 봅니다`,
        );
      }
    }
    return dropped;
  }
}
