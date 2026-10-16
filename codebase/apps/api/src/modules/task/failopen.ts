// fail-open 격상 상태 — 시간 창 안의 횟수로 판정한다
// (2026-10-15 · 사람 결정 · Phase 2 E18-S02 · api.md REQ-API-319 · 320 · spec-workflow §4.6)
//
// **판정은 여기 한 곳이다**(D-05). 격상 · 해제를 내는 서비스(`failopen.service.ts`), 프로젝트 조회의 `failopen_status`
// (EP-PRJ-03), 워커 잡이 같은 함수로 같은 사실을 본다. 셋이 각자 세면 배너는 꺼졌는데 알림은 오거나 그 반대가 된다.
//
// **격상 상태는 이벤트에서 파생한다 — 표를 두지 않는다.** 그 프로젝트의 가장 나중 `gate.failopen_escalated` ·
// `gate.failopen_cleared` 가 격상이면 격상이다. 상태를 열에 두면 이벤트와 열이 어긋날 자리가 하나 더 생긴다(D-10 —
// 진실은 event 한 곳). 두 이벤트는 대상이 프로젝트라 `event_subject` 인덱스로 찾는다 — 프로젝트의 이벤트를 다 훑지 않는다.

import { NERV_EVENT, NERV_EVENT_PHASE2, effectiveGatePolicy } from '@nerv/schema';
import type { GatePolicy } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { NervDb } from '../../common/database.module.js';

type Executor = Pick<NervDb, 'execute'>;

/** EP-PRJ-03 의 `failopen_status` — 배너가 그리는 값 */
export interface FailopenStatus {
  /** 지금 격상인가 */
  escalated: boolean;
  /** 창 안의 fail-open 수 */
  count: number;
  /** 격상 기준(정책) */
  escalate_count: number;
  /** 시간 창(정책 · 시간) */
  window_hours: number;
  /** 지금 격상이면 그 격상 이벤트의 시각, 아니면 null */
  escalated_at: string | null;
  /** 창 안의 가장 나중 fail-open 시각 — 없으면 null */
  last_at: string | null;
}

/**
 * 창의 시작 시각. 이벤트의 `occurred_at` 은 앱의 시계로 찍힌다(`EventService.append`) — 같은 시계로 잰다.
 * 정책의 시간은 1 이상의 정수일 뿐 상한이 없어서 DB 의 interval 로 만들면 큰 값에서 넘친다. 1970 앞으로는 가지 않는다
 */
export function failopenWindowStart(windowHours: number, now: number = Date.now()): string {
  return new Date(Math.max(0, now - windowHours * 3_600_000)).toISOString();
}

/** 프로젝트의 fail-open 정책 — 저장된 정책이 스키마에 맞지 않으면 기본 정책이다(REQ-API-240) */
export async function failopenPolicy(
  db: Executor,
  projectId: string,
): Promise<GatePolicy['failopen']> {
  const { rows } = await db.execute<{ gate_policy: unknown }>(
    sql`SELECT gate_policy FROM project WHERE id = ${projectId}`,
  );
  return effectiveGatePolicy(rows[0]?.gate_policy).policy.failopen;
}

/** 지금의 격상 상태 — 창 안의 수와 가장 나중 격상 · 해제 이벤트 */
export async function failopenStatus(
  db: Executor,
  projectId: string,
  policy: GatePolicy['failopen'],
  now: number = Date.now(),
): Promise<FailopenStatus> {
  const since = failopenWindowStart(policy.window_hours, now);
  const { rows } = await db.execute<{
    count: number;
    last_at: string | null;
    state: string | null;
    state_at: string | null;
  }>(sql`
    SELECT w.count, w.last_at::text AS last_at, s.type AS state, s.occurred_at::text AS state_at
      FROM (SELECT count(*)::int AS count, max(e.occurred_at) AS last_at
              FROM event e
             WHERE e.project_id = ${projectId} AND e.type = ${NERV_EVENT.GATE_FAILOPEN}
               AND e.occurred_at > ${since}) w
      LEFT JOIN LATERAL (
        SELECT e.type, e.occurred_at FROM event e
         WHERE e.subject_type = 'project' AND e.subject_id = ${projectId}
           AND e.type IN (${NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED},
                          ${NERV_EVENT_PHASE2.GATE_FAILOPEN_CLEARED})
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT 1
      ) s ON true
  `);
  const row = rows[0];
  const escalated = row?.state === NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED;
  const iso = (value: string | null | undefined): string | null =>
    value == null ? null : new Date(value).toISOString();
  return {
    escalated,
    count: row?.count ?? 0,
    escalate_count: policy.escalate_count,
    window_hours: policy.window_hours,
    escalated_at: escalated ? iso(row?.state_at) : null,
    last_at: iso(row?.last_at),
  };
}

/** 창 안의 fail-open 을 게이트마다 센다 — 격상 이벤트가 무엇이 판정하지 못했는지 남긴다 */
export async function failopenByGate(
  db: Executor,
  projectId: string,
  since: string,
): Promise<Record<string, number>> {
  const { rows } = await db.execute<{ gate: string | null; n: number }>(sql`
    SELECT e.payload->>'gate' AS gate, count(*)::int AS n
      FROM event e
     WHERE e.project_id = ${projectId} AND e.type = ${NERV_EVENT.GATE_FAILOPEN}
       AND e.occurred_at > ${since}
     GROUP BY 1
  `);
  return Object.fromEntries(rows.map((r) => [r.gate ?? 'unknown', r.n]));
}

/** 격상해야 하는가 · 풀어야 하는가 — 규칙은 이 한 줄이다(spec-workflow §4.6) */
export function failopenDue(status: FailopenStatus): 'escalate' | 'clear' | null {
  if (!status.escalated && status.count >= status.escalate_count) return 'escalate';
  if (status.escalated && status.count === 0) return 'clear';
  return null;
}
