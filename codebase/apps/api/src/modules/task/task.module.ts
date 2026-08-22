// TaskModule — 소유 테이블: task · task_dependency · claim · evidence (§2.3)
import { Module } from '@nestjs/common';
import { EventModule } from '../event/event.module.js';
import { ClaimService } from './claim.service.js';
import { TaskController } from './task.controller.js';
import { TaskService } from './task.service.js';
import { TaskTools } from './task.tools.js';

@Module({
  imports: [EventModule],
  controllers: [TaskController],
  providers: [TaskService, ClaimService, TaskTools],
  exports: [TaskService, ClaimService],
})
export class TaskModule {}
