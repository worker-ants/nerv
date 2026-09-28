// 알림 메일 요약 설정 — EP-NTF-07 · 08 (2026-09-28 · 사람 결정 EM1~EM9 · api.md REQ-API-232)
//
// 표면은 번역만 한다 — 판정(메일을 보낼 수 있는 서버인가 · 실재하는 시간대인가)은 서비스에 있다(D-05).
import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { msg, NERV_ERROR, NotificationDigestInput } from '@nerv/schema';
import { Public } from '../../common/auth.guard.js';
import { parseBody } from '../../common/parse-body.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { DigestService } from './digest.service.js';
import type { DigestSetting } from './digest.service.js';

@Controller('api/v1')
export class DigestController {
  constructor(private readonly digests: DigestService) {}

  /** EP-NTF-07 — 내 메일 요약 설정. 행이 없으면 꺼짐이다 */
  @Get('me/notifications/digest')
  get(@Req() req: ProjectRequest): Promise<DigestSetting> {
    return this.digests.get(userOf(req));
  }

  /** EP-NTF-08 — 켜고 끈다. 본인의 것만이다 */
  @Put('me/notifications/digest')
  set(@Req() req: ProjectRequest, @Body() body: unknown): Promise<DigestSetting> {
    const input = parseBody(NotificationDigestInput, body);
    return this.digests.set({
      userId: userOf(req),
      enabled: input.enabled,
      hour: input.hour,
      timezone: input.timezone,
      locale: input.locale,
    });
  }

  /**
   * EP-MAIL-01 — 메일의 끄는 링크(**공개** · 2026-09-28 · 사람 결정 EM8 · REQ-API-234). 메일 앱의 [구독 취소]
   * 단추는 쿠키도 인증도 없이 `List-Unsubscribe=One-Click` 을 POST 한다(RFC 8058) — 그래서 자격증명을 보지
   * 않는다. 토큰이 곧 권한이고, 할 수 있는 일은 그 사람의 메일 요약을 끄는 것 하나다.
   */
  @Public()
  @Post('mail/unsubscribe/:token')
  unsubscribe(@Param('token') token: string): Promise<{ ok: true; unsubscribed: true }> {
    return this.digests.unsubscribe(token);
  }
}

function userOf(req: ProjectRequest): string {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal.userId;
}
