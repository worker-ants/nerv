// REQ-CB-043 — 세션 쿠키로 인증하는 상태 변경 요청의 Origin 대조 (정본: docs/04-mvp/codebase.md §5.2c)
//
// **이 스위트가 지키는 것은 "누가 면제되는가" 다.** 규칙 자체는 한 줄이지만, 면제가
// 틀리면 둘 중 하나가 된다 — 에이전트(PAT)가 통째로 막히거나, 남의 탭이 그대로 통과하거나.

import { describe, expect, it } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { SessionOriginGuard } from './session-origin.guard.js';

const WEB = 'https://app.nerv.example.com';
const EVIL = 'https://evil.example.com';
const guard = new SessionOriginGuard([WEB]);

/** Nest 의 ExecutionContext 중 이 가드가 쓰는 것만 세운다. */
function ctx(req: {
  method?: string;
  url?: string;
  headers?: Record<string, string | undefined>;
}): Parameters<SessionOriginGuard['canActivate']>[0] {
  const request = { method: 'POST', url: '/api/v1/specs', headers: {}, ...req };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as Parameters<SessionOriginGuard['canActivate']>[0];
}

const SESSION = { cookie: 'better-auth.session_token=abc' };
const PAT = { authorization: 'Bearer nerv_token' };

describe('SessionOriginGuard', () => {
  it('쿠키 쓰기 요청은 허용 오리진이어야 통과한다', () => {
    expect(guard.canActivate(ctx({ headers: { ...SESSION, origin: WEB } }))).toBe(true);
  });

  it('**목록 밖 오리진이면 막는다** — 남의 탭이 보내는 요청이 그 모양이다', () => {
    expect(() => guard.canActivate(ctx({ headers: { ...SESSION, origin: EVIL } }))).toThrowError(
      expect.objectContaining({ code: NERV_ERROR.FORBIDDEN }),
    );
  });

  it('**Origin 이 없어도 막는다** — 세션 쿠키는 계약상 브라우저의 것이고, 브라우저는 쓰기에 그 헤더를 싣는다', () => {
    expect(() => guard.canActivate(ctx({ headers: { ...SESSION } }))).toThrowError(
      expect.objectContaining({ code: NERV_ERROR.FORBIDDEN }),
    );
  });

  it('불투명 오리진(`null`)도 막는다 — 샌드박스 iframe 이 그 값을 싣는다', () => {
    expect(() =>
      guard.canActivate(ctx({ headers: { ...SESSION, origin: 'null' } })),
    ).toThrowError();
  });

  it('**PAT 요청은 면제다** — 헤더에 직접 실리는 자격증명이라 CSRF 가 아니다', () => {
    expect(guard.canActivate(ctx({ headers: { ...PAT, origin: EVIL } }))).toBe(true);
    expect(guard.canActivate(ctx({ headers: PAT }))).toBe(true);
  });

  it('읽기(GET·HEAD·OPTIONS)는 지나간다 — 상태를 바꾸지 않고 응답은 CORS 가 막는다', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(guard.canActivate(ctx({ method, headers: { ...SESSION, origin: EVIL } }))).toBe(true);
    }
  });

  it('`/mcp` 는 자기 가드가 본다 — 규칙이 달라서 두 번 판정하지 않는다', () => {
    expect(guard.canActivate(ctx({ url: '/mcp', headers: { ...SESSION, origin: EVIL } }))).toBe(
      true,
    );
  });

  it('거절 문구는 허용 오리진을 싣는다 — 운영자가 어느 값을 고칠지 알아야 한다', () => {
    try {
      guard.canActivate(ctx({ headers: { ...SESSION, origin: EVIL } }));
      expect.unreachable();
    } catch (error) {
      const details = (error as { details?: { expected?: string[]; origin?: string | null } })
        .details;
      expect(details?.expected).toEqual([WEB]);
      expect(details?.origin).toBe(EVIL);
    }
  });
});
