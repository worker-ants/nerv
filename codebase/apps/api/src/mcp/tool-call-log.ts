// MCP 도구 호출 한 줄 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-054)
//
// **접근 로그만으로는 MCP 가 전부 `POST /mcp 200` 이다.** JSON-RPC 는 도구의 실패도 200 에
// `isError` 로 싣기 때문이다 — 권한 부족·입력 오류·세션 해소 실패가 모델에게는 돌아가는데
// 운영자 로그에는 없어서, 에이전트가 같은 호출을 왜 되풀이하는지 로그로 추적할 수 없었다.
// 같은 요청의 접근 로그와 `req_id` 로 이어진다.
//
// **싣지 않는 것**: 인자 값(스펙 본문이 실린다) · 결과 본문 · 에러 문장(로케일 문장이고, 인자를
// 되풀이할 수 있다). 코드와 `details.kind` 만 싣는다.

import type { LogLevel } from '@nestjs/common';
import { NERV_ERROR } from '@nerv/schema';
import type { StructuredMessage } from '../common/nerv-logger.js';

export interface ToolCallNote {
  /** 레지스트리에 있는 이름일 때만 — 모르는 이름은 부르는 쪽이 적은 문자열이다 */
  tool: string | null;
  sessionId: string | null;
  ignoredArgs: number;
}

export interface ToolCallOutcome {
  code: string | null;
  kind: string | null;
}

/** 도구 결과에서 실패 코드를 읽는다 — `toolError` 가 만든 봉투(`structuredContent`)다 */
export function toolCallOutcome(result: unknown): ToolCallOutcome {
  if (result === null || typeof result !== 'object') return { code: null, kind: null };
  const { isError, structuredContent } = result as {
    isError?: unknown;
    structuredContent?: { code?: unknown; details?: { kind?: unknown } };
  };
  if (isError !== true) return { code: null, kind: null };
  const code = typeof structuredContent?.code === 'string' ? structuredContent.code : 'unknown';
  const kind = structuredContent?.details?.kind;
  return { code, kind: typeof kind === 'string' ? kind : null };
}

/**
 * 수준 — 접근 로그와 같은 결이다. 서버 쪽 실패(`UNAVAILABLE`)는 `error`, 사람이 문의해 오는
 * 권한·인증·쿼터는 `warn`, 나머지(입력·전제조건 — 에이전트가 고칠 일)는 `log`.
 */
export function toolCallLevel(outcome: ToolCallOutcome): LogLevel {
  switch (outcome.code) {
    case null:
      return 'log';
    case NERV_ERROR.UNAVAILABLE:
      return 'error';
    case NERV_ERROR.UNAUTHENTICATED:
    case NERV_ERROR.FORBIDDEN:
    case NERV_ERROR.HUMAN_ONLY:
    case NERV_ERROR.RATE_LIMIT:
      return 'warn';
    default:
      return 'log';
  }
}

/** `tools/call nerv_task_claim ok 12ms session=…` — text 는 문장, json 은 필드(`event: "mcp_tool"`) */
export function toolCallMessage(
  note: ToolCallNote,
  outcome: ToolCallOutcome,
  durationMs: number,
): StructuredMessage {
  const tool = note.tool ?? '(unknown)';
  const result = outcome.code ?? 'ok';
  const tail = [
    outcome.kind === null ? null : `kind=${outcome.kind}`,
    note.sessionId === null ? null : `session=${note.sessionId}`,
    note.ignoredArgs > 0 ? `ignored_args=${note.ignoredArgs}` : null,
  ].filter((part): part is string => part !== null);
  const message: StructuredMessage = {
    message: ['tools/call', tool, result, `${durationMs}ms`, ...tail].join(' '),
    event: 'mcp_tool',
    tool,
    outcome: result,
    duration_ms: durationMs,
  };
  if (outcome.kind !== null) message['kind'] = outcome.kind;
  if (note.sessionId !== null) message['session_id'] = note.sessionId;
  if (note.ignoredArgs > 0) message['ignored_args'] = note.ignoredArgs;
  return message;
}
