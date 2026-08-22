// REST — 세션 보드 · 상세 · activity (docs/04-mvp/api.md §2.5)
//
// 표면은 번역만 한다(REQ-CB-003). 프로젝트 해소·멤버십 판정은 가드가 끝내고 온다 —
// SSE 와 같은 이유이고 같은 판정기를 쓴다(D-05).

import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { ActivityService } from './activity.service.js';
import { SessionService } from './session.service.js';
import type { SessionCard } from './session.service.js';

@Controller('api/v1/projects/:proj/sessions')
@UseGuards(ProjectAccessGuard)
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly activities: ActivityService,
  ) {}

  /** EP-SES-01 — S5 세션 보드. Phase 0 은 읽기 전용 축소판이다(steer/stop 은 E08-S06). */
  @Get()
  async board(
    @Req() req: ProjectRequest,
    @Query('state') state?: string,
  ): Promise<{ items: SessionCard[]; summary: Record<string, number>; next_cursor: null }> {
    const projectId = req.nervProjectId ?? '';
    const states = state === undefined || state === '' ? [] : state.split(',');
    const [items, summary] = await Promise.all([
      this.sessions.board({ projectId, states }),
      this.sessions.boardSummary(projectId),
    ]);
    // 커서 페이지네이션 봉투(api.md §1.6) — 세션 수는 목표 규모에서 한 페이지에 들어간다
    return { items, summary, next_cursor: null };
  }

  /** EP-SES-03 */
  @Get(':sid/activities')
  timeline(): never {
    return this.activities.timeline();
  }

  /** EP-SES-04 — steer/stop 은 Phase 1 승격 범위다(FR-08) */
  @Get(':sid')
  detail(): never {
    throw new NotImplementedYetError('E08-S06', '세션 상세');
  }
}
