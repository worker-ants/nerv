// 잡 한 판의 로그 한 줄 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-054)
//
// **잡이 돌았는지조차 알 수 없었다**(2026-09-24). 잡마다 남기는 줄이 "처리 건수가 0 보다
// 클 때" 뿐이라, 조용한 워커가 "돌았는데 할 일이 없었다" 인지 "돌지 않았다" 인지 로그로 가를
// 수 없었다. 이제 판마다 한 줄 — 이름 · 소요 · 결과 — 이 남는다.
//
// **수준이 곧 소음 조절이다.** 할 일이 없던 판은 `debug` 다: 하트비트 간격 잡 넷이 분마다
// 돌고 임베딩은 밀려 있으면 초마다 돈다. 기본 수준(`log`)에서는 **일을 한 판과 실패한 판**
// 만 보이고, "돌기는 하는가" 가 궁금한 운영자는 `NERV_LOG_LEVEL=debug` 로 연다.

import type { LogLevel } from '@nestjs/common';
import type { StructuredMessage } from '../common/nerv-logger.js';

export interface JobSummary {
  /** 결과의 수치·참거짓 필드 — 숫자 하나를 돌려주는 잡은 `result` 하나다 */
  fields: Record<string, number | boolean>;
  /** 수치 하나라도 0 보다 크면 일을 한 판이다 */
  didWork: boolean;
}

/**
 * 잡의 반환값을 요약한다. 잡마다 모양이 달라(건수 · 보고서 객체) **수치와 참거짓만** 싣는다 —
 * 문자열(경로·오류 문장)은 길이를 가늠할 수 없어 줄을 불린다. 오류는 잡이 스스로 남긴다.
 */
export function summarizeJobResult(result: unknown): JobSummary {
  const fields: Record<string, number | boolean> = {};
  if (typeof result === 'number' || typeof result === 'boolean') {
    fields['result'] = result;
  } else if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'number' || typeof value === 'boolean') fields[key] = value;
    }
  }
  const didWork = Object.values(fields).some((value) => typeof value === 'number' && value > 0);
  return { fields, didWork };
}

export type JobOutcome = { ok: true; result: unknown } | { ok: false; error: unknown };

export function jobLevel(outcome: JobOutcome): LogLevel {
  if (!outcome.ok) return 'warn';
  return summarizeJobResult(outcome.result).didWork ? 'log' : 'debug';
}

/** `잡 lease-reaper 12ms result=3` — text 는 문장, json 은 필드(`event: "job"`) */
export function jobMessage(
  name: string,
  durationMs: number,
  outcome: JobOutcome,
): StructuredMessage {
  if (!outcome.ok) {
    return {
      message: `잡 실패 [${name}] ${durationMs}ms — ${String(outcome.error)}`,
      event: 'job',
      job: name,
      duration_ms: durationMs,
      outcome: 'failed',
    };
  }
  const { fields } = summarizeJobResult(outcome.result);
  const tail = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`);
  return {
    message: [`잡 ${name}`, `${durationMs}ms`, ...tail].join(' '),
    event: 'job',
    job: name,
    duration_ms: durationMs,
    outcome: 'ok',
    ...fields,
  };
}
