// ApprovalModule — 소유 테이블: approval · question (§2.3)
import { Module } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../event/event.module.js';
import { ApprovalController } from './approval.controller.js';
import { ApprovalService } from './approval.service.js';
import { QuestionService } from './question.service.js';
import { QuestionTools } from './question.tools.js';

@Module({
  imports: [EventModule, AuthModule],
  controllers: [ApprovalController],
  providers: [ApprovalService, QuestionService, QuestionTools, ProjectAccessGuard],
  exports: [ApprovalService, QuestionService],
})
export class ApprovalModule {}
