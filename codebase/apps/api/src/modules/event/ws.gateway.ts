// WebSocket 게이트웨이 — 경로 /ws (계약 정본 api.md §3.1·§3.2)
//
// socket.io 어댑터를 쓰되 **path 는 /ws** 이고 **전송은 websocket 만** 활성한다
// (폴링 폴백 off → k8s 스티키 세션 불필요, REQ-CB-014).
//
// 클라이언트 emit 은 join·leave 둘뿐이다. **상태를 바꾸는 emit 은 존재하지 않는다** —
// 쓰기는 REST/MCP 로만 한다(§3.2). 이 비대칭이 실시간 채널을 읽기 전용으로 묶어두는 방식이다.
//
// 룸 join 은 서버가 멤버십을 검사한다 — 판정은 AuthService 한 곳이고 SSE 도 같은 것을 쓴다(D-05).

import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { NERV_ERROR } from '@nerv/schema';
import { AuthService } from '../auth/auth.service.js';
import type { Principal } from '../auth/auth.service.js';
import { FanoutService, MAX_PROJECT_ROOMS } from './fanout.service.js';
import type { RoomName } from './fanout.service.js';

interface NervSocket {
  id: string;
  handshake: { headers: Record<string, string | undefined> };
  emit: (event: string, payload: unknown) => void;
  disconnect: (close?: boolean) => void;
  data: { principal?: Principal; rooms?: Set<RoomName>; off?: () => void };
}

interface JoinAck {
  ok: boolean;
  code?: string;
  room?: string;
}

@WebSocketGateway({
  path: '/ws',
  transports: ['websocket'],
  serveClient: false,
})
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WsGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly fanout: FanoutService,
  ) {}

  /**
   * 핸드셰이크 인증 — better-auth 세션 쿠키다. **PAT 접속은 지원하지 않는다**(§3.1):
   * 브라우저 밖 소비자는 SSE 를 쓴다. 실패하면 connect_error 에 코드를 실어 즉시 끊는다.
   *
   * 세션 쿠키 검증기는 E08-S01 이 AuthService 에 붙인다 — 그전까지 이 표면은 연결을 거절한다.
   */
  async handleConnection(socket: NervSocket): Promise<void> {
    const cookie = socket.handshake.headers['cookie'];
    if (cookie === undefined || !cookie.includes('better-auth.session_token=')) {
      socket.emit('connect_error', { code: NERV_ERROR.UNAUTHENTICATED });
      socket.disconnect(true);
      return;
    }

    try {
      const principal = await this.auth.verify({ kind: 'session', credential: cookie });
      socket.data.principal = principal;
      // user 룸은 연결 성공 시 서버가 자동 join 한다(§3.2)
      const rooms = new Set<RoomName>([`user:${principal.userId}`]);
      socket.data.rooms = rooms;
      socket.data.off = this.fanout.add({
        rooms,
        deliver: (envelope) => socket.emit(envelope.type, envelope),
      });
    } catch (error) {
      socket.emit('connect_error', {
        code: error instanceof Error && 'code' in error ? error.code : NERV_ERROR.UNAUTHENTICATED,
      });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: NervSocket): void {
    socket.data.off?.();
  }

  /** 클라이언트 emit 1/2 — 프로젝트 룸 참가. 서버가 멤버십을 검사한다. */
  @SubscribeMessage('join')
  async join(
    @MessageBody() body: { room?: string },
    @ConnectedSocket() socket: NervSocket,
  ): Promise<JoinAck> {
    const principal = socket.data.principal;
    const rooms = socket.data.rooms;
    if (principal === undefined || rooms === undefined) {
      return { ok: false, code: NERV_ERROR.UNAUTHENTICATED };
    }

    const room = String(body.room ?? '');
    const projectId = room.startsWith('project:') ? room.slice('project:'.length) : null;
    if (projectId === null) return { ok: false, code: NERV_ERROR.PRECONDITION };

    const projectRooms = [...rooms].filter((r) => r.startsWith('project:'));
    if (projectRooms.length >= MAX_PROJECT_ROOMS) {
      return { ok: false, code: NERV_ERROR.RATE_LIMIT };
    }

    try {
      await this.auth.assertMembership(principal.userId, projectId);
    } catch {
      // 비멤버는 ack 로 거절한다 — 연결은 끊지 않는다(§3.2)
      return { ok: false, code: NERV_ERROR.FORBIDDEN };
    }

    rooms.add(`project:${projectId}`);
    return { ok: true, room };
  }

  /** 클라이언트 emit 2/2 — 프로젝트 화면을 떠나면 보낸다. */
  @SubscribeMessage('leave')
  leave(@MessageBody() body: { room?: string }, @ConnectedSocket() socket: NervSocket): JoinAck {
    const rooms = socket.data.rooms;
    const room = String(body.room ?? '');
    if (rooms !== undefined && isRoom(room)) rooms.delete(room);
    return { ok: true, room };
  }
}

function isRoom(value: string): value is RoomName {
  return value.startsWith('project:') || value.startsWith('user:');
}
