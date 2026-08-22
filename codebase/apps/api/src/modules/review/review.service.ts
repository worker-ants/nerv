// 리뷰 수집(FR-09) — **Phase 2**.
// 테이블·서비스 골격은 MVP 스키마에 포함되지만 도구 2종(nerv_review_submit ·
// nerv_finding_resolve)과 S6 리뷰 센터는 MVP 범위 밖이다(scope.md §5).
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class ReviewService {
  submit(): never {
    throw new NotImplementedYetError('Phase 2', '리뷰 제출(FR-09)');
  }
}
