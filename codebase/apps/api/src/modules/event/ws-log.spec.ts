// WebSocket 연결 한 줄 (4.2 §5.5 · REQ-CB-054)

import { NERV_ERROR } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { wsLevel, wsMessage } from './ws-log.js';

describe('WebSocket 한 줄', () => {
  it('해제 — 소요와 룸 수를 싣는다', () => {
    expect(
      wsMessage('disconnect', { socketId: 's1', userId: 'u-1', rooms: 2, durationMs: 61000 }),
    ).toEqual({
      message: 'ws disconnect sid=s1 user=u-1 rooms=2 61000ms',
      event: 'ws',
      action: 'disconnect',
      socket_id: 's1',
      user_id: 'u-1',
      rooms: 2,
      duration_ms: 61000,
    });
  });

  it('값이 없는 필드는 싣지 않는다', () => {
    expect(wsMessage('reject', { socketId: 's2', code: NERV_ERROR.UNAUTHENTICATED }).message).toBe(
      `ws reject sid=s2 code=${NERV_ERROR.UNAUTHENTICATED}`,
    );
  });

  it('수준 — 받아들인 참가는 debug, 권한·인증·쿼터 거절은 warn', () => {
    expect(wsLevel('join')).toBe('debug');
    expect(wsLevel('join', NERV_ERROR.FORBIDDEN)).toBe('warn');
    expect(wsLevel('join', NERV_ERROR.PRECONDITION)).toBe('log');
    expect(wsLevel('reject', NERV_ERROR.UNAUTHENTICATED)).toBe('warn');
    expect(wsLevel('connect')).toBe('log');
    expect(wsLevel('disconnect')).toBe('log');
  });
});
