// WebSocket 연결 한 줄 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-054)
//
// **WebSocket 은 접근 로그에 닿지 않는다.** 업그레이드는 socket.io 가 HTTP 서버에서 직접
// 받아 Fastify 라우팅을 거치지 않는다 — 누가 언제 붙고 떨어졌는지, 거절됐는지가 어디에도
// 없었다. 연결·거절·해제에 한 줄씩, 룸 참가는 거절만 기본 수준에서 보인다.
//
// 앞문이 업그레이드 요청에 실어 준 `X-Request-Id` 를 연결의 ID 로 쓴다 — 연결과 해제의 두
// 줄이 같은 `req_id` 로 이어진다.

import type { LogLevel } from '@nestjs/common';
import { NERV_ERROR } from '@nerv/schema';
import type { StructuredMessage } from '../../common/nerv-logger.js';

export type WsAction = 'connect' | 'reject' | 'disconnect' | 'join';

export interface WsLogFields {
  socketId: string;
  userId?: string | null;
  code?: string | null;
  room?: string | null;
  rooms?: number;
  durationMs?: number;
}

/** 거절 코드의 수준 — 접근 로그와 같은 결이다. 받아들인 룸 참가는 잦아서 `debug` 다 */
export function wsLevel(action: WsAction, code: string | null = null): LogLevel {
  if (action === 'join' && code === null) return 'debug';
  if (code === NERV_ERROR.UNAUTHENTICATED || code === NERV_ERROR.FORBIDDEN) return 'warn';
  if (code === NERV_ERROR.RATE_LIMIT) return 'warn';
  return 'log';
}

/** `ws connect sid=… user=…` — text 는 문장, json 은 필드(`event: "ws"`) */
export function wsMessage(action: WsAction, fields: WsLogFields): StructuredMessage {
  const pairs: [string, string, string | number | null | undefined][] = [
    ['sid', 'socket_id', fields.socketId],
    ['user', 'user_id', fields.userId],
    ['code', 'code', fields.code],
    ['room', 'room', fields.room],
    ['rooms', 'rooms', fields.rooms],
    ['duration', 'duration_ms', fields.durationMs],
  ];
  const present = pairs.filter(
    (pair): pair is [string, string, string | number] => pair[2] !== null && pair[2] !== undefined,
  );
  const message: StructuredMessage = {
    message: [
      'ws',
      action,
      ...present.map(([short, , value]) =>
        short === 'duration' ? `${value}ms` : `${short}=${value}`,
      ),
    ].join(' '),
    event: 'ws',
    action,
  };
  for (const [, key, value] of present) message[key] = value;
  return message;
}
