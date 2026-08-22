// REST — Task · 클레임 (docs/04-mvp/api.md §2.4)
import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TaskService } from './task.service.js';

@Controller('api/v1/projects/:proj/tasks')
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  /** EP-TASK-02 */
  @Get('next')
  next(@Param('proj') _proj: string): never {
    return this.tasks.next();
  }

  /** EP-TASK-06 */
  @Post(':task/claim')
  claim(): never {
    return this.tasks.claim();
  }

  /** EP-TASK-07 */
  @Post(':task/heartbeat')
  heartbeat(): never {
    return this.tasks.heartbeat();
  }

  /** EP-TASK-08 */
  @Post(':task/release')
  release(): never {
    return this.tasks.release();
  }

  /** EP-TASK-09 */
  @Patch(':task')
  update(): never {
    return this.tasks.transition();
  }
}
