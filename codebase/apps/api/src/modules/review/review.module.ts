// ReviewModule — 소유 테이블 5종: review_session · reviewer_report · finding
// · finding_occurrence · resolution (§2.3).
//
// 표면(도구 2종 · REST)은 **Phase 2 에 들어왔다**(2026-08-23 — scope.md §5 착수 기록).
// S6 리뷰 센터 화면은 아직 없다: 데이터가 먼저 있어야 화면이 보여줄 것이 생긴다.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../event/event.module.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { ReviewTools } from './review.tools.js';

@Module({
  imports: [EventModule, AuthModule],
  controllers: [ReviewController],
  providers: [ReviewService, ReviewTools, ProjectAccessGuard],
  exports: [ReviewService],
})
export class ReviewModule {}
