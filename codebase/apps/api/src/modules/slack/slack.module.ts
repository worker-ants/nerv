// Slack 채널 발신 (2026-10-17 · 사람 결정 D1 · D2 · E17-S03) — 알림 파생(EventModule)이 줄을 넣고 워커(SlackJob)가 보낸다
import { Module } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventCoreModule } from '../event/event-core.module.js';
import { SlackController } from './slack.controller.js';
import { SlackSender } from './slack.sender.js';
import { SlackService } from './slack.service.js';

@Module({
  imports: [AuthModule, EventCoreModule],
  controllers: [SlackController],
  providers: [ProjectAccessGuard, SlackService, SlackSender],
  exports: [SlackService, SlackSender],
})
export class SlackModule {}
