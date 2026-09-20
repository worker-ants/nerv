// 세션 쿠키로 인증하는 **상태 변경** 요청의 Origin 검증 — REQ-CB-043 (docs/04-mvp/codebase.md §5.2c)
//
// **이 가드가 막는 것은 남의 탭이다.** 쿠키는 브라우저가 알아서 싣는 자격증명이라
// (ambient authority), 다른 사이트의 페이지가 우리 API 에 POST 를 보내면 그 요청에는
// 사용자의 세션이 실린다. CORS 는 **응답을 읽는 것**을 막을 뿐 요청이 가는 것은 막지
// 않고, `SameSite=Lax` 는 **사이트**를 보므로 같은 등록 도메인 아래의 다른 호스트는
// 그대로 통과한다 — 쿠키 도메인을 넓힌 배치(`NERV_COOKIE_DOMAIN`)가 정확히 그 모양이다.
// 그 자리에서 방어선이 "신뢰하지 않는 호스트를 그 아래 두지 않는다" 는 운영 약속 하나뿐이었고,
// 2026-09-20 사람 확정으로 **서버가 대조한다**.
//
// 규칙은 셋이다.
//   ① 쿠키로 인증하는 요청만 본다 — PAT 는 헤더에 직접 실리는 자격증명이라 CSRF 가 아니다
//   ② `GET`·`HEAD`·`OPTIONS` 는 지나간다 — 상태를 바꾸지 않고, 읽기의 방어선은 CORS 다
//   ③ 나머지는 `Origin` 이 **있어야 하고** 허용 목록(§5.2c)에 있어야 한다. 없으면 거절이다
//
// **③ 의 "없으면 거절" 이 `/mcp` 가드와 다른 점이다.** `/mcp` 는 비브라우저 클라이언트가
// 정상 소비자라 헤더 없는 요청을 통과시킨다. 여기는 반대다 — 세션 쿠키는 계약상
// **브라우저의 것**이고(api.md §1.3 인증 2경로), 브라우저는 상태 변경 요청에 `Origin` 을
// 언제나 싣는다. 헤더 없이 쿠키로 쓰기를 시도하는 것은 계약 밖의 호출이므로 PAT 를 쓴다.
// better-auth 가 `/api/auth/*` 에서 쓰는 규칙과도 같은 모양이다(쿠키가 있으면 대조한다).

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { extractCredential } from './auth.guard.js';
import { NervError } from './nerv-exception.filter.js';
import { allowedOriginsFromEnv, apiUrlFromEnv, originOf } from './origins.js';

/** 상태를 바꾸지 않는 메서드 — 읽기의 방어선은 CORS 다(브라우저가 응답을 읽지 못한다). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SessionOriginGuard implements CanActivate {
  /**
   * 허용 목록은 **기동 때 한 번** 읽는다 — CORS 와 같은 출처이고 같은 시점이다(REQ-CB-041).
   * 자기 오리진을 함께 넣는 이유는 화면과 API 가 같은 호스트인 배치(지금의 compose·k8s)에서
   * 브라우저가 싣는 `Origin` 이 그 주소이기 때문이다.
   */
  constructor(
    private readonly allowed: string[] = [
      ...new Set([originOf(apiUrlFromEnv()), ...allowedOriginsFromEnv()]),
    ].filter((origin): origin is string => origin !== null && origin !== 'null'),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      method?: string;
      url?: string;
    }>();

    // `/mcp` 는 자기 가드가 본다(REQ-CB-013) — 규칙이 다르므로 두 번 판정하지 않는다.
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path === '/mcp' || path.startsWith('/mcp/')) return true;

    const method = (req.method ?? 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    // 자격증명의 **형태**만 본다 — 검증은 AuthGuard 의 몫이고, 이 판정은 그보다 먼저다
    // ("어디서" 가 "누가" 보다 먼저다 · REQ-CB-013 과 같은 순서).
    if (extractCredential(req.headers)?.kind !== 'session') return true;

    return this.check(req.headers['origin']);
  }

  /** 테스트가 헤더 값만으로 부를 수 있게 분리한다 — 가드의 규칙은 한 줄짜리 판정이다. */
  check(originHeader: string | undefined): boolean {
    const actual = originOf(originHeader);
    if (actual !== null && actual !== 'null' && this.allowed.includes(actual)) return true;

    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.bad_origin'), {
      kind: 'session_origin',
      origin: originHeader ?? null,
      expected: this.allowed,
    });
  }
}
