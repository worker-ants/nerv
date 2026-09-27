// REST — 이벤트 피드 · 알림 (docs/04-mvp/api.md §2.7)
import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { intParam } from '../../common/query-vocab.js';
import { msg, NERV_ERROR, NotificationLevelInput, NotificationReadAllInput } from '@nerv/schema';
import { parseBody } from '../../common/parse-body.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { EventService } from './event.service.js';
import { NotificationService } from './notification.service.js';

@Controller('api/v1')
export class EventController {
  constructor(
    private readonly events: EventService,
    private readonly notifications: NotificationService,
  ) {}

  /** EP-EVT-01 */
  @RequireScope('spec:read')
  @Get('projects/:proj/events')
  @UseGuards(ProjectAccessGuard)
  feed(
    @Req() req: ProjectRequest,
    @Query('type') type?: string,
    @Query('subject_id') subjectId?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    return this.events.feed({
      projectId: req.nervProjectId ?? '',
      types: type === undefined || type === '' ? null : type.split(','),
      subjectId: subjectId ?? null,
      before: before ?? null,
      // 숫자가 아니면 400 이다 — NaN 을 SQL 에 실으면 22P02 로 죽는다(라이브 실측 500)
      ...((): { limit?: number } => {
        const parsed = intParam(limit, 'limit');
        return parsed === null ? {} : { limit: parsed };
      })(),
    });
  }

  /** EP-NTF-01 */
  @Get('me/notifications')
  myNotifications(
    @Req() req: ProjectRequest,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('importance') importance?: string,
    // 범위 — 프로젝트 하나(`org` 는 slug 의 한정자) 또는 조직 하나(2026-09-27 · REQ-API-214)
    @Query('project') project?: string,
    @Query('org') org?: string,
  ): Promise<unknown> {
    return this.notifications.list({
      userId: userOf(req),
      state: state ?? null,
      before: before ?? null,
      // 등급 축 — 결정이 필요한 것만 보는 길이다(REQ-API-149)
      importance: importance ?? null,
      project: project ?? null,
      org: org ?? null,
      // 커서가 없으면 목록은 50 에서 끝나는 벽이다(REQ-API-083)
      ...((): { limit?: number } => {
        const parsed = intParam(limit, 'limit');
        return parsed === null ? {} : { limit: parsed };
      })(),
    });
  }

  /**
   * 헤더 배지 — 안 읽은 수만 따로 센다(매 렌더에 목록 전량을 읽지 않기 위해).
   * **둘을 준다**(2026-09-07 · REQ-API-149): 전체와 즉시 알림. 배지는 뒤엣것을 쓴다.
   */
  @Get('me/notifications/unread-count')
  async unreadCount(@Req() req: ProjectRequest): Promise<{ count: number; immediate: number }> {
    return this.notifications.unreadCount(userOf(req));
  }

  /**
   * EP-NTF-05 — 범위별 안 읽은 수(2026-09-27 · REQ-API-215). 알림 화면의 범위 칸이 쓴다 —
   * 합계는 위 배지 수와 같다.
   */
  @Get('me/notifications/scopes')
  scopes(@Req() req: ProjectRequest): Promise<unknown> {
    return this.notifications.scopes(userOf(req));
  }

  /**
   * EP-NTF-06 — 프로젝트의 알림 수준을 고른다(2026-09-27 · 사람 결정 N3 · REQ-API-220). 본인의 것만이다
   */
  @Put('me/notifications/level')
  setLevel(@Req() req: ProjectRequest, @Body() body: unknown): Promise<unknown> {
    const input = parseBody(NotificationLevelInput, body);
    return this.notifications.setLevel({
      userId: userOf(req),
      project: input.project,
      org: input.org ?? null,
      level: input.level,
    });
  }

  /** EP-NTF-02 */
  @Post('me/notifications/:id/read')
  markRead(@Req() req: ProjectRequest, @Param('id') id: string): Promise<{ ok: true }> {
    return this.notifications.markRead({ userId: userOf(req), notificationId: id });
  }

  /**
   * EP-NTF-03 — 일괄 읽음. 읽은 건수를 돌려준다. 본문이 범위 · 등급 · 기준 시각을 받는다 —
   * 비우면 예전과 같다(2026-09-27 · 사람 결정 N4 · REQ-API-216)
   */
  @Post('me/notifications/read-all')
  markAllRead(
    @Req() req: ProjectRequest,
    @Body() body: unknown,
  ): Promise<{ ok: true; marked: number }> {
    const input = parseBody(NotificationReadAllInput, body);
    return this.notifications.markAllRead({
      userId: userOf(req),
      project: input.project ?? null,
      org: input.org ?? null,
      importance: input.importance ?? null,
      until: input.until ?? null,
    });
  }
}

function userOf(req: ProjectRequest): string {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal.userId;
}
