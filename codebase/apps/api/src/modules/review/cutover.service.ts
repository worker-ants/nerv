// SoT 컷오버 M1 — 게이트 판정에 로컬 판정을 함께 받아 견주고, 2주 관측 지표를 낸다
// (2026-10-16 · 사람 결정 D6 · Phase 2 E21-S03 · api.md EP-REV-08b · EP-REV-10 · REQ-API-346 ~ 350 · roadmap §7.4 ~ §7.6)
//
// **판정이 갈리면 서버가 이긴다, 단 조용히 지지 않는다**(roadmap §7.4 규칙 3). 이중화 기간에는 로컬 훅과 NERV 가 같은 push 를 각자
// 판정한다. 불일치율을 세려면 같은 커밋의 두 판정이 한 자리에 있어야 해서, 로컬 훅이 게이트 판정을 물을 때(EP-REV-08 의 POST
// 변형) 자기 판정을 함께 보낸다(D6 = A). 그 호출 수가 곧 분모다 — 불일치만 보고받으면 분모를 모르고(B), 사후 대조는 그 push 에 서버
// 판정을 적용할 수 없다(C).
//
// 판정은 지금과 같은 함수 하나다(`ReviewService.gateCheck` — EP-REV-08 GET 과 같은 결과). 이 파일은 그 결과를 로컬 판정과 견주어
// 남기고, 컷오버 단계에 따라 어느 판정을 적용하는지 응답에 적고, 이중화 기간의 새 불일치를 이벤트로 남길 뿐이다(D-05).

import { Injectable } from '@nestjs/common';
import {
  canReadCutoverReport,
  CUTOVER_MISMATCH_ROLLBACK_PCT,
  CUTOVER_MISMATCH_STABLE_BELOW_PCT,
  CUTOVER_OBSERVATION_DAYS,
  CUTOVER_RECENT_MISMATCHES,
  CUTOVER_REPORT_ROLES,
  CUTOVER_SUBMIT_FAILURE_ROLLBACK_PCT,
  msg,
  NERV_ERROR,
  NERV_EVENT_PHASE2,
  newId,
} from '@nerv/schema';
import type { CutoverStatus, GateVerdict, ReviewSot } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import type { RoundVerdict } from './review-gate.js';
import { ReviewService } from './review.service.js';

/** 리뷰 제출을 다시 보내다 거절된 도구 — `session.outbox_failed` 의 항목 가운데 이 도구만 리뷰 제출 실패로 센다 */
const REVIEW_SUBMIT_TOOL = 'nerv_review_submit';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 서버 판정 — 물은 종류가 모두 통과(`passed` · `waived`)면 `pass` 다. 종류가 하나도 없으면 막을 것이 없어 `pass` 다(GET 과 같다) */
export function serverVerdictOf(items: readonly Pick<RoundVerdict, 'state'>[]): GateVerdict {
  return items.every((item) => item.state === 'passed' || item.state === 'waived')
    ? 'pass'
    : 'block';
}

/**
 * 지표의 상태(`CUTOVER_STATUSES`) — 롤백이 먼저다. 비율은 **정수로 견준다**(불일치 × 100 ≥ 비교 수 × 5): 1% · 5% · 2% 경계가
 * 부동소수 오차로 흔들리지 않게 한다. 기준값은 로드맵의 것이다(§7.5 · §7.6 — 상수의 주석).
 */
export function cutoverStatus(input: {
  comparisons: number;
  mismatches: number;
  submissions: number;
  failed: number;
}): { status: CutoverStatus; reasons: ('mismatch_rate' | 'submit_failure_rate')[] } {
  const reasons: ('mismatch_rate' | 'submit_failure_rate')[] = [];
  if (
    input.comparisons > 0 &&
    input.mismatches * 100 >= input.comparisons * CUTOVER_MISMATCH_ROLLBACK_PCT
  ) {
    reasons.push('mismatch_rate');
  }
  if (
    input.submissions > 0 &&
    input.failed * 100 >= input.submissions * CUTOVER_SUBMIT_FAILURE_ROLLBACK_PCT
  ) {
    reasons.push('submit_failure_rate');
  }
  if (reasons.length > 0) return { status: 'rollback', reasons };
  if (input.comparisons === 0) return { status: 'no_data', reasons };
  if (input.mismatches * 100 < input.comparisons * CUTOVER_MISMATCH_STABLE_BELOW_PCT) {
    return { status: 'stable', reasons };
  }
  return { status: 'watch', reasons };
}

