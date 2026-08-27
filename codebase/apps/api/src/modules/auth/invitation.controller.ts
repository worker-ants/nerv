// 초대 표면 — api.md §2.1b
//
// 표면은 번역만 한다(REQ-CB-003). 판정은 InvitationService 한 곳에 있다 — 화면의 비활성
// 버튼과 여기의 403 이 **같은 규칙의 두 표현**이어야 한다.
//
// 미리보기(EP-INV-04)만 `@Public` 이다: 로그인 전에도 "어느 조직이 무슨 역할로 부르는가"는
// 보여야 한다. 모르는 것에 가입부터 하라고 요구할 수는 없다.

import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { Public } from '../../common/auth.guard.js';
import { InvitationService } from './invitation.service.js';
import { principalOf } from './auth.controller.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import type { MembershipRole } from './auth.service.js';

@Controller('api/v1')
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  /** EP-INV-01 — 초대 생성(admin). 토큰 원문은 이 응답에서 한 번만 나간다 */
  @Post('orgs/:org/invitations')
  create(
    @Req() req: ProjectRequest,
    @Param('org') org: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.invitations.create({
      actorUserId: principalOf(req).userId,
      orgSlug: org,
      email: String(body['email'] ?? ''),
      role: String(body['role'] ?? 'viewer') as MembershipRole,
      projectSlug: typeof body['project'] === 'string' ? body['project'] : null,
    });
  }

  /** EP-INV-02 — 조직의 초대 목록(admin) */
  @Get('orgs/:org/invitations')
  list(@Req() req: ProjectRequest, @Param('org') org: string): Promise<unknown> {
    return this.invitations.list({ actorUserId: principalOf(req).userId, orgSlug: org });
  }

  /** EP-INV-03 — 회수(admin) */
  @Delete('invitations/:id')
  revoke(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    return this.invitations.revoke({ actorUserId: principalOf(req).userId, invitationId: id });
  }

  /** EP-INV-04 — 링크 미리보기(**공개**). 이메일은 가려서 준다 */
  @Public()
  @Get('invitations/:token')
  preview(@Param('token') token: string): Promise<unknown> {
    return this.invitations.preview(token);
  }

  /** EP-INV-05 — 수락. 초대한 이메일과 같은 계정만 받는다 */
  @Post('invitations/:token/accept')
  accept(@Req() req: ProjectRequest, @Param('token') token: string): Promise<unknown> {
    return this.invitations.accept({ token, userId: principalOf(req).userId });
  }

  /**
   * EP-INV-05b — 앱 안의 카드에서 수락(인증).
   *
   * 토큰은 해시만 저장하므로 카드가 그것을 알 길이 없다 — id 로 받되 **이메일 대조는
   * 링크 경로와 똑같이** 거친다. 두 입구가 같은 자물쇠를 쓴다.
   */
  @Post('me/invitations/:id/accept')
  acceptMine(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    return this.invitations.accept({ invitationId: id, userId: principalOf(req).userId });
  }

  /** EP-INV-06 — 내게 온 초대. 홈·온보딩·알림 세 화면이 같은 값을 쓴다 */
  @Get('me/invitations')
  mine(@Req() req: ProjectRequest): Promise<unknown> {
    return this.invitations.mine(principalOf(req).userId);
  }
}
