// MCP 도구 호출 한 줄 (4.2 §5.5 · REQ-CB-054)

import { NERV_ERROR } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { toolCallLevel, toolCallMessage, toolCallOutcome } from './tool-call-log.js';

describe('결과 읽기', () => {
  it('성공은 코드가 없다', () => {
    expect(toolCallOutcome({ content: [], structuredContent: { ok: true } })).toEqual({
      code: null,
      kind: null,
    });
  });

  it('실패 봉투에서 코드와 kind 만 읽는다 — 문장은 읽지 않는다', () => {
    const result = {
      isError: true,
      structuredContent: {
        ok: false,
        code: NERV_ERROR.FORBIDDEN,
        message: '권한이 없습니다',
        details: { kind: 'missing_scope', required: 'task:claim' },
      },
    };
    expect(toolCallOutcome(result)).toEqual({ code: NERV_ERROR.FORBIDDEN, kind: 'missing_scope' });
  });
});

describe('수준', () => {
  it('서버 실패는 error, 권한·인증·쿼터는 warn, 입력·전제조건은 log', () => {
    expect(toolCallLevel({ code: null, kind: null })).toBe('log');
    expect(toolCallLevel({ code: NERV_ERROR.UNAVAILABLE, kind: 'internal' })).toBe('error');
    expect(toolCallLevel({ code: NERV_ERROR.FORBIDDEN, kind: null })).toBe('warn');
    expect(toolCallLevel({ code: NERV_ERROR.RATE_LIMIT, kind: null })).toBe('warn');
    expect(toolCallLevel({ code: NERV_ERROR.PRECONDITION, kind: 'invalid_input' })).toBe('log');
  });
});

describe('한 줄', () => {
  it('성공 — 세션과 무시한 인자 수를 싣는다', () => {
    const message = toolCallMessage(
      { tool: 'nerv_task_claim', sessionId: 's-1', ignoredArgs: 2 },
      { code: null, kind: null },
      12,
    );
    expect(message).toEqual({
      message: 'tools/call nerv_task_claim ok 12ms session=s-1 ignored_args=2',
      event: 'mcp_tool',
      tool: 'nerv_task_claim',
      outcome: 'ok',
      duration_ms: 12,
      session_id: 's-1',
      ignored_args: 2,
    });
  });

  it('모르는 도구는 이름을 싣지 않는다 — 부르는 쪽이 적은 문자열이다', () => {
    const message = toolCallMessage(
      { tool: null, sessionId: null, ignoredArgs: 0 },
      { code: NERV_ERROR.PRECONDITION, kind: 'unknown_tool' },
      1,
    );
    expect(message.message).toBe(
      `tools/call (unknown) ${NERV_ERROR.PRECONDITION} 1ms kind=unknown_tool`,
    );
  });
});
