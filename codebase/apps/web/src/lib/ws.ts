// WebSocket 클라이언트 — 경로 /ws (계약 정본 docs/04-mvp/api.md §3.1·§3.2)
//
// 규약 세 가지를 클라이언트 쪽에서 지킨다.
//   ① **websocket 전송만** — 폴링 폴백을 켜지 않는다(REQ-CB-014). 폴백이 없어야 k8s 스티키가 불필요하다
//   ② 클라이언트 emit 은 join·leave 둘뿐이다. 쓰기는 REST/MCP 로만 한다
//   ③ 재연결 시 활성 쿼리를 전부 무효화한다 — replay 는 없다(D-14)
//
// 실제 구독·배너·토스트 배선은 E05-S03·E08-S01 이 얹는다. 여기는 연결 규약까지다.

import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { WS_ERROR_EVENT } from '@nerv/schema';
import type { NervEventEnvelope } from '@nerv/schema';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface NervSocketHandlers {
  onEvent: (event: NervEventEnvelope) => void;
  onStateChange: (state: ConnectionState) => void;
}

/** 연결당 join 가능한 project 룸 상한 — 서버와 같은 값(api.md §3.2) */
export const MAX_PROJECT_ROOMS = 8;

export function connectNervSocket(handlers: NervSocketHandlers): Socket {
  const socket = io({
    path: '/ws',
    transports: ['websocket'], // 폴링 폴백 off
    withCredentials: true, // 핸드셰이크는 better-auth 세션 쿠키로 검증된다
  });

  socket.on('connect', () => handlers.onStateChange('connected'));
  socket.on('disconnect', () => handlers.onStateChange('disconnected'));
  // 서버의 거절 사유. socket.io 의 connect_error 는 예약어라 서버가 쓸 수 없어
  // 별도 이름으로 온다(@nerv/schema WS_ERROR_EVENT).
  socket.on(WS_ERROR_EVENT, () => handlers.onStateChange('disconnected'));
  socket.onAny((name: string, payload: NervEventEnvelope) => {
    if (name === WS_ERROR_EVENT) return;
    handlers.onEvent(payload);
  });

  return socket;
}

export function joinProjectRoom(socket: Socket, projectId: string): void {
  socket.emit('join', { room: `project:${projectId}` });
}

export function leaveProjectRoom(socket: Socket, projectId: string): void {
  socket.emit('leave', { room: `project:${projectId}` });
}
