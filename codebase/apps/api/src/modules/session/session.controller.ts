// REST — 세션 보드 · 상세 · activity (docs/04-mvp/api.md §2.5)
import { Controller, Get, Param } from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { SessionService } from './session.service.js';

@Controller('api/v1/projects/:proj/sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly activities: ActivityService,
  ) {}

  /** EP-SES-01 */
  @Get()
  board(@Param('proj') _proj: string): never {
    return this.sessions.bootstrap();
  }

  /** EP-SES-03 */
  @Get(':sid/activity')
  activity(@Param('sid') _sid: string): never {
    return this.activities.timeline();
  }
}