/** 쉼표 목록 → 정렬한 중복 없는 목록. 비면 `null`(종류를 묻지 않았다 — GET 과 같다) */
function kindList(kind: string | null | undefined): string[] | null {
  if (kind == null) return null;
  const kinds = [
    ...new Set(
      kind
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k !== ''),
    ),
  ].sort();
  return kinds.length === 0 ? null : kinds;
}

/** ISO 시각 → Date. 없으면 `null`, 읽을 수 없으면 400 */
function timeParam(value: string | null | undefined, field: string): Date | null {
  if (value == null || value.trim() === '') return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
      kind: 'invalid_input',
      field,
      unknown: [value],
      allowed: ['ISO 8601 time'],
    });
  }
  return new Date(at);
}

const pct = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

@Injectable()
export class CutoverService {
  constructor(
    private readonly reviews: ReviewService,
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * EP-REV-08b — 게이트 판정을 내고 로컬 판정과 견준다(REQ-API-346 · 347).
   *
   * **응답의 판정은 GET 과 같다**(`items` — 같은 함수). 그 위에 어느 판정이 적용되는지(`applied`)와 그 판정(`verdict`)을 적는다 — 컷오버
   * 전(`git`)에는 로컬 훅이 진실이고 NERV 는 관측만 하므로 `local`, 이중화 기간(`dual`)과 그 뒤(`nerv`)에는 `server` 다(roadmap §7.4 표).
   *
   * **같은 비교는 한 번만 센다** — (프로젝트 · 브랜치 · 종류 · 커밋 · 로컬 판정)이 같으면 `repeat_count` 만 올린다. 판정은 처음 것이
   * 남는다. 이중화 기간의 **새** 불일치만 `gate.verdict_mismatch` 를 낸다 — 재시도가 알림을 되풀이하지 않는다.
   */
  async checkWithLocal(input: {
    projectId: string;
    userId: string;
    isAgent: boolean;
    branch: string;
    kind: string | null;
    headSha: string;
    local: { verdict: GateVerdict; hook: string | null; reason: string | null };
  }): Promise<Record<string, unknown>> {
    const kinds = kindList(input.kind);
    // 판정은 GET 과 같은 함수다 — 모르는 종류는 여기서 400 이다
    const judged = await this.reviews.gateCheck({
      projectId: input.projectId,
      branch: input.branch,
      kinds,
      headSha: input.headSha,
    });
    const server = serverVerdictOf(judged.items);
    const localPass = input.local.verdict === 'pass';
    const match = (server === 'pass') === localPass;
    const states = judged.items.map((item) => ({ kind: item.kind, state: item.state }));

    const outcome = await this.events.transact(async (tx, emit) => {
      const { rows: projectRows } = await tx.execute<{ review_sot: ReviewSot }>(
        sql`SELECT review_sot::text AS review_sot FROM project WHERE id = ${input.projectId}`,
      );
      const sot: ReviewSot = projectRows[0]?.review_sot ?? 'git';
      const kindsKey = kinds?.join(',') ?? '';
      // 먼저 넣어 본다 — 같은 비교가 이미 있으면 유일 인덱스가 막고 아무것도 돌려주지 않는다. 겹친 두 호출은 인덱스가 줄 세운다
      const { rows: inserted } = await tx.execute<{ id: string }>(sql`
        INSERT INTO gate_verdict_comparison
          (id, project_id, branch, kinds, head_sha, local_pass, local_hook, local_reason, server_pass,
           server_states, review_sot, actor_user_id)
        VALUES (${newId()}, ${input.projectId}, ${input.branch}, ${kindsKey}, ${input.headSha}, ${localPass},
                ${input.local.hook}, ${input.local.reason}, ${server === 'pass'},
                ${JSON.stringify(states)}::jsonb, ${sot}::review_sot, ${input.userId})
        ON CONFLICT (project_id, branch, kinds, head_sha, local_pass) DO NOTHING
        RETURNING id
      `);
      const fresh = inserted[0];
      if (fresh === undefined) {
        const { rows } = await tx.execute<{ id: string; repeat_count: number }>(sql`
          UPDATE gate_verdict_comparison
             SET repeat_count = repeat_count + 1, last_seen_at = now()
           WHERE project_id = ${input.projectId} AND branch = ${input.branch} AND kinds = ${kindsKey}
             AND head_sha = ${input.headSha} AND local_pass = ${localPass}
          RETURNING id, repeat_count
        `);
        return {
          sot,
          id: rows[0]?.id ?? null,
          counted: false,
          calls: rows[0]?.repeat_count ?? 1,
          reported: false,
        };
      }
      // **이중화 기간의 새 불일치만 알린다**(REQ-API-347). 컷오버 전에는 로컬 훅이 진실이라 NERV 의 다른 판정은 관측일 뿐이고,
      // M2 뒤에는 로컬 훅이 보조라 그 판정이 다른 것은 컷오버의 위험이 아니다 — 둘 다 비교 표에는 남아 지표가 센다
      const reported = !match && sot === 'dual';
      if (reported) {
        await emit({
          type: NERV_EVENT_PHASE2.GATE_VERDICT_MISMATCH,
          projectId: input.projectId,
          subjectType: 'project',
          subjectId: input.projectId,
          actorUserId: input.userId,
          isAgent: input.isAgent,
          // 훅이 적은 이유 원문은 넣지 않는다 — 이벤트는 감사 로그이고 비교 표에 원문이 있다(data-model §5.4)
          payload: {
            comparison_id: fresh.id,
            branch: input.branch,
            head_sha: input.headSha,
            kinds,
            local: { verdict: input.local.verdict, hook: input.local.hook },
            server: { verdict: server, states },
            review_sot: sot,
          },
        });
      }
      return { sot, id: fresh.id, counted: true, calls: 1, reported };
    });

    const applied = outcome.sot === 'git' ? 'local' : 'server';
    return {
      ...judged,
      review_sot: outcome.sot,
      applied,
      verdict: applied === 'server' ? server : input.local.verdict,
      comparison: {
        id: outcome.id,
        local: input.local.verdict,
        server,
        match,
        counted: outcome.counted,
        calls: outcome.calls,
        reported: outcome.reported,
      },
    };
  }

  /**
   * EP-REV-10 — 컷오버 지표(REQ-API-349). 창은 `since` ~ `until` 이고 기본은 컷오버 단계를 바꾼 시각 ~ 지금이다(바꾼 적이 없으면
   * 최근 14일). **불일치율** = 창 안의 비교 가운데 두 판정이 다른 것 / 비교 수(같은 비교의 재호출은 세지 않는다). **리뷰 제출 실패율** =
   * 실패 / (받은 제출 + 실패) — 받은 제출은 `review.submitted`, 실패는 `session.outbox_failed` 의 항목 가운데 `nerv_review_submit` 이다.
   * 바로 거절돼 부른 쪽이 받은 4xx(EP-REV-01 · 도구 오류)는 세지 않는다 — 서버는 그 시도를 기록하지 않는다(로그의 `mcp_tool` 줄뿐).
   */
  async report(input: {
    projectId: string;
    roles: readonly string[];
    since?: string | null;
    until?: string | null;
  }): Promise<Record<string, unknown>> {
    if (!canReadCutoverReport(input.roles)) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.cutover.role_required'), {
        kind: 'role_required',
        allowed_roles: CUTOVER_REPORT_ROLES,
      });
    }
    const sinceParam = timeParam(input.since, 'since');
    const untilParam = timeParam(input.until, 'until');
    // 시각은 밀리초 수로 받는다 — 문자열 모양(`2026-10-16 13:43:18.802123+00`)을 JS 가 읽는 방식에 기대지 않는다. 시계는 DB 의 것이다
    const { rows: projectRows } = await this.db.execute<{
      review_sot: ReviewSot;
      review_sot_since: number | null;
      now: number;
    }>(sql`
      SELECT review_sot::text AS review_sot,
             (extract(epoch FROM review_sot_since) * 1000)::float8 AS review_sot_since,
             (extract(epoch FROM now()) * 1000)::float8 AS now
        FROM project WHERE id = ${input.projectId}
    `);
    const project = projectRows[0];
    if (project === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
        kind: 'not_found',
      });
    }
    const now = new Date(Math.floor(Number(project.now)));
    const switchedAt =
      project.review_sot_since === null
        ? null
        : new Date(Math.floor(Number(project.review_sot_since)));
    const until = untilParam ?? now;
    const since =
      sinceParam ?? switchedAt ?? new Date(until.getTime() - CUTOVER_OBSERVATION_DAYS * DAY_MS);
    if (since.getTime() >= until.getTime()) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.cutover.bad_window'), {
        kind: 'invalid_input',
        field: 'since',
        allowed: ['since < until'],
      });
    }
    const from = since.toISOString();
    const to = until.toISOString();

    const { rows: countRows } = await this.db.execute<{
      total: number;
      mismatches: number;
      server_blocked: number;
      server_passed: number;
      repeats: number;
    }>(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE local_pass <> server_pass)::int AS mismatches,
             -- 로컬은 통과시켰는데 서버가 막았다 · 로컬은 막았는데 서버가 통과시켰다 — 원인을 찾는 방향이 다르다
             count(*) FILTER (WHERE local_pass AND NOT server_pass)::int AS server_blocked,
             count(*) FILTER (WHERE NOT local_pass AND server_pass)::int AS server_passed,
             coalesce(sum(repeat_count - 1), 0)::int AS repeats
        FROM gate_verdict_comparison
       WHERE project_id = ${input.projectId} AND created_at >= ${from} AND created_at < ${to}
    `);
    const counts = countRows[0] ?? {
      total: 0,
      mismatches: 0,
      server_blocked: 0,
      server_passed: 0,
      repeats: 0,
    };

    const { rows: submitRows } = await this.db.execute<{ accepted: number; failed: number }>(sql`
      SELECT
        (SELECT count(*) FROM event
          WHERE project_id = ${input.projectId} AND type = ${NERV_EVENT_PHASE2.REVIEW_SUBMITTED}
            AND occurred_at >= ${from} AND occurred_at < ${to})::int AS accepted,
        (SELECT count(*) FROM event e
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.payload->'items', '[]'::jsonb)) AS item
          WHERE e.project_id = ${input.projectId} AND e.type = ${NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED}
            AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
            AND item->>'tool' = ${REVIEW_SUBMIT_TOOL})::int AS failed
    `);
    const accepted = submitRows[0]?.accepted ?? 0;
    const failed = submitRows[0]?.failed ?? 0;
    const submissions = accepted + failed;

    const { rows: recent } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.branch, c.head_sha, nullif(c.kinds, '') AS kinds,
             CASE WHEN c.local_pass THEN 'pass' ELSE 'block' END AS local,
             c.local_hook AS hook, c.local_reason AS reason,
             CASE WHEN c.server_pass THEN 'pass' ELSE 'block' END AS server,
             c.server_states AS states, c.review_sot::text AS review_sot, c.repeat_count AS calls,
             c.created_at, c.actor_user_id AS by_user_id, u.display_name AS by
        FROM gate_verdict_comparison c
        JOIN "user" u ON u.id = c.actor_user_id
       WHERE c.project_id = ${input.projectId} AND c.created_at >= ${from} AND c.created_at < ${to}
         AND c.local_pass <> c.server_pass
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ${CUTOVER_RECENT_MISMATCHES}
    `);

    const verdict = cutoverStatus({
      comparisons: counts.total,
      mismatches: counts.mismatches,
      submissions,
      failed,
    });
    const days = Math.round(((until.getTime() - since.getTime()) / DAY_MS) * 10) / 10;
    return {
      review_sot: project.review_sot,
      review_sot_since: switchedAt?.toISOString() ?? null,
      window: {
        since: from,
        until: to,
        days,
        observation_days: CUTOVER_OBSERVATION_DAYS,
        complete: days >= CUTOVER_OBSERVATION_DAYS,
      },
      comparisons: {
        total: counts.total,
        mismatches: counts.mismatches,
        rate: pct(counts.mismatches, counts.total),
        server_blocked: counts.server_blocked,
        server_passed: counts.server_passed,
        repeats: counts.repeats,
      },
      submissions: {
        accepted,
        failed,
        total: submissions,
        rate: pct(failed, submissions),
      },
      status: verdict.status,
      reasons: verdict.reasons,
      thresholds: {
        stable_below_pct: CUTOVER_MISMATCH_STABLE_BELOW_PCT,
        rollback_mismatch_pct: CUTOVER_MISMATCH_ROLLBACK_PCT,
        rollback_submit_failure_pct: CUTOVER_SUBMIT_FAILURE_ROLLBACK_PCT,
      },
      recent_mismatches: recent,
    };
  }
}
