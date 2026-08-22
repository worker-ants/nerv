// WebSocket 게이트웨이 — 경로 /ws (계약 정본 docs/04-mvp/api.md §3.1)
//
// socket.io 어댑터를 쓰되 **path 는 /ws** 이고 **전송은 websocket 만** 활성한다
// (폴링 폴백 off → k8s 스티키 세션 불필요, REQ-CB-014). 클라이언트 emit 은 join·leave 둘뿐이며
// 상태를 바꾸는 emit 은 존재하지 않는다 — 쓰기는 REST/MCP 로만(api.md §3.2).
// 핸드셰이크 쿠키 검증·룸 멤버십 검사·팬아웃 배선은 E05-S02 소관이다.

import { Logger } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { AuthService } from '../auth/auth.service.js';
import { EventService } from './event.service.js';

@WebSocketGateway({
  path: '/ws',
  transports: ['websocket'],
  serveClient: false,
})
export class WsGateway {
  private readonly logger = new Logger(WsGateway.name);

  // 표면은 번역만 한다 — join 의 멤버십 판정은 AuthService 한 곳이 내린다(D-05 · REQ-CB-003).
  constructor(
    private readonly auth: AuthService,
    private readonly events: EventService,
  ) {}
}
