// POST /mcp 의 Origin 검증 — REQ-CB-013 (docs/04-mvp/codebase.md §2.4)
//
// 전단(nginx §5.4 · Ingress §6.3)의 차단 여부와 **무관하게** 앱에서 최종 강제한다.
// Ingress 스니펫 주입이 조직 보안 정책상 비활성인 클러스터가 많아 전단에 의존하지 않는다.
// 규칙: Origin 헤더가 없으면(비브라우저 클라이언트) 통과, 있으면 NERV_PUBLIC_URL 의
// 오리진과 정확히 같아야 통과. 다르면 403.

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';

/** URL 에서 스킴+호스트+포트만 남긴다. 파싱 불가면 null. */
export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** 오리진 기준값 주입 토큰. 미주입이면 env → 기본값 순서로 떨어진다(.env 전표 §5.2). */
export const NERV_PUBLIC_URL = Symbol('NERV_PUBLIC_URL');

@Injectable()
export class McpOriginGuard implements CanActivate {
  constructor(
    @Optional()
    @Inject(NERV_PUBLIC_URL)
    private readonly publicUrl: string = process.env['NERV_PUBLIC_URL'] ?? 'http://localhost:8080',
  ) {}

  /**
   * 전역 가드로 등록하되 `/mcp` 에만 적용한다 — Origin 검증은 "누가"가 아니라 "어디서"의
   * 문제라 **인증보다 먼저** 돌아야 하고(DNS 리바인딩 방어), 컨트롤러 스코프 가드는
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

    const allowed = originOf(this.publicUrl);
    const actual = originOf(originHeader);
    if (allowed !== null && actual === allowed) return true;

    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.mcp.bad_origin'), {
      kind: 'mcp_origin',
      origin: originHeader,
      expected: allowed,
    });
  }
}
