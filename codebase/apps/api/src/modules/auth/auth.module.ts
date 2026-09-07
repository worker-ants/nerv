// AuthModule — 소유 테이블: organization · user · project · membership · api_token (§2.3)
import { Module } from '@nestjs/common';
import { AuthController, ProjectController } from './auth.controller.js';
import { InvitationController } from './invitation.controller.js';
import { InvitationService } from './invitation.service.js';
import { AuthService } from './auth.service.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { EventCoreModule } from '../event/event-core.module.js';

@Module({
  // 권한·토큰·프로젝트의 변경도 감사에 남는다(REQ-API-151) — 의존 없는 핵만 들인다
  imports: [EventCoreModule],
  controllers: [AuthController, ProjectController, InvitationController],
  providers: [AuthService, InvitationService, ProjectAccessGuard],
  exports: [AuthService, InvitationService],
})
export class AuthModule {}
