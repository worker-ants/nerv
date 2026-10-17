// L1 — 부하 시험 집계(stats.ts). 판정이 틀리면 30분짜리 실행이 거짓 초록을 낸다.
import { describe, expect, it } from 'vitest';
import { percentile, probeOutcome, summarize, verdict } from './stats.js';
import type { BoardProbe } from './stats.js';

describe('percentile — 최근접 순위', () => {
  it('보간하지 않고 관측된 값을 돌려준다', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile([10, 20, 30], 95)).toBe(30);
  });

  it('비어 있으면 null', () => {
    expect(percentile([], 95)).toBeNull();
    expect(summarize([]).p95).toBeNull();
  });
});

describe('probeOutcome — 가장 늦은 소켓이 지연이다', () => {
  const probe = (received: Array<[number, number]>, expected = 3, aborted = false): BoardProbe => ({
    sentAt: 1_000,
    aborted,
    expected,
    received: new Map(received),
  });

  it('모두 받으면 가장 늦은 소켓의 지연', () => {
    expect(
      probeOutcome(
        probe([
          [0, 1_100],
          [1, 1_900],
          [2, 1_300],
        ]),
      ),
    ).toEqual({ kind: 'ok', latencyMs: 900 });
  });

  it('하나라도 받지 못했으면 missing', () => {
    expect(probeOutcome(probe([[0, 1_100]]))).toEqual({ kind: 'missing', missing: 2 });
  });

  it('요청이 실패한 전이와 지켜보는 소켓이 없는 프로젝트는 세지 않는다', () => {
    expect(probeOutcome(probe([], 3, true))).toBeNull();
    expect(probeOutcome(probe([], 0))).toBeNull();
  });
});

describe('verdict — 받지 못한 것은 기준을 넘긴 것으로 센다', () => {
  it('p95 가 기준 안이면 통과', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    expect(verdict('gate', 300, values).pass).toBe(true);
  });

  it('받지 못한 탐침이 5% 를 넘으면 지연이 짧아도 실패', () => {
    const values = Array.from({ length: 94 }, () => 10);
    expect(verdict('board', 5_000, values, 6).pass).toBe(false);
    expect(verdict('board', 5_000, values, 4).pass).toBe(true);
  });

  it('표본이 없으면 통과가 아니다', () => {
    expect(verdict('coverage', 1_000, []).pass).toBe(false);
  });
});
