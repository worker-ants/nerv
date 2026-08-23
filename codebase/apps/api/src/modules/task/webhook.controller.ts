// ingest — GitHub 웹훅 (E14-S03 · FR-13)
//
// 표면 5종 중 ingest 평면에 속한다(D-05): 바깥에서 들어오는 사실을 받아 도메인에 적재하되,
// **판정하지 않는다**. 훅과 같은 등급이라 실패해도 도메인은 계속 돈다.
//
// 인증은 PAT 가 아니라 **HMAC 서명**이다 — GitHub 은 우리 토큰을 들고 있지 않다.
// 그래서 이 라우트만 @Public() 이고, 대신 서명 검증을 통과하지 못하면 아무것도 하지 않는다.

import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { Public } from '../../common/auth.guard.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { AuthService } from '../auth/auth.service.js';
import { WebhookService } from './webhook.service.js';
import type { WebhookResult } from './webhook.service.js';

@Controller('ingest/webhooks')
export class WebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly auth: AuthService,
  ) {}

  @Post('github/:proj')
  @Public()
  async github(
    @Req() req: { rawBody?: Buffer | string },
    @Param('proj') proj: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<WebhookResult> {
    // 서명은 **원문 바이트**로 계산된다 — 파싱 후 재직렬화한 문자열로 검증하면
    // 키 순서·공백 차이로 조용히 실패하거나(운 좋으면) 통과한다(운 나쁘면).
    const raw =
      req.rawBody === undefined
        ? JSON.stringify(body)
        : typeof req.rawBody === 'string'
          ? req.rawBody
          : req.rawBody.toString('utf8');
    this.webhooks.verifySignature(raw, signature);

    const project = await this.auth.resolveProject(proj);
    if (project === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
        kind: 'not_found',
        project: proj,
      });
    }

    return this.webhooks.handle({
      projectId: project.id,
      event: event ?? 'unknown',
      payload: body,
    });
  }
}
