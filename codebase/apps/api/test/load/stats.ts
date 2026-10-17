// 부하 시험의 집계 — 순수 함수만 둔다(L1 `stats.spec.ts` 가 본다)

export interface Summary {
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

/**
 * 최근접 순위(nearest-rank) 백분위. 보간하지 않는다 — 판정은 "실제로 관측된 값 가운데 95% 가 이 안" 이어야
 * 하고, 보간한 값은 아무도 겪지 않은 지연이다.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? null,
  };
}

/**
 * 보드 반영 탐침 하나 — 상태 전이 요청을 보낸 시각과, 그 프로젝트 룸에 있는 소켓마다 받은 시각.
 *
 * 지연은 **가장 늦게 받은 소켓**의 값이다. NFR-02 는 "보드에 반영된다" 이고 그 보드는 지켜보는 사람
 * 모두의 화면이다 — 한 소켓이라도 늦으면 그 사람의 보드는 늦다.
 */
export interface BoardProbe {
  sentAt: number;
  /** 요청이 실패해 이벤트가 나오지 않을 전이 — 집계에서 뺀다 */
  aborted: boolean;
  expected: number;
  received: Map<number, number>;
}

export type ProbeOutcome =
  { kind: 'ok'; latencyMs: number } | { kind: 'missing'; missing: number } | null;

export function probeOutcome(probe: BoardProbe): ProbeOutcome {
  if (probe.aborted || probe.expected === 0) return null;
  if (probe.received.size < probe.expected) {
    return { kind: 'missing', missing: probe.expected - probe.received.size };
  }
  let latest = 0;
  for (const at of probe.received.values()) latest = Math.max(latest, at - probe.sentAt);
  return { kind: 'ok', latencyMs: latest };
}

export interface Verdict {
  name: string;
  limitMs: number;
  summary: Summary;
  /** 받지 못한 탐침 — 기준을 넘긴 것으로 센다(오지 않은 반영은 늦은 반영이다) */
  missing: number;
  pass: boolean;
}

/**
 * p95 가 기준 안이면 통과다. 받지 못한 탐침은 무한대 지연으로 넣어 계산한다 — 빼고 계산하면 가장 나쁜
 * 경우를 지우고 통과시킨다. 표본이 없으면 통과가 아니다(잰 것이 없으면 판정도 없다).
 */
export function verdict(
  name: string,
  limitMs: number,
  values: readonly number[],
  missing = 0,
): Verdict {
  const summary = summarize(values);
  const withMissing = [
    ...values,
    ...Array.from({ length: missing }, () => Number.POSITIVE_INFINITY),
  ];
  const p95 = percentile(
    withMissing.sort((a, b) => a - b),
    95,
  );
  return {
    name,
    limitMs,
    summary,
    missing,
    pass: withMissing.length > 0 && p95 !== null && p95 <= limitMs,
  };
}
