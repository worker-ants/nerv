// AuthModule — 소유 테이블: organization · user · project · membership · api_token (§2.3)
import { Module } from '@nestjs/common';
import { AuthController, ProjectController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';

@Module({
  controllers: [AuthController, ProjectController],
  providers: [AuthService, ProjectAccessGuard],
  exports: [AuthService],
})
export class AuthModule {}
