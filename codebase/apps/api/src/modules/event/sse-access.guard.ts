// SSE 접근 판정 — **가드여야 한다.**
//
// ※ codebase.md §2.2 트리에 이 파일은 없다. 그런데 인가를 컨트롤러 핸들러 안에서 하면
//   계약이 깨진다: `@Sse()` 로 표시된 핸들러가 던지면 Nest 는 이미 스트림 모드로 들어간 뒤라
//   **200 text/event-stream + `event: error`** 를 내보낸다(실측). api.md §3.5 는 타 프로젝트
//   PAT 에 대해 "403 으로 스트림을 열지 않는다"고 못박았으므로 그 응답은 계약 위반이다.
//   가드는 핸들러보다 먼저 돌고 예외가 일반 HTTP 오류로 나가므로 여기서 판정한다.
//
// 판정 자체는 AuthService 가 한다 — REST·WS join·SSE 가 같은 메서드를 쓴다(D-05).

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { AuthService } from '../auth/auth.service.js';
import type { Principal } from '../auth/auth.service.js';

export interface SseRequest {
  params?: Record<string, string | undefined>;
  nervPrincipal?: Principal;
  /** 가드가 해소해 컨트롤러에 넘긴다 — 컨트롤러는 다시 조회하지 않는다 */
  nervSseProjectId?: string;
}

@Injectable()
export class SseAccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SseRequest>();
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 없습니다.', { kind: 'missing' });
    }

    const slug = req.params?.['proj'];
    if (slug === undefined) return true; // /sse/me 는 본인 스트림이라 프로젝트 판정이 없다

    const project = await this.auth.resolveProject(slug);
    if (project === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, '프로젝트를 찾을 수 없습니다.', {
        kind: 'not_found',
        slug,
      });
    }

    // 타 프로젝트 PAT 는 여기서 막힌다 — 빈 스트림이 아니라 403 이다(§3.5)
    this.auth.assertProjectScope(principal, project.id);
    await this.auth.assertMembership(principal.userId, project.id);

    req.nervSseProjectId = project.id;
    return true;
  }
}
