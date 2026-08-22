// EventModule — 소유 테이블: event · notification (codebase.md §2.3)
// 실시간 표면 2종(WS `/ws` · SSE `/sse/*`)이 여기 붙는다.
//
// 의존 방향: EventModule → AuthModule. 도메인 모듈들이 EventModule 을 import 하므로
// 반대 방향 의존을 만들지 않는다(순환 금지).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { EventSubscriberService } from './event-subscriber.service.js';
import { FanoutService } from './fanout.service.js';
import { NotificationService } from './notification.service.js';
import { SseAccessGuard } from './sse-access.guard.js';
import { SseController } from './sse.controller.js';
import { ValkeyService } from './valkey.service.js';
import { WsGateway } from './ws.gateway.js';

@Module({
  imports: [AuthModule],
  controllers: [EventController, SseController],
  providers: [
    ProjectAccessGuard,
    EventService,
    NotificationService,
    ValkeyService,
    EventSubscriberService,
    FanoutService,
    SseAccessGuard,
    WsGateway,
  ],
  exports: [
    EventService,
    ValkeyService,
    NotificationService,
    FanoutService,
    EventSubscriberService,
  ],
})
export class EventModule {}
