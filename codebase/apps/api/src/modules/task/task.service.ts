// Task 도메인 서비스 — 상태 전이 · 위임 명세 · 증적(evidence)
// 메서드 이름은 docs/04-mvp/api.md §4 대응표의 "내부 서비스 메서드" 열과 1:1 이다.
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';
import { ClaimService } from './claim.service.js';

@Injectable()
export class TaskService {
  constructor(
    private readonly claims: ClaimService,
    private readonly events: EventService,
  ) {}

  /** nerv_task_next · EP-TASK-02 — 의존성 그래프 ready 판정 */
  next(): never {
    throw new NotImplementedYetError('E04-S05', 'ready 큐 질의');
  }

  /** nerv_task_claim · EP-TASK-06 — 겹침 판정·원자 전환은 ClaimService 안 */
  claim(): never {
    throw new NotImplementedYetError('E04-S01', '원자적 클레임');
  }

  /** nerv_task_heartbeat · EP-TASK-07 — 응답의 pending 역채널 포함 */
  heartbeat(): never {
    throw new NotImplementedYetError('E04-S03', '하트비트·리스 연장');
  }

  /** nerv_task_release · EP-TASK-08 */
  release(): never {
    throw new NotImplementedYetError('E04-S01', '클레임 해제');
  }

  /** nerv_task_update · EP-TASK-09 — done 게이트 판정의 단일 지점 */
  transition(): never {
    throw new NotImplementedYetError('E09-S05', 'Task 상태 전이·done 게이트');
  }
}
