// 프로젝트 경로 접근 판정 — slug 해소 + 토큰 권한 + 멤버십.
//
// ※ codebase.md §2.2 트리에 없는 파일이다. 같은 판정이 REST 프로젝트 경로 전부에 필요하고
//   (`/api/v1/projects/{proj}/**`), 컨트롤러마다 세 줄씩 복사하면 언젠가 한 곳이 빠진다.
//   가드로 올려 한 번만 쓴다 — SSE 쪽 SseAccessGuard 와 같은 판정기(AuthService)를 쓴다(D-05).
//
// project-scope.interceptor.ts 는 slug 를 요청 컨텍스트에 싣기만 한다(판정 없음). 그것과
// 이 가드의 차이가 "번역"과 "판정"의 경계다.

import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { msg, scopesForRoles, NERV_ERROR } from '@nerv/schema';
import { AuthService } from '../modules/auth/auth.service.js';
import type { MembershipRole, Principal } from '../modules/auth/auth.service.js';
import { NervError } from './nerv-exception.filter.js';
import { ROUTE_PERMISSION } from './route-permission.js';
import type { RoutePermission } from './route-permission.js';

export interface ProjectRequest {
  params?: Record<string, string | undefined>;
  nervPrincipal?: Principal;
  /** 가드가 해소해 컨트롤러에 넘긴다 */
  nervProjectId?: string;
  nervRoles?: readonly MembershipRole[];
}

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

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
    const roles = await this.auth.assertMembership(principal.userId, project.id);
    req.nervRoles = roles;
    req.nervProjectId = project.id;

    // **세션 주체의 권한은 여기서 정해진다.** `assertScope` 는 원래 "세션 사용자는 역할
    // 매트릭스가 판정한다"고 적어 두고 그 매트릭스가 없어, 웹으로 들어오면 `viewer` 도
    // 메타 편집·아카이브·기준선 동결을 통과했다(실측 2026-08-23).
    // PAT 는 이미 발급 시점에 역할과 교집합을 냈으므로 건드리지 않는다.
    if (!principal.isAgent) {
      principal.roles = roles;
      principal.scopes = [...scopesForRoles(roles)];
    }

    this.assertRoutePermission(context, principal, roles);
    return true;
  }

  /**
   * 전표의 권한 열을 여기서 집행한다 — **선언이 없으면 거절한다**(fail-closed).
   *
   * 판정 함수는 처음부터 있었고 부르는 곳이 세 컨트롤러뿐이었다는 것이 이 결함의 전부다.
   * 선언을 강제하면 "부르는 것을 잊었다"가 조용한 허용이 아니라 즉시 실패가 된다 —
   * 새 라우트는 첫 요청에서 드러난다.
   */
  private assertRoutePermission(
    context: ExecutionContext,
    principal: Principal,
    roles: readonly MembershipRole[],
  ): void {
    const declared = this.reflector.getAllAndOverride<RoutePermission | undefined>(
      ROUTE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (declared === undefined) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.route_undeclared'), {
        kind: 'route_undeclared',
        route: `${context.getClass().name}.${context.getHandler().name}`,
      });
    }

    const wantRoles = declared.roles ?? [];
    if (wantRoles.length > 0 && !wantRoles.some((r) => roles.includes(r as MembershipRole))) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.role_missing'), {
        kind: 'role_required',
        required: wantRoles,
        granted: roles,
      });
    }

    const wantScopes = declared.scopes ?? [];
    if (wantScopes.length > 0 && !wantScopes.some((s) => principal.scopes.includes(s))) {
      throw new NervError(
        NERV_ERROR.FORBIDDEN,
        msg('error.auth.scope_missing', { scope: wantScopes.join(' · ') }),
        {
          kind: 'missing_scope',
          required: wantScopes,
          granted: principal.scopes,
          roles: principal.roles,
        },
      );
    }
  }
}
