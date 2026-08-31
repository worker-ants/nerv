// ApprovalModule — 소유 테이블: approval · question (§2.3)
import { Module } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../event/event.module.js';
// 결정은 **문서를 움직여야 한다** — 판정은 도메인 서비스 한 곳이다(D-05 · REQ-API-063)
import { SpecModule } from '../spec/spec.module.js';
import { ApprovalController, ApprovalInboxController } from './approval.controller.js';
import { ApprovalService } from './approval.service.js';
import { QuestionService } from './question.service.js';
import { QuestionTools } from './question.tools.js';

@Module({
  imports: [EventModule, AuthModule, SpecModule],
  controllers: [ApprovalController, ApprovalInboxController],
  providers: [ApprovalService, QuestionService, QuestionTools, ProjectAccessGuard],
  exports: [ApprovalService, QuestionService],
})
export class ApprovalModule {}
