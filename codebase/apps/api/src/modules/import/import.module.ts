// ImportModule — 소유 테이블 없음. Spec·Task 계열에 소급 적재만 한다(§2.3).
import { Module } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../event/event.module.js';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';

@Module({
  imports: [EventModule, AuthModule],
  controllers: [ImportController],
  providers: [ImportService, ProjectAccessGuard],
  exports: [ImportService],
})
export class ImportModule {}
