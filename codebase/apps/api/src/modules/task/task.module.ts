// TaskModule — 소유 테이블: task · task_dependency · claim · evidence (§2.3)
import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { EventModule } from '../event/event.module.js';
import { SessionModule } from '../session/session.module.js';
import { ClaimModule } from './claim.module.js';
import { TaskController } from './task.controller.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';
import { TaskService } from './task.service.js';
import { TaskTools } from './task.tools.js';

@Module({
  imports: [EventModule, ApprovalModule, AuthModule, SessionModule, ClaimModule],
  controllers: [TaskController, WebhookController],
  providers: [TaskService, TaskTools, WebhookService, ProjectAccessGuard],
  // ClaimService 는 ClaimModule 이 소유한다 — 모듈을 재수출해 쓰는 쪽이 그대로 받는다
  exports: [TaskService, ClaimModule],
})
export class TaskModule {}
