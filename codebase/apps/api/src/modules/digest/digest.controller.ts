// 알림 메일 요약 설정 — EP-NTF-07 · 08 (2026-09-28 · 사람 결정 EM1~EM9 · api.md REQ-API-232)
//
// 표면은 번역만 한다 — 판정(메일을 보낼 수 있는 서버인가 · 실재하는 시간대인가)은 서비스에 있다(D-05).
import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { msg, NERV_ERROR, NotificationDigestInput } from '@nerv/schema';
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
}

function userOf(req: ProjectRequest): string {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal.userId;
}
