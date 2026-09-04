// 플러그인 배포 표면 — EP-PLG-01·02 (api.md §2.11 · REQ-API-086)
//
// **무인증이다.** 선택이 아니라 제약이다: 인증 헤더를 붙이는 `headersHelper` 는 관리형
// settings 에 등록한 마켓플레이스에만 걸리고, 사람이 `/plugin marketplace add <url>` 로
// 직접 치는 경로에는 붙지 않는다(플러그인 마켓플레이스 문서). 손으로 설치하는 길을
// 남기려면 공개여야 한다.
//
// 공개해도 되는 이유는 **패키지에 비밀이 없기** 때문이다 — 서버 주소는 들어가지만 토큰은
// `.nerv/env` 에 있고 그것은 패키지가 아니다(4.6 §3.3). 드러나는 것은 서버 주소와 도구
// 이름이며, 둘 다 이미 인증 없이 `/mcp` 가 말하는 것들이다.

import { Controller, Get, Param, Res } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { Public } from '../../common/auth.guard.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { PluginService } from './plugin.service.js';
import type { MarketplaceCatalog } from './plugin.service.js';

/**
 * 어댑터 타입을 직접 들이지 않는다 — `spec.controller.ts` 의 `RawReply` 와 같은 규율이다.
 * 여기서 fastify 를 import 하면 어댑터를 바꿀 때 이 파일이 걸린다.
 */
interface RawReply {
  header(name: string, value: string): unknown;
}

@Controller('plugin')
export class PluginController {
  constructor(private readonly plugins: PluginService) {}

  /** EP-PLG-01 — 마켓플레이스 카탈로그. `/plugin marketplace add <이 주소>` 가 받는 것. */
  @Get('marketplace.json')
  @Public()
  async marketplace(): Promise<MarketplaceCatalog> {
    const catalog = await this.plugins.catalog();
    if (catalog === null) throw missing();
    return catalog;
  }

  /**
   * EP-PLG-02 — 아카이브.
   *
   * 이름에 버전이 들어 있지만 **서빙되는 것은 언제나 이 이미지가 담은 하나**다. 다른 버전을
   * 요청하면 404 다 — 없는 버전에 옛 파일을 주는 것보다 없다고 말하는 편이 낫다.
   */
  @Get(':filename')
  @Public()
  async archive(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) reply: RawReply,
  ): Promise<Buffer> {
    const archive = await this.plugins.archive();
    if (archive === null) throw missing();
    if (filename !== archive.filename) throw missing();

    // **content-type 은 검사를 통과한 뒤에 건다.** 라우트 데코레이터(`@Header`)로 걸면
    // 던져진 에러에도 `application/zip` 이 붙어 Fastify 가 봉투를 직렬화하지 못한다 —
    // 그러면 404 여야 할 자리가 500 "invalid payload type" 이 된다(실측 2026-09-04).
    void reply.header('content-type', 'application/zip');
    void reply.header('content-disposition', `attachment; filename="${archive.filename}"`);
    // 파일 이름에 버전이 있으니 내용은 바뀌지 않는다 — 오래 캐시해도 안전하다.
    void reply.header('cache-control', 'public, max-age=86400, immutable');
    return archive.bytes;
  }
}

/**
 * 아카이브가 이미지에 없으면 표면 전체가 없는 것과 같다 — **빈 카탈로그를 주지 않는다.**
 * 플러그인 0개짜리 카탈로그는 "이 서버는 플러그인을 안 준다" 로 읽히고, 그것은 거짓이다.
 *
 * 어휘에 `NOT_FOUND` 가 없다 — `error.project.not_found` 와 같은 규약(`PRECONDITION` +
 * `kind:'not_found'`)을 쓴다. 새 에러 코드를 만드는 것은 별도 결정이다(api.md §1.4).
 */
function missing(): NervError {
  return new NervError(NERV_ERROR.PRECONDITION, msg('error.plugin.no_archive'), {
    kind: 'not_found',
  });
}
