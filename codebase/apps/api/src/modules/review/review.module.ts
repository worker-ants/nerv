// ReviewModule — 소유 테이블 5종: review_session · reviewer_report · finding
// · finding_occurrence · resolution (§2.3). 표면(도구·REST)은 Phase 2 다.
import { Module } from '@nestjs/common';
import { ReviewService } from './review.service.js';

@Module({
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
