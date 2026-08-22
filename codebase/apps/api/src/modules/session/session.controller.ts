// REST — 세션 보드 · 상세 · activity (docs/04-mvp/api.md §2.5)
// 화면 배선은 E05-S03 이다 — 여기는 경로와 서비스 연결만 세운다.
import { Controller, Get, Param } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { ActivityService } from './activity.service.js';
import { SessionService } from './session.service.js';

@Controller('api/v1/projects/:proj/sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly activities: ActivityService,
  ) {}

  /** EP-SES-01 — S5 세션 보드 */
  @Get()
  board(@Param('proj') _proj: string): never {
    throw new NotImplementedYetError('E05-S03', '세션 보드 조회');
  }

  /** EP-SES-03 */
  @Get(':sid/activity')
  activity(@Param('sid') _sid: string): never {
    return this.activities.timeline();
  }
}
