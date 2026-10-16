// SessionModule — 소유 테이블: agent_session · activity (§2.3)
// REST(세션 보드) · MCP(bootstrap) · ingest(훅) 세 표면이 같은 SessionService 를 공유한다.
// 오프라인 큐 실패 보고(ingest `outbox-failed`)의 판정은 OutboxReportService 한 곳이다(2026-10-16 · E21-S01).
import { Module } from '@nestjs/common';
import { EventModule } from '../event/event.module.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { ClaimModule } from '../task/claim.module.js';
import { ActivityService } from './activity.service.js';
import { IngestController } from './ingest.controller.js';
import { OutboxReportService } from './outbox-report.service.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { SessionTools } from './session.tools.js';

@Module({
  imports: [EventModule, AuthModule, ClaimModule],
  controllers: [SessionController, IngestController],
  providers: [
    SessionService,
    ActivityService,
    SessionTools,
    OutboxReportService,
    ProjectAccessGuard,
  ],
  exports: [SessionService],
})
export class SessionModule {}
