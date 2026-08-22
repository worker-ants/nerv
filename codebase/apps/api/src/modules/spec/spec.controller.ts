// REST — tree · get · draft · submit · 승인/거절 (api.md §2.2)
//
// 표면은 번역만 한다(REQ-CB-003). 프로젝트 해소·멤버십은 가드가 끝내고 온다.
// **승인·거절은 사람 전용이다** — MCP 카탈로그에 대응 도구가 없고 여기만 열려 있다.

import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { BaselineService } from './baseline.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { SpecService } from './spec.service.js';
import type { SpecTreeNode } from './spec.service.js';

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class SpecController {
  constructor(
    private readonly specs: SpecService,
    private readonly comments: SpecCommentService,
    private readonly baselines: BaselineService,
  ) {}

  /** EP-SPEC-01 */
  @Get('specs/tree')
  tree(
    @Req() req: ProjectRequest,
    @Query('include_archived') includeArchived?: string,
  ): Promise<SpecTreeNode[]> {
    return this.specs.tree({
      projectId: projectOf(req),
      includeArchived: includeArchived === 'true',
    });
  }

  /** EP-SPEC-02 */
  @Get('specs/search')
  search(): never {
    return this.specs.search();
  }

  /** EP-SPEC-03 — 기준 버전 지정 조회(`?v=`)를 지원한다 */
  @Get('specs/:spec')
  get(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Query('v') version?: string,
  ): Promise<Record<string, unknown>> {
    return this.specs.get({
      projectId: projectOf(req),
      specKey: spec,
      versionNo: version === undefined ? null : Number(version),
    });
  }

  /** EP-SPEC-07·08 */
  @Put('specs/draft')
  draft(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 없습니다.', { kind: 'missing' });
    }
    return this.specs.draftUpsert({
      projectId: projectOf(req),
      userId: principal.userId,
      bodyMd: String(body['body_md'] ?? ''),
      ...(typeof body['spec_id'] === 'string' ? { specId: body['spec_id'] } : {}),
      ...(typeof body['key'] === 'string' ? { key: body['key'] } : {}),
      ...(typeof body['title'] === 'string' ? { title: body['title'] } : {}),
      ...(typeof body['type'] === 'string' ? { type: body['type'] } : {}),
      ...(typeof body['base_version'] === 'string' ? { baseVersionId: body['base_version'] } : {}),
    });
  }

  /** EP-SPEC-10 — A3. 게이트 티어에 따라 자동 통과 또는 승인 대기 */
  @Post('specs/submit')
  submit(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 없습니다.', { kind: 'missing' });
    }
    return this.specs.submitReview({
      projectId: projectOf(req),
      specVersionId: String(body['spec_version_id'] ?? ''),
      userId: principal.userId,
    });
  }

  /**
   * 승인 — **사람 전용**이다. PAT 로 들어온 요청은 여기서 막힌다:
   * `spec:approve` 는 토큰에 부여 자체가 불가능한 스코프라(api.md §1.3) 에이전트는 이 경로에
   * 도달할 수 없어야 한다. 도달하면 NERV_HUMAN_ONLY + 웹 딥링크다.
   */
  @Post('specs/approve')
  approve(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = requireHuman(req);
    return this.specs.approve({
      projectId: projectOf(req),
      specVersionId: String(body['spec_version_id'] ?? ''),
      approverUserId: principal.userId,
    });
  }

  @Post('specs/reject')
  reject(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = requireHuman(req);
    return this.specs.reject({
      projectId: projectOf(req),
      specVersionId: String(body['spec_version_id'] ?? ''),
      reviewerUserId: principal.userId,
      comment: String(body['comment'] ?? ''),
    });
  }

  /** EP-SPEC-12 */
  @Post('baselines')
  createBaseline(): never {
    return this.baselines.create();
  }
}

function projectOf(req: ProjectRequest): string {
  const projectId = req.nervProjectId;
  if (projectId === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, '프로젝트가 해소되지 않았습니다.', {
      kind: 'unresolved_project',
    });
  }
  return projectId;
}

/** 사람 전용 액션의 문 — A4 는 도구가 없고 웹에서 사람만 한다(agent-integration §2.2). */
function requireHuman(req: ProjectRequest): { userId: string } {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 없습니다.', { kind: 'missing' });
  }
  if (principal.isAgent) {
    throw new NervError(NERV_ERROR.HUMAN_ONLY, '승인은 사람만 할 수 있습니다.', {
      kind: 'human_only',
      web_url: '/inbox',
    });
  }
  return { userId: principal.userId };
}
