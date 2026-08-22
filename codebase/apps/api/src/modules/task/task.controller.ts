// REST — Task · 클레임 (docs/04-mvp/api.md §2.4)
//
// 표면은 번역만 한다(REQ-CB-003). 그런데 번역할 것이 아직 없다 — TaskService 의 클레임 엔진은
// 구현됐지만(E04), 이 컨트롤러가 넘겨야 할 **인증 컨텍스트**(principal · project_id 해소 ·
// session_id)가 E03-S02 에서 온다. 그때까지 표면은 열지 않는다: 주체를 모르는 채 클레임을
// 만들면 "누가 이 작업을 한다"는 선언 자체가 성립하지 않는다.
// 엔진의 동작은 그동안 L2 통합 테스트가 실제 DB 상대로 지킨다(codebase.md §4.3).

import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { TaskService } from './task.service.js';

@Controller('api/v1/projects/:proj/tasks')
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  /** EP-TASK-02 */
  @Get('next')
  next(@Param('proj') _proj: string): never {
    throw new NotImplementedYetError('E03-S02', 'ready 큐 REST 표면 — 인증 컨텍스트 배선 대기');
  }

  /** EP-TASK-06 */
  @Post(':task/claim')
  claim(): never {
    throw new NotImplementedYetError('E03-S02', '클레임 REST 표면 — 인증 컨텍스트 배선 대기');
  }

  /** EP-TASK-07 */
  @Post(':task/heartbeat')
  heartbeat(): never {
    throw new NotImplementedYetError('E03-S02', '하트비트 REST 표면 — 인증 컨텍스트 배선 대기');
  }

  /** EP-TASK-08 */
  @Post(':task/release')
  release(): never {
    throw new NotImplementedYetError('E03-S02', '해제 REST 표면 — 인증 컨텍스트 배선 대기');
  }

  /** EP-TASK-09 — done 게이트 판정의 단일 지점. REST 배선은 E08-S05 */
  @Patch(':task')
  update(): never {
    throw new NotImplementedYetError('E08-S05', 'Task 전이 REST 표면 — 인증 컨텍스트 배선 대기');
  }
}
