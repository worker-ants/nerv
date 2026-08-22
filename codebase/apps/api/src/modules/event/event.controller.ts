// REST — 이벤트 피드 · 알림 (docs/04-mvp/api.md §2.7)
import { Controller, Get, Param } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from './event.service.js';
import { NotificationService } from './notification.service.js';

@Controller('api/v1')
export class EventController {
  constructor(
    private readonly events: EventService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('projects/:proj/events')
  feed(@Param('proj') _proj: string): never {
    throw new NotImplementedYetError('E05-S04', '이벤트 피드 조회');
  }

  @Get('me/notifications')
  myNotifications(): never {
    throw new NotImplementedYetError('E13-S03', '알림 수신함 조회');
  }
}
