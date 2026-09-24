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
import { NERV_ERROR, WS_ERROR_EVENT } from '@nerv/schema';
import { AuthService } from '../auth/auth.service.js';
import type { Principal } from '../auth/auth.service.js';
import { requestContext, requestIdFrom } from '../../common/request-context.js';
import { FanoutService, MAX_PROJECT_ROOMS } from './fanout.service.js';
import type { RoomName } from './fanout.service.js';
import { wsLevel, wsMessage } from './ws-log.js';
import type { WsAction, WsLogFields } from './ws-log.js';

interface NervSocket {
  id: string;
  handshake: { headers: Record<string, string | undefined> };
  emit: (event: string, payload: unknown) => void;
  disconnect: (close?: boolean) => void;
  data: {
    principal?: Principal;
    rooms?: Set<RoomName>;
    off?: () => void;
    /** 연결의 ID — 앞문이 업그레이드 요청에 실은 `X-Request-Id`(ws-log.ts) */
    requestId?: string;
    connectedAt?: number;
  };
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
   * 브라우저 밖 소비자는 SSE 를 쓴다. 실패하면 거절 코드를 실어 보내고 즉시 끊는다.
   *
   * **거절 이벤트 이름을 상수에서 가져오는 이유**: socket.io 의 `connect_error` 는 예약어라
   * 서버가 emit 하면 예외를 던지고, 연결 핸들러에서 던진 예외는 프로세스를 죽인다 —
   * 미인증 브라우저 탭 하나가 API 를 크래시 루프에 빠뜨렸다(실측).
   */
  async handleConnection(socket: NervSocket): Promise<void> {
    socket.data.requestId = requestIdFrom(
      socket.handshake.headers['x-request-id'],
      socket.handshake.headers['cf-ray'],
    );
    socket.data.connectedAt = performance.now();
    const cookie = socket.handshake.headers['cookie'];
    if (cookie === undefined || !cookie.includes('better-auth.session_token=')) {
      this.record(socket, 'reject', { code: NERV_ERROR.UNAUTHENTICATED });
      socket.emit(WS_ERROR_EVENT, { code: NERV_ERROR.UNAUTHENTICATED });
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
      this.record(socket, 'connect', { userId: principal.userId });
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? error.code : NERV_ERROR.UNAUTHENTICATED;
      this.record(socket, 'reject', { code: String(code) });
      socket.emit(WS_ERROR_EVENT, { code });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: NervSocket): void {
    socket.data.off?.();
    // 받아들인 연결만 해제 줄을 남긴다 — 거절은 이미 한 줄이다
    if (socket.data.principal === undefined) return;
    const startedAt = socket.data.connectedAt;
    this.record(socket, 'disconnect', {
      userId: socket.data.principal.userId,
      rooms: socket.data.rooms?.size ?? 0,
      ...(startedAt === undefined ? {} : { durationMs: Math.round(performance.now() - startedAt) }),
    });
  }

  /** 연결 한 줄 — 연결의 ID 로 요청 맥락에 들어가 남긴다(ws-log.ts · §5.5) */
  private record(
    socket: NervSocket,
    action: WsAction,
    fields: Omit<WsLogFields, 'socketId'> = {},
  ): void {
    const run = (): void => {
      this.logger[wsLevel(action, fields.code ?? null)](
        wsMessage(action, { socketId: socket.id, ...fields }),
      );
    };
    const id = socket.data.requestId;
    if (id === undefined) run();
    else requestContext.run({ requestId: id }, run);
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
    if (projectId === null) return this.joined(socket, null, NERV_ERROR.PRECONDITION);

    const projectRooms = [...rooms].filter((r) => r.startsWith('project:'));
    if (projectRooms.length >= MAX_PROJECT_ROOMS) {
      return this.joined(socket, room, NERV_ERROR.RATE_LIMIT);
    }

    try {
      await this.auth.assertMembership(principal.userId, projectId);
    } catch {
      // 비멤버는 ack 로 거절한다 — 연결은 끊지 않는다(§3.2)
      return this.joined(socket, room, NERV_ERROR.FORBIDDEN);
    }

    rooms.add(`project:${projectId}`);
    return this.joined(socket, room, null);
  }

  /** 룸 참가의 ack 와 한 줄 — 받아들인 참가는 debug, 거절은 기본 수준에서 보인다 */
  private joined(socket: NervSocket, room: string | null, code: string | null): JoinAck {
    // 룸 이름은 부르는 쪽이 적은 문자열이다 — 모양이 맞을 때만 줄에 싣는다(개행으로 가짜 줄을
    // 끼워 넣지 못하게)
    const loggable = room !== null && LOGGABLE_ROOM.test(room) ? room : null;
    this.record(socket, 'join', {
      userId: socket.data.principal?.userId ?? null,
      room: loggable,
      code,
    });
    if (code !== null) return { ok: false, code };
    return { ok: true, room: room ?? '' };
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

const LOGGABLE_ROOM = /^(?:project|user):[A-Za-z0-9-]{1,64}$/;

function isRoom(value: string): value is RoomName {
  return value.startsWith('project:') || value.startsWith('user:');
}
