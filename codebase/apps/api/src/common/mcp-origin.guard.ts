// POST /mcp 의 Origin 검증 — REQ-CB-013 (docs/04-mvp/codebase.md §2.4)
//
// 전단(nginx §5.4 · Ingress §6.3)의 차단 여부와 **무관하게** 앱에서 최종 강제한다.
// Ingress 스니펫 주입이 조직 보안 정책상 비활성인 클러스터가 많아 전단에 의존하지 않는다.
// 규칙: Origin 헤더가 없으면(비브라우저 클라이언트) 통과, 있으면 **우리 오리진 둘**
// (`NERV_API_URL` · `NERV_WEB_URL`) 중 하나와 정확히 같아야 통과. 다르면 403.
//
// **규칙은 그대로이고 대조 대상만 둘이 됐다**(2026-09-13 · REQ-CB-036). 전에는 이름 하나가
// 화면과 API 의 주소를 겸해서 대조 대상도 하나였다 — 둘이 같은 오리진이라 그렇게 보였을
// 뿐이다. 이름을 가른 뒤에도 같은 값을 가리키면 판정은 한 건도 달라지지 않는다.

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';
import { NERV_API_URL, NERV_WEB_URL, apiUrlFromEnv, originOf, webUrlFromEnv } from './origins.js';

@Injectable()
export class McpOriginGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(NERV_API_URL)
    private readonly apiUrl: string = apiUrlFromEnv(),
    @Optional()
    @Inject(NERV_WEB_URL)
    private readonly webUrl: string = webUrlFromEnv(),
  ) {}

  /**
   * 전역 가드로 등록하되 `/mcp` 에만 적용한다 — Origin 검증은 "누가"가 아니라 "어디서"의
   * 문제라 **인증보다 먼저** 돌아야 하고(DNS 리바인딩 방어), 컨트롤러 권한 가드는
   * 전역 AuthGuard 뒤에 실행되어 그 순서를 만들 수 없다. 다른 경로에는 관여하지 않는다.
   */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      url?: string;
    }>();
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path !== '/mcp' && !path.startsWith('/mcp/')) return true;
    return this.check(req.headers['origin']);
  }

  /** 게이트웨이·테스트가 직접 부를 수 있게 헤더 값만 받는 형태로 분리한다. */
  check(originHeader: string | undefined): boolean {
    if (originHeader === undefined || originHeader === '') return true; // 비브라우저 클라이언트

    // 같은 값을 가리키는 두 이름은 한 오리진이다 — 거절 문구가 같은 주소를 두 번 적지 않게 접는다.
    const allowed = [...new Set([originOf(this.apiUrl), originOf(this.webUrl)])].filter(
      (origin): origin is string => origin !== null,
    );
    const actual = originOf(originHeader);
    if (actual !== null && allowed.includes(actual)) return true;

    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.mcp.bad_origin'), {
      kind: 'mcp_origin',
      origin: originHeader,
      expected: allowed,
    });
  }
}
