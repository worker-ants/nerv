// fail-open 격상 상태 맞추기 — 창이 지나면 풀고, 기준을 넘었는데 아직 아니면 올린다
// (2026-10-15 · 사람 결정 · Phase 2 E18-S02 · api.md REQ-API-319 · spec-workflow §4.6)
//
// 판정은 `modules/task/failopen.ts` 한 곳이다 — 잡은 부르기만 한다(D-05). 풀림은 이벤트가 생기지 않는 변화(시간이 지난
// 것)라 누가 와서 보기 전에는 아무도 모른다. 그래서 하트비트 간격으로 본다 — 창이 끝난 뒤 늦어도 1분 안에 풀린다.
// 받는 사람과 알림은 알림 라우팅(notification.job)이 정한다. 바꾼 프로젝트 수를 잡 러너가 로그로 남긴다(REQ-CB-054).
import { Injectable } from '@nestjs/common';
import { FailopenService } from '../../modules/task/failopen.service.js';

@Injectable()
export class FailopenJob {
  readonly name = 'failopen';

  constructor(private readonly failopen: FailopenService) {}

  run(): Promise<number> {
    return this.failopen.reconcile();
  }
}
