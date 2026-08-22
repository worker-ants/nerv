// TaskModule — 소유 테이블: task · task_dependency · claim · evidence (§2.3)
import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { EventModule } from '../event/event.module.js';
import { ClaimService } from './claim.service.js';
import { TaskController } from './task.controller.js';
import { TaskService } from './task.service.js';
import { TaskTools } from './task.tools.js';

@Module({
  imports: [EventModule, ApprovalModule, AuthModule],
  controllers: [TaskController],
  providers: [TaskService, ClaimService, TaskTools, ProjectAccessGuard],
  exports: [TaskService, ClaimService],
})
export class TaskModule {}
