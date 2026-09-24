// 로거 — Nest `ConsoleLogger` 에 요청 ID 와 형식을 더한다 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-052·053)
//
// 전역 로거를 이것으로 바꾸면 `new Logger(ctx)` 로 만든 기존 로거 전부가 여기로 온다 —
// 서비스가 남기던 줄에 **손대지 않고** 요청 ID 가 붙는다. 요청 밖(기동·워커 잡)에서는
// 아무것도 붙지 않는다.
//
// 형식은 `NERV_LOG_FORMAT` 이 정한다. `text` 는 사람이 터미널에서 읽는 모양이고 `json` 은
// **한 줄에 JSON 하나**라 수집기가 필드로 거른다. 두 진입점(`main.ts` · `worker.ts`)이
// `nervLoggerFromEnv()` 하나로 만든다 — 따로 만들면 언젠가 한쪽만 형식이 바뀐다.

import { ConsoleLogger } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import { logLevelsFromEnv } from './log-level.js';
import { currentRequestId } from './request-context.js';

export type LogFormat = 'text' | 'json';

const FORMATS: readonly LogFormat[] = ['text', 'json'];

/**
 * 비면 `text` — `pnpm dev` 는 사람이 터미널에서 읽는다. 컨테이너 배치는 compose·k8s 가
 * `json` 을 넘긴다(§5.3 · §6). 코드 기본을 `json` 으로 두면 개발 루프가 JSON 을 읽게 되고,
 * 컨테이너 기본을 `text` 로 두면 운영 수집기가 줄을 필드로 가르지 못한다.
 */
const DEFAULT_FORMAT: LogFormat = 'text';

export function logFormatFromEnv(env: NodeJS.ProcessEnv = process.env): LogFormat {
  const typed = (env['NERV_LOG_FORMAT'] ?? '').trim().toLowerCase();
  if (typed === '') return DEFAULT_FORMAT;
  if ((FORMATS as readonly string[]).includes(typed)) return typed as LogFormat;
  // **모르는 값에 침묵하지 않는다** — NERV_LOG_LEVEL 과 같은 규칙이다(log-level.ts).
  // 로거를 세우기 전이라 `console` 이다 — 운영자용 설정 오류는 카탈로그 밖이다(REQ-CB-022 예외)
  console.warn(
    `NERV_LOG_FORMAT="${typed}" 은 알 수 없는 값입니다 — ${DEFAULT_FORMAT} 로 시작합니다. ` +
      `가능한 값: ${FORMATS.join(' · ')}`,
  );
  return DEFAULT_FORMAT;
}

/**
 * 구조화 메시지 — 사람이 읽는 문장(`message`)과 수집기가 거르는 필드를 함께 싣는다.
 * `text` 에서는 문장만, `json` 에서는 필드를 줄의 최상위에 펼친다. 접근 로그가 이 모양이다.
 */
export interface StructuredMessage {
  message: string;
  [field: string]: unknown;
}

function isStructured(value: unknown): value is StructuredMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/** `json` 한 줄의 고정 키 — 구조화 메시지의 필드가 이것을 덮지 못한다 */
const RESERVED = new Set(['level', 'pid', 'timestamp', 'message', 'context', 'stack', 'req_id']);

/** `ConsoleLogger` 의 JSON 한 줄 + 요청 ID + 구조화 필드 */
interface JsonLogObject {
  level: LogLevel;
  pid: number;
  timestamp: number;
  message: unknown;
  context?: string;
  stack?: unknown;
  req_id?: string;
  [field: string]: unknown;
}

export class NervLogger extends ConsoleLogger {
  protected override formatContext(context: string): string {
    const base = super.formatContext(context);
    const id = currentRequestId();
    return id === null ? base : `${base}[req=${id}] `;
  }

  /** `text` — 구조화 메시지는 문장만 찍는다. 객체를 그대로 넘기면 여러 줄로 펼쳐진다 */
  protected override stringifyMessage(message: unknown, logLevel: LogLevel): string {
    return super.stringifyMessage(
      isStructured(message) ? message.message : message,
      logLevel,
    ) as string;
  }

  protected override getJsonLogObject(
    message: unknown,
    options: {
      context: string;
      logLevel: LogLevel;
      writeStreamType?: 'stdout' | 'stderr';
      errorStack?: unknown;
    },
  ): JsonLogObject {
    const object: JsonLogObject = super.getJsonLogObject(message, options);
    const id = currentRequestId();
    if (id !== null) object.req_id = id;
    if (!isStructured(message)) return object;
    object.message = message.message;
    for (const [key, value] of Object.entries(message)) {
      if (!RESERVED.has(key)) object[key] = value;
    }
    return object;
  }
}

/** 두 진입점이 같은 로거를 세운다 — 수준(`NERV_LOG_LEVEL`)과 형식(`NERV_LOG_FORMAT`) */
export function nervLoggerFromEnv(env: NodeJS.ProcessEnv = process.env): NervLogger {
  // `json` 이면 Nest 가 색을 끄고 `compact` 를 켜서 한 줄로 찍는다(JSON.stringify) — 색 코드가
  // 섞이면 한 줄이 더는 JSON 이 아니다. `colors` 를 따로 넘기지 않는 이유가 그것이다.
  return new NervLogger({
    logLevels: logLevelsFromEnv(env),
    json: logFormatFromEnv(env) === 'json',
  });
}
