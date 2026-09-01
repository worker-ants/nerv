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

/**
 * **들어간 룸은 연결이 기억한다**(2026-09-01 — 사람 보고 · REQ-WEB-127).
 *
 * 재연결 자체는 socket.io 가 알아서 했다. 그런데 룸 join 은 화면의 effect 가 하고 있었고,
 * 그 effect 는 `projectId` 가 바뀔 때만 돈다 — 재연결은 그것을 바꾸지 않는다. 그래서
 * 소켓은 붙어 있는데 **어느 룸에도 없는** 상태가 됐고, 이벤트가 하나도 안 왔다.
 * 사람 눈에는 "재연결이 안 된다" 로 보인다.
 *
 * 룸은 **연결의 성질**이지 화면의 성질이 아니다 — 연결이 그것을 들고 있어야 한다.
 */
const joined = new Set<string>();

export function connectNervSocket(handlers: NervSocketHandlers): Socket {
  const socket = io({
    path: '/ws',
    transports: ['websocket'], // 폴링 폴백 off
    withCredentials: true, // 핸드셰이크는 better-auth 세션 쿠키로 검증된다
    // **무제한 재시도 · 최대 1분**(사람 결정). 서버 재기동이 5분 걸려도 사람이 새로고침
    // 하지 않아도 되고, 1분 상한이라 오래 끊긴 뒤에도 붙는 데 1분 넘게 걸리지 않는다.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 60_000,
    randomizationFactor: 0.5,
  });

  socket.on('connect', () => {
    handlers.onStateChange('connected');
    // **재연결이면 룸부터 되찾는다.** 이 줄이 없으면 붙어 있어도 아무것도 안 온다
    for (const room of joined) socket.emit('join', { room });
  });
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
  const room = `project:${projectId}`;
  joined.add(room);
  socket.emit('join', { room });
}

export function leaveProjectRoom(socket: Socket, projectId: string): void {
  const room = `project:${projectId}`;
  joined.delete(room);
  socket.emit('leave', { room });
}

/** 소켓을 새로 만들 때 — 기억은 연결과 함께 사라져야 한다(로그아웃·계정 전환) */
export function forgetRooms(): void {
  joined.clear();
}

/** 테스트가 들여다보는 자리 — 재연결 후 무엇을 다시 넣었는지가 검사 대상이다 */
export function joinedRoomsForTesting(): string[] {
  return [...joined];
}
