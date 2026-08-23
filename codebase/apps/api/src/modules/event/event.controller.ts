// REST — 이벤트 피드 · 알림 (docs/04-mvp/api.md §2.7)
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
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
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  /** EP-NTF-01 */
  @Get('me/notifications')
  myNotifications(@Req() req: ProjectRequest, @Query('state') state?: string): Promise<unknown> {
    return this.notifications.list({
      userId: userOf(req),
      state: state === 'read' ? 'read' : state === 'unread' ? 'unread' : null,
    });
  }

  /** 헤더 배지 — 안 읽은 수만 따로 센다(매 렌더에 목록 전량을 읽지 않기 위해) */
  @Get('me/notifications/unread-count')
  async unreadCount(@Req() req: ProjectRequest): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(userOf(req)) };
  }

  /** EP-NTF-02 */
  @Post('me/notifications/:id/read')
  markRead(@Req() req: ProjectRequest, @Param('id') id: string): Promise<{ ok: true }> {
    return this.notifications.markRead({ userId: userOf(req), notificationId: id });
  }
}

function userOf(req: ProjectRequest): string {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal.userId;
}
