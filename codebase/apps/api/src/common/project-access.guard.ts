// 프로젝트 경로 접근 판정 — slug 해소 + 토큰 스코프 + 멤버십.
//
// ※ codebase.md §2.2 트리에 없는 파일이다. 같은 판정이 REST 프로젝트 경로 전부에 필요하고
//   (`/api/v1/projects/{proj}/**`), 컨트롤러마다 세 줄씩 복사하면 언젠가 한 곳이 빠진다.
//   가드로 올려 한 번만 쓴다 — SSE 쪽 SseAccessGuard 와 같은 판정기(AuthService)를 쓴다(D-05).
//
// project-scope.interceptor.ts 는 slug 를 요청 컨텍스트에 싣기만 한다(판정 없음). 그것과
// 이 가드의 차이가 "번역"과 "판정"의 경계다.

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { AuthService } from '../modules/auth/auth.service.js';
import type { MembershipRole, Principal } from '../modules/auth/auth.service.js';
import { NervError } from './nerv-exception.filter.js';

export interface ProjectRequest {
  params?: Record<string, string | undefined>;
  nervPrincipal?: Principal;
  /** 가드가 해소해 컨트롤러에 넘긴다 */
  nervProjectId?: string;
  nervRole?: MembershipRole;
}

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }

    const slug = req.params?.['proj'];
    if (slug === undefined || slug === '') return true;

    const project = await this.auth.resolveProject(slug);
    if (project === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
        kind: 'not_found',
        slug,
      });
    }

    this.auth.assertProjectScope(principal, project.id);
    req.nervRole = await this.auth.assertMembership(principal.userId, project.id);
    req.nervProjectId = project.id;
    return true;
  }
}
