// TaskModule — 소유 테이블: task · task_dependency · claim · evidence (§2.3)
import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { EventModule } from '../event/event.module.js';
import { SessionModule } from '../session/session.module.js';
import { ClaimService } from './claim.service.js';
import { TaskController } from './task.controller.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';
import { TaskService } from './task.service.js';
import { TaskTools } from './task.tools.js';

@Module({
  imports: [EventModule, ApprovalModule, AuthModule, SessionModule],
  controllers: [TaskController, WebhookController],
  providers: [TaskService, ClaimService, TaskTools, WebhookService, ProjectAccessGuard],
  exports: [TaskService, ClaimService],
})
export class TaskModule {}
