// REST — 프로젝트의 Slack 채널 연결 (S8 「연동」 탭 · api.md §2.1 EP-PRJ-07 ~ 10 · 2026-10-17 · 사람 결정 D1 · D2)
//
// 표면은 번역만 한다(REQ-CB-003). admin · 사람 전용 판정은 SlackService 에 있다.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { msg, NERV_ERROR, SlackConnectInput } from '@nerv/schema';
import type { Actor } from '../../common/human-only.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { parseBody } from '../../common/parse-body.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { MemberOnly, RequireRole } from '../../common/route-permission.js';
import { SlackService } from './slack.service.js';

@Controller('api/v1/projects/:proj/integrations')
@UseGuards(ProjectAccessGuard)
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  /** EP-PRJ-07 — 연동 현황(멤버) */
  @MemberOnly()
  @Get()
  async integrations(@Req() req: ProjectRequest): Promise<unknown> {
    return { slack: await this.slack.status(req.nervProjectId ?? '') };
  }

  /** EP-PRJ-08 — Slack 웹훅 연결 · 바꾸기(admin · 사람) */
  @RequireRole('admin')
  @Put('slack')
  connect(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const input = parseBody(SlackConnectInput, body);
    return this.slack.connect({
      actor: actorOf(req),
      roles: req.nervRoles ?? [],
      projectId: req.nervProjectId ?? '',
      webhookUrl: input.webhook_url,
    });
  }

  /** EP-PRJ-09 — 끊기(admin · 사람) */
  @RequireRole('admin')
  @Delete('slack')
  disconnect(@Req() req: ProjectRequest): Promise<unknown> {
    return this.slack.disconnect({
      actor: actorOf(req),
      roles: req.nervRoles ?? [],
      projectId: req.nervProjectId ?? '',
    });
  }

  /** EP-PRJ-10 — 시험 게시(admin · 사람). 큐를 거치지 않는다 */
  @RequireRole('admin')
  @Post('slack/test')
  @HttpCode(HttpStatus.OK)
  test(@Req() req: ProjectRequest): Promise<unknown> {
    return this.slack.test({
      actor: actorOf(req),
      roles: req.nervRoles ?? [],
      projectId: req.nervProjectId ?? '',
    });
  }
}

function actorOf(req: ProjectRequest): Actor {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return { userId: principal.userId, isAgent: principal.isAgent };
}
