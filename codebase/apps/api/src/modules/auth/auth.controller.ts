// REST — 조직 · 프로젝트 · 멤버 · 토큰 (S8) — docs/04-mvp/api.md §2.1
//
// 표면은 번역만 한다(REQ-CB-003). 역할 판정은 AuthService 안에 있다 — 화면의 비활성 버튼과
// 여기의 403 이 **같은 규칙의 두 표현**이어야 하고, 규칙이 두 벌이면 그중 하나는 반드시 틀린다.

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  MemberAddInput,
  MemberUpdateInput,
  msg,
  NERV_ERROR,
  OrgCreateInput,
  OrgUpdateInput,
  ProjectCreateInput,
  ProjectUpdateInput,
  TokenCreateInput,
} from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { parseBody } from '../../common/parse-body.js';
import type { Actor } from '../../common/human-only.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { MemberOnly, RequireRole } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { AuthService } from './auth.service.js';
import type { MembershipRole, Principal } from './auth.service.js';

@Controller('api/v1')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** EP-AUTH-01 */
  @Get('me')
  me(@Req() req: ProjectRequest): Promise<unknown> {
    return this.auth.me(principalOf(req).userId);
  }

  /** EP-ORG-01 */
  @Get('orgs')
  orgs(@Req() req: ProjectRequest): Promise<unknown> {
    return this.auth.orgs(principalOf(req).userId);
  }

  /** EP-ORG-02 */
  @Get('orgs/:org')
  org(@Req() req: ProjectRequest, @Param('org') org: string): Promise<unknown> {
    return this.auth.org({ userId: principalOf(req).userId, orgSlug: org });
  }

  /** EP-ORG-03 — 조직 생성. 만든 사람이 그 조직의 admin 이 된다 */
  @Post('orgs')
  createOrg(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const input = parseBody(OrgCreateInput, body);
    return this.auth.createOrg({
      userId: principalOf(req).userId,
      slug: input.slug,
      name: input.name,
    });
  }

  /** EP-ORG-04 — 이름 변경(admin). slug 는 링크의 축이라 바꾸지 않는다 */
  @Patch('orgs/:org')
  updateOrg(
    @Req() req: ProjectRequest,
    @Param('org') org: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const input = parseBody(OrgUpdateInput, body);
    return this.auth.updateOrg({
      userId: principalOf(req).userId,
      orgSlug: org,
      name: input.name,
    });
  }

  /** EP-ORG-05 — 삭제(admin). **비어 있을 때만** */
  @Delete('orgs/:org')
  deleteOrg(@Req() req: ProjectRequest, @Param('org') org: string): Promise<unknown> {
    return this.auth.deleteOrg({ userId: principalOf(req).userId, orgSlug: org });
  }

  /** EP-PRJ-02 — admin. 만든 사람이 자동으로 admin 멤버가 된다 */
  @Post('orgs/:org/projects')
  createProject(
    @Req() req: ProjectRequest,
    @Param('org') org: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const input = parseBody(ProjectCreateInput, body);
    return this.auth.createProject({
      userId: principalOf(req).userId,
      orgSlug: org,
      slug: input.slug,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
    });
  }

  /** EP-MBR-02 — 기존 사용자 배정(메일 발송은 Phase 2) */
  @Post('orgs/:org/members')
  addMember(
    @Req() req: ProjectRequest,
    @Param('org') org: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const input = parseBody(MemberAddInput, body);
    return this.auth.addMember({
      actorUserId: principalOf(req).userId,
      orgSlug: org,
      email: input.email,
      role: input.role,
      projectSlug: input.project ?? null,
    });
  }

  /** EP-TOK-04 — admin 의 조직 전체 토큰 표 */
  @Get('orgs/:org/tokens')
  orgTokens(@Req() req: ProjectRequest, @Param('org') org: string): Promise<unknown> {
    return this.auth.orgTokensBySlug({ actorUserId: principalOf(req).userId, orgSlug: org });
  }

  /** EP-MBR-03 — 역할 변경. 경로에 프로젝트가 없어 멤버십에서 조직을 되짚는다 */
  @Patch('memberships/:id')
  async updateMembership(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = principalOf(req);
    await this.auth.assertAdminOfMembership(id, principal.userId);
    const input = parseBody(MemberUpdateInput, body);
    return this.auth.updateMembership({
      membershipId: id,
      role: input.role,
      // 앞의 assertAdminOfMembership 이 이미 admin 임을 확인했다
      actorRoles: ['admin'],
      // 권한 상승은 누가 했는지가 감사의 질문이다(REQ-API-151)
      actorUserId: principal.userId,
    });
  }

  /** EP-MBR-04 */
  @Delete('memberships/:id')
  async removeMembership(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const principal = principalOf(req);
    await this.auth.assertAdminOfMembership(id, principal.userId);
    return this.auth.removeMembership({
      membershipId: id,
      actorRoles: ['admin'],
      actorUserId: principal.userId,
    });
  }

  /** EP-PRJ-01 */
  @Get('orgs/:org/projects')
  projects(
    @Req() req: ProjectRequest,
    @Param('org') org: string,
    @Query('include_archived') includeArchived?: string,
  ): Promise<unknown> {
    return this.auth.projects({
      userId: principalOf(req).userId,
      orgSlug: org,
      includeArchived: includeArchived === 'true',
    });
  }

  /** EP-MBR-01 */
  @Get('orgs/:org/members')
  members(@Req() req: ProjectRequest, @Param('org') org: string): Promise<unknown> {
    return this.auth.members(org, principalOf(req).userId);
  }

  /** EP-TOK-01 — 원문 없음 */
  @Get('me/tokens')
  tokens(@Req() req: ProjectRequest): Promise<unknown> {
    return this.auth.tokens(principalOf(req).userId);
  }

  /** EP-TOK-02 — **원문은 이 응답에서 한 번만 나간다** */
  @Post('me/tokens')
  async issueToken(
    @Req() req: ProjectRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = principalOf(req);
    // PAT 가 PAT 를 발급하는 경로는 막는다 — 권한 상속의 사슬이 사람에서 시작해야 한다(D-08).
    if (principal.isAgent) {
      throw new NervError(NERV_ERROR.HUMAN_ONLY, msg('error.human_only.token_issue'), {
        kind: 'human_only',
        web_url: '/settings/tokens',
      });
    }
    const input = parseBody(TokenCreateInput, body);
    const project = await this.auth.resolveProject(input.project, {
      orgSlug: input.org ?? null,
      userId: principal.userId,
    });
    if (project === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
        kind: 'not_found',
        project: input.project,
      });
    }
    await this.auth.assertMembership(principal.userId, project.id);
    return this.auth.issueToken({
      projectId: project.id,
      userId: principal.userId,
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expires_at == null ? null : new Date(input.expires_at),
    });
  }

  /** EP-TOK-03 — 즉시 폐기 */
  @Delete('me/tokens/:id')
  async revokeToken(@Req() req: ProjectRequest, @Param('id') id: string): Promise<{ ok: true }> {
    await this.auth.revokeToken(id, principalOf(req).userId);
    return { ok: true };
  }
}

