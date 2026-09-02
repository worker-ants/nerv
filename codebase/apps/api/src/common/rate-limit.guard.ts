// 쿼터 가드 — 정본: docs/04-mvp/api.md §1.8 · REQ-API-012
//
// 가드 순서가 규약이다: Origin(어디서) → 인증(누가) → **쿼터(얼마나)**. 쿼터는 주체를
// 알아야 셀 수 있으므로 인증 뒤다. 반대로 두면 인증도 안 된 요청이 남의 창을 채운다.
//
// 세는 표면은 셋이다(§1.8 표):
//   `/api/v1` + `/mcp`  — PAT 은 토큰당, 웹 세션은 사용자당. 같은 풀을 쓰지 않는다.
//   `/ingest/hooks/*`   — 세션당. 토큰 안에서 세션을 가른다.
//
// 세지 않는 것도 규약이다. `/api/auth/*` 는 Nest 밖(인증 스택이 IP 로 센다)이고,
// **WS·SSE 연결 수는 쿼터 대상이 아니다**(§1.8 마지막 줄) — 연결 후 이벤트는 서버 발신이라
// 클라이언트가 늘릴 수 있는 것이 아니다. SSE 의 동시 연결 상한은 다른 규칙이다(§3.5).

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';
import { RateLimitService } from './rate-limit.service.js';
import type { RateSubject } from './rate-limit.service.js';
import type { Principal } from '../modules/auth/auth.service.js';

interface QuotaRequest {
  url?: string;
  originalUrl?: string;
  nervPrincipal?: Principal;
  body?: { session_id?: unknown };
}

/** 쿼터를 세지 않는 경로. 세는 곳을 열거하는 편이 안전하지만, 여기서는 예외가 더 짧다. */
function isExempt(path: string): boolean {
  return path.startsWith('/sse/') || path.startsWith('/ws') || path === '/healthz';
}

export function subjectOf(req: QuotaRequest): RateSubject | null {
  const principal = req.nervPrincipal;
  if (principal === undefined) return null;
  const path = pathOf(req);
  if (isExempt(path)) return null;

  if (path.startsWith('/ingest/hooks')) {
    // **세션당**이다(§1.8). 세션 식별자는 훅 본문에서 오는 비신뢰 값이라 토큰 안에서만
    // 가른다 — 토큰을 접두로 두지 않으면 남의 세션 id 를 적어 남의 창을 소진시킬 수 있다.
    const session = typeof req.body?.session_id === 'string' ? req.body.session_id : 'unknown';
    return { kind: 'ingest', id: `${principal.tokenId ?? principal.userId}/${session}` };
  }

  // PAT 은 토큰당, 세션 쿠키는 사용자당. 토큰이 주체이므로 표면(`/api/v1`·`/mcp`)을
  // 나누지 않는다 — 한 풀이다.
  return principal.tokenId === null
    ? { kind: 'web', id: principal.userId }
    : { kind: 'pat', id: principal.tokenId };
}

function pathOf(req: QuotaRequest): string {
  const raw = req.originalUrl ?? req.url ?? '';
  const query = raw.indexOf('?');
  return query === -1 ? raw : raw.slice(0, query);
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<QuotaRequest>();
    const subject = subjectOf(req);
    if (subject === null) return true;

    const decision = await this.limiter.hit(subject);
    if (decision.allowed) return true;

    // 봉투의 `retry_after_s` 와 `Retry-After` 헤더는 필터가 같은 값에서 만든다(§1.4).
    throw new NervError(
      NERV_ERROR.RATE_LIMIT,
      msg('error.quota.exceeded', { limit: String(decision.limit) }),
      { kind: 'rate_limited', subject: subject.kind, limit: decision.limit },
      decision.retryAfterSeconds,
    );
  }
}
