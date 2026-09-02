// REST — 세션 보드 · 상세 · activity (docs/04-mvp/api.md §2.5)
//
// 표면은 번역만 한다(REQ-CB-003). 프로젝트 해소·멤버십 판정은 가드가 끝내고 온다 —
// SSE 와 같은 이유이고 같은 판정기를 쓴다(D-05).

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { SessionService } from './session.service.js';
import type { SessionCard } from './session.service.js';

@Controller('api/v1/projects/:proj/sessions')
@UseGuards(ProjectAccessGuard)
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  /** EP-SES-01 — S5 세션 보드. Phase 0 은 읽기 전용 축소판이다(steer/stop 은 E08-S06). */
  @RequireScope('spec:read')
  @Get()
  async board(
    @Req() req: ProjectRequest,
    @Query('state') state?: string,
  ): Promise<{ items: SessionCard[]; summary: Record<string, number>; next_cursor: null }> {
    const projectId = req.nervProjectId ?? '';
    // 표면은 쪼개고 다듬기만 한다 — 어휘 판정은 서비스가 한다(D-05).
    const states =
      state === undefined || state === ''
        ? []
        : state
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '');
    const [items, summary] = await Promise.all([
      this.sessions.board({ projectId, states }),
      this.sessions.boardSummary(projectId),
    ]);
    // 커서 페이지네이션 봉투(api.md §1.6) — 세션 수는 목표 규모에서 한 페이지에 들어간다
    return { items, summary, next_cursor: null };
  }

  /** EP-SES-03 — seq 순 타임라인 */
  @RequireScope('spec:read')
  @Get(':sid/activities')
  timeline(
    @Req() req: ProjectRequest,
    @Param('sid') sid: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    return this.sessions.timeline({
      projectId: req.nervProjectId ?? '',
      sessionId: sid,
      // 원문 열람 판정의 축 — 에이전트 토큰이면 그 세션 사용자다(REQ-API-066)
      userId: req.nervPrincipal?.userId ?? null,
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  /**
   * EP-SES-05 — 작업 궤적. **도구 로그가 아니라 한 일이다**(REQ-API-068).
   *
   * 새 저장 없이 이벤트를 세션 축으로 읽는다 — 그 사실들은 처음부터 거기 있었다.
   */
  @RequireScope('spec:read')
  @Get(':sid/trajectory')
  trajectory(
    @Req() req: ProjectRequest,
    @Param('sid') sid: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    return this.sessions.trajectory({
      projectId: req.nervProjectId ?? '',
      sessionId: sid,
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  /** EP-SES-02 */
  @RequireScope('spec:read')
  @Get(':sid')
  detail(@Req() req: ProjectRequest, @Param('sid') sid: string): Promise<unknown> {
    return this.sessions.detail({ projectId: req.nervProjectId ?? '', sessionId: sid });
  }

  /**
   * EP-SES-04 — steer/stop. **사람 전용**이다: 에이전트가 다른 에이전트를 멈추게 하는 경로를
   * 열면 "사람이 개입하는 유일한 지점"이라는 FR-08 의 전제가 사라진다.
   */
  @RequireScope('spec:read')
  @Post(':sid/steer')
  steer(
    @Req() req: ProjectRequest,
    @Param('sid') sid: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    if (principal.isAgent) {
      throw new NervError(NERV_ERROR.HUMAN_ONLY, msg('error.human_only.steer'), {
        kind: 'human_only',
        web_url: `/p/${String(req.params?.['proj'] ?? '')}/sessions`,
      });
    }
    const kind = body['kind'] === 'stop' ? 'stop' : 'steer';
    return this.sessions.steer({
      projectId: req.nervProjectId ?? '',
      sessionId: sid,
      kind,
      message: String(body['message'] ?? ''),
      userId: principal.userId,
    });
  }
}