/** 프로젝트 소속이 필요한 조직 설정 표면 — 가드가 역할을 실어 온다. */
@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class ProjectController {
  constructor(private readonly auth: AuthService) {}

  /** EP-PRJ-03 */
  @MemberOnly()
  @Get()
  project(@Req() req: ProjectRequest): Promise<unknown> {
    return this.auth.project(req.nervProjectId ?? '');
  }

  /** EP-PRJ-05 — 보관·복구(admin). **지우지 않는다** — 스펙 아카이브와 같은 규약이다 */
  @RequireRole('admin')
  @Post('archive')
  archive(@Req() req: ProjectRequest): Promise<unknown> {
    return this.auth.setProjectArchived({
      actor: actorOf(req),
      projectId: req.nervProjectId ?? '',
      roles: rolesOf(req),
      archived: true,
    });
  }

  @RequireRole('admin')
  @Post('restore')
  restore(@Req() req: ProjectRequest): Promise<unknown> {
    return this.auth.setProjectArchived({
      actor: actorOf(req),
      projectId: req.nervProjectId ?? '',
      roles: rolesOf(req),
      archived: false,
    });
  }

  /** EP-PRJ-04 — 게이트 정책·위험도 임계는 admin 전용 */
  @RequireRole('admin')
  @Patch()
  update(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const input = parseBody(ProjectUpdateInput, body);
    return this.auth.updateProject({
      actor: actorOf(req),
      projectId: req.nervProjectId ?? '',
      roles: rolesOf(req),
      name: input.name ?? null,
      description: input.description ?? null,
      repoUrl: input.repo_url ?? null,
      defaultBranch: input.default_branch ?? null,
      gatePolicy: input.gate_policy ?? null,
      retention: input.retention ?? null,
    });
  }
}

export function principalOf(req: ProjectRequest): Principal {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal;
}

/**
 * 프로젝트 관리 셋(EP-PRJ-04·05)은 **사람 전용**이다(2026-09-04 · 사람 결정).
 *
 * 역할만 보던 동안 admin 의 PAT 는 게이트 정책과 위험도 임계를 바꿀 수 있었다 — 그런데
 * 게이트 **면제**(EP-APR-04)는 이미 사람 전용이다. 같은 축의 한쪽만 토큰에 열려 있으면
 * 그것이 우회로가 된다: 면제를 못 받는 에이전트가 정책 자체를 낮추면 되기 때문이다.
 * 보관·복구를 함께 막는 것은 프로젝트를 목록에서 지우는 일이 같은 무게라서다.
 */
/**
 * 표면은 **주체를 읽어 넘기기만 한다** — 무엇을 막을지는 도메인이 정한다(D-05).
 *
 * 예전에는 여기 `humanOnly(req)` 가 있었고 서비스는 주체를 받지도 않았다: 다른 표면이
 * 같은 메서드를 부르면 게이트가 없다는 뜻이었다(2026-09-05 · REQ-API-111).
 */
function actorOf(req: ProjectRequest): Actor {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return { userId: principal.userId, isAgent: principal.isAgent };
}

function rolesOf(req: ProjectRequest): readonly MembershipRole[] {
  const role = req.nervRoles;
  if (role === undefined || role.length === 0) {
    throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.no_role'), { kind: 'no_role' });
  }
  return role;
}
