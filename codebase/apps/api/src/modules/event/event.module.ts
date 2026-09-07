// EventModule — 소유 테이블: event · notification (codebase.md §2.3)
// 실시간 표면 2종(WS `/ws` · SSE `/sse/*`)이 여기 붙는다.
//
// 의존 방향: EventModule → AuthModule. 도메인 모듈들이 EventModule 을 import 하므로
// 반대 방향 의존을 만들지 않는다(순환 금지).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventCoreModule } from './event-core.module.js';
import { EventController } from './event.controller.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { EventSubscriberService } from './event-subscriber.service.js';
import { FanoutService } from './fanout.service.js';
import { NotificationService } from './notification.service.js';
import { SseAccessGuard } from './sse-access.guard.js';
import { SseController } from './sse.controller.js';
import { WsGateway } from './ws.gateway.js';

@Module({
  // 핵(EventService·ValkeyService)은 EventCoreModule 이 소유한다 — AuthService 도 그것을
  // 쓰므로, 여기서 다시 provide 하면 인스턴스가 둘이 된다(같은 이벤트를 두 번 방송한다).
  imports: [AuthModule, EventCoreModule],
  controllers: [EventController, SseController],
  providers: [
    ProjectAccessGuard,
    NotificationService,
    EventSubscriberService,
    FanoutService,
    SseAccessGuard,
    WsGateway,
  ],
  exports: [EventCoreModule, NotificationService, FanoutService, EventSubscriberService],
})
export class EventModule {}
