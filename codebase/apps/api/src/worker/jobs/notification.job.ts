// event → notification 라우팅 (인앱. Slack·메일은 Phase 2)
import { Injectable } from '@nestjs/common';
import { NotificationService } from '../../modules/event/notification.service.js';

@Injectable()
export class NotificationJob {
  readonly name = 'notification';
  constructor(private readonly notifications: NotificationService) {}

  run(): never {
    return this.notifications.route();
  }
}
