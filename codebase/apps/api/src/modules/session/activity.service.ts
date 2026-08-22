// Activity 적재 — 세션 모니터(S5)·활동 피드로 흐르는 typed 타임라인.
// 에이전트 진행 이벤트는 알림을 만들지 않는다(spec-workflow §6.3 말미).
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class ActivityService {
  append(): never {
    throw new NotImplementedYetError('E05-S01', 'Activity 행 적재');
  }

  timeline(): never {
    throw new NotImplementedYetError('E05-S01', '세션 Activity 타임라인');
  }
}
