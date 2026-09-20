// POST /mcp 의 Origin 검증 — REQ-CB-013 (docs/04-mvp/codebase.md §2.4)
//
// 전단(nginx §5.4 · Ingress §6.3)의 차단 여부와 **무관하게** 앱에서 최종 강제한다.
// Ingress 스니펫 주입이 조직 보안 정책상 비활성인 클러스터가 많아 전단에 의존하지 않는다.
// 규칙: Origin 헤더가 없으면(비브라우저 클라이언트) 통과, 있으면 **우리 오리진**
// (`NERV_API_URL` + 허용 오리진 목록) 중 하나와 정확히 같아야 통과. 다르면 403.
//
// **규칙은 그대로이고 대조 대상만 늘었다.** 2026-09-13 에 둘이 됐고(`NERV_API_URL`·
// `NERV_WEB_URL` — REQ-CB-036), 2026-09-20 에 `NERV_TRUSTED_ORIGINS` 가 함께 든다
// (REQ-CB-041): 허용 오리진을 세 곳(CORS · better-auth · 이 가드)이 **한 출처**에서 읽지
// 않으면, 운영자가 화면을 띄우라고 선언한 오리진이 표면마다 다르게 취급된다.
// 값이 같은 배치에서는 판정이 한 건도 달라지지 않는다.
//
// **앞문은 여전히 오리진 하나만 안다**(nginx `map` · §5.4). envsubst 가 변수를 한 줄로만
// 치환하고 같은 값이 두 줄이면 nginx 가 기동을 거부하기 때문이다 — 그래서 앞문은 화면
// 주소 하나를 1차로 보고, **최종 강제는 여기다**(REQ-CB-013 이 앞문에 의존하지 않는 이유).

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';
import {
  NERV_API_URL,
  NERV_TRUSTED_ORIGINS,
  NERV_WEB_URL,
  apiUrlFromEnv,
  originOf,
  trustedOriginsFromEnv,
  webUrlFromEnv,
} from './origins.js';

@Injectable()
export class McpOriginGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(NERV_API_URL)
    private readonly apiUrl: string = apiUrlFromEnv(),
    @Optional()
    @Inject(NERV_WEB_URL)
    private readonly webUrl: string = webUrlFromEnv(),
    /**
     * 화면을 띄우는 **추가** 오리진 — `NERV_TRUSTED_ORIGINS`(REQ-CB-041).
     *
     * 값이 배열이라 **토큰이 있어야 한다**: 타입만으로는 Nest 가 `Array` 를 찾다가
     * 실패하고, 그 실패는 이 가드를 쓰는 모듈 전체의 기동 실패다(실측 2026-09-20).
     */
    @Optional()
    @Inject(NERV_TRUSTED_ORIGINS)
    private readonly extraOrigins: string[] = trustedOriginsFromEnv(),
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

    // 같은 값을 가리키는 이름들은 한 오리진이다 — 거절 문구가 같은 주소를 두 번 적지 않게 접는다.
    const allowed = [
      ...new Set([originOf(this.apiUrl), originOf(this.webUrl), ...this.extraOrigins]),
    ].filter((origin): origin is string => origin !== null && origin !== 'null');
    const actual = originOf(originHeader);
    if (actual !== null && allowed.includes(actual)) return true;

    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.mcp.bad_origin'), {
      kind: 'mcp_origin',
      origin: originHeader,
      expected: allowed,
    });
  }
}
