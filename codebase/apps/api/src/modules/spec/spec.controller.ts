// REST — tree · get · draft · submit · 승인/거절 (api.md §2.2)
//
// 표면은 번역만 한다(REQ-CB-003). 프로젝트 해소·멤버십은 가드가 끝내고 온다.
// **승인·거절은 사람 전용이다** — MCP 카탈로그에 대응 도구가 없고 여기만 열려 있다.

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertScope, principalOf } from '../../common/scope-check.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { BaselineService } from './baseline.service.js';
import { SearchService } from './search.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { SpecRelationService } from './spec-relation.service.js';
import { SpecService } from './spec.service.js';
import type { SpecGraphEdge, SpecTreeNode } from './spec.service.js';

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class SpecController {
  constructor(
    private readonly specs: SpecService,
    private readonly comments: SpecCommentService,
    private readonly baselines: BaselineService,
    private readonly searches: SearchService,
    private readonly relations: SpecRelationService,
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

  /**
   * EP-SPEC-19 — 전역 그래프. 노드와 간선을 한 응답으로 준다(§2.2).
   * 트리와 관계를 따로 받으면 그 사이의 변화가 끝점 없는 간선으로 남는다.
   */
  @Get('specs/graph')
  graph(
    @Req() req: ProjectRequest,
    @Query('include_archived') includeArchived?: string,
  ): Promise<{ nodes: SpecTreeNode[]; edges: SpecGraphEdge[] }> {
    return this.specs.graph({
      projectId: projectOf(req),
      includeArchived: includeArchived === 'true',
    });
  }

  /** EP-SPEC-02 — 하이브리드. 모드 선택 파라미터가 없는 것이 의도다(§2.2b) */
  @Get('specs/search')
  search(
    @Req() req: ProjectRequest,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('references') references?: string,
    @Query('include_archived') includeArchived?: string,
  ): Promise<unknown> {
    return this.searches.search({
      projectId: projectOf(req),
      query: q ?? '',
      includeArchived: includeArchived === 'true',
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(references === undefined ? {} : { references }),
    });
  }

  /** EP-SPEC-11 */
  @Get('baselines')
  listBaselines(@Req() req: ProjectRequest): Promise<unknown> {
    return this.baselines.list(projectOf(req));
  }

  /** EP-SPEC-14 — baseline 이름 또는 as_of 시각 중 하나(배타) */
  @Get('specs/manifest')
  manifest(
    @Req() req: ProjectRequest,
    @Query('baseline') baseline?: string,
    @Query('as_of') asOf?: string,
  ): Promise<unknown> {
    return this.baselines.manifest({
      projectId: projectOf(req),
      baselineName: baseline ?? null,
      asOf: asOf ?? null,
    });
  }

  /** EP-SPEC-13 */
  @Get('baselines/:name')
  getBaseline(@Req() req: ProjectRequest, @Param('name') name: string): Promise<unknown> {
    return this.baselines.get({ projectId: projectOf(req), name });
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

  /**
   * EP-SPEC-07 — **새 스펙 생성**. 생성과 이어쓰기를 문서가 나눈 이유가 있다:
   * 생성은 key·type·title 이 필요하고 이어쓰기는 base_version 이 필요하다 —
   * 한 경로에 섞으면 어느 쪽 필수 필드가 빠졌는지 오류가 흐려진다.
   */
  @Post('specs')
  create(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.specs.draftUpsert({
      // 역할은 가드가 실어 준 것을 그대로 넘긴다 — 표면은 번역만 하고 판정하지 않는다(D-05)
      roles: principalOf(req).roles,
      projectId: projectOf(req),
      userId: principal.userId,
      bodyMd: String(body['body_markdown'] ?? body['body_md'] ?? ''),
      key: String(body['key'] ?? ''),
      title: String(body['title'] ?? ''),
      type: String(body['type'] ?? 'feature'),
      ...(typeof body['parent_id'] === 'string' ? { parentId: body['parent_id'] } : {}),
    });
  }

  /** EP-SPEC-08 — 초안 이어쓰기. `{spec}` 이 경로에 있으므로 본문에 spec_id 를 받지 않는다 */
  @Put('specs/:spec/draft')
  draft(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.specs.draftUpsertByKey({
      projectId: projectOf(req),
      specKey: spec,
      userId: principal.userId,
      bodyMd: String(body['body_markdown'] ?? body['body_md'] ?? ''),
      ...(typeof body['base_version'] === 'string' ? { baseVersionId: body['base_version'] } : {}),
      // 비교-교환의 기준 — 웹도 읽은 지문을 그대로 되돌려 준다(§1.4g)
      ...(typeof body['base_hash'] === 'string' ? { baseHash: body['base_hash'] } : {}),
      ...(typeof body['change_summary'] === 'string'
        ? { changeSummary: body['change_summary'] }
        : {}),
    });
  }

  /** EP-SPEC-10 — A3. 게이트 티어에 따라 자동 통과 또는 승인 대기 */
  @Post('spec-versions/:ver/submit')
  submit(@Req() req: ProjectRequest, @Param('ver') ver: string): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.specs.submitReview({
      projectId: projectOf(req),
      specVersionId: ver,
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

  /** EP-COV-01 — 관계 그래프 집계다(§5.5). 문서 안의 ✅ 가 아니다 */
  @Get('coverage')
  coverage(@Req() req: ProjectRequest, @Query('spec') spec?: string): Promise<unknown> {
    return this.specs.coverage({ projectId: projectOf(req), specKey: spec ?? null });
  }

  /** EP-REQ-01 */
  @Get('requirements')
  requirements(
    @Req() req: ProjectRequest,
    @Query('spec') spec?: string,
    @Query('impl_status') implStatus?: string,
  ): Promise<unknown> {
    return this.specs.requirements({
      projectId: projectOf(req),
      specKey: spec ?? null,
      implStatus: implStatus ?? null,
    });
  }

  /** EP-REQ-02 */
  @Get('requirements/:ref')
  requirement(@Req() req: ProjectRequest, @Param('ref') ref: string): Promise<unknown> {
    return this.specs.requirement({ projectId: projectOf(req), ref });
  }

  /** EP-REQ-03 — CI 가 PAT 로 부르는 경로이기도 하다 */
  @Post('requirements/:ref/evidence')
  addEvidence(
    @Req() req: ProjectRequest,
    @Param('ref') ref: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.specs.addEvidence({
      projectId: projectOf(req),
      ref,
      kind: String(body['kind'] ?? 'pr'),
      locator: String(body['locator'] ?? ''),
      repo: typeof body['repo'] === 'string' ? body['repo'] : null,
      userId: principal.userId,
    });
  }

  /** EP-CMT-01 */
  @Get('specs/:spec/comments')
  commentList(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Query('status') status?: string,
  ): Promise<unknown> {
    return this.comments.list({
      projectId: projectOf(req),
      specKey: spec,
      status: status === 'resolved' ? 'resolved' : status === 'open' ? 'open' : null,
    });
  }

  /** EP-CMT-02 — viewer 도 쓴다. 지적은 권한이 아니라 참여다 */
  @Post('spec-versions/:ver/comments')
  addComment(
    @Req() req: ProjectRequest,
    @Param('ver') ver: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.comments.add({
      projectId: projectOf(req),
      specVersionId: ver,
      anchor: String(body['anchor'] ?? ''),
      bodyMd: String(body['body_md'] ?? ''),
      userId: principal.userId,
    });
  }

  /** EP-CMT-03 — 작성자 본인만 */
  @Patch('comments/:id')
  updateComment(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.comments.update({
      projectId: projectOf(req),
      commentId: id,
      bodyMd: String(body['body_md'] ?? ''),
      userId: principal.userId,
    });
  }

  /** EP-CMT-04 */
  @Post('comments/:id/resolve')
  resolveComment(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.comments.resolve({
      projectId: projectOf(req),
      commentId: id,
      userId: principal.userId,
      resolutionNote: typeof body['resolution_note'] === 'string' ? body['resolution_note'] : null,
      resolvedInVersionId:
        typeof body['resolved_in_version_id'] === 'string' ? body['resolved_in_version_id'] : null,
    });
  }

  /** EP-SPEC-04 */
  @Get('specs/:spec/versions')
  versions(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    return this.specs.versions({ projectId: projectOf(req), specKey: spec });
  }

  /** EP-SPEC-05 — 불변 스냅샷. 같은 `{no}` 는 영원히 같은 응답이다 */
  @Get('specs/:spec/versions/:no')
  version(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Param('no') no: string,
  ): Promise<unknown> {
    return this.specs.get({ projectId: projectOf(req), specKey: spec, versionNo: Number(no) });
  }

  /** EP-SPEC-06 */
  @Get('specs/:spec/diff')
  diff(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<unknown> {
    return this.specs.diff({
      projectId: projectOf(req),
      specKey: spec,
      fromVersionNo: from === undefined ? null : Number(from),
      toVersionNo: to === undefined ? null : Number(to),
    });
  }

  /** EP-SPEC-18 — 역참조가 1급이다: 수정 전 "누가 나를 참조하나"의 조회 경로 */
  @Get('specs/:spec/relations')
  specRelations(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Query('direction') direction?: string,
    @Query('kind') kind?: string,
  ): Promise<unknown> {
    return this.relations.list({
      projectId: projectOf(req),
      specKey: spec,
      direction: direction === 'out' || direction === 'in' ? direction : 'both',
      kind: kind ?? null,
    });
  }

  /** EP-SPEC-09 — 셀프서비스 사전 검토(읽기 전용) */
  @Get('spec-versions/:ver/check')
  check(@Req() req: ProjectRequest, @Param('ver') ver: string): Promise<unknown> {
    return this.specs.check({ projectId: projectOf(req), specVersionId: ver });
  }

  /** EP-SPEC-15 — 메타 편집. 이동해도 버전·관계·코멘트는 그대로다(FR-01) */
  @Patch('specs/:spec')
  updateMeta(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    assertScope(principalOf(req), 'spec:meta');
    const principal = requireHuman(req);
    return this.specs.updateMeta({
      projectId: projectOf(req),
      specKey: spec,
      userId: principal.userId,
      title: typeof body['title'] === 'string' ? body['title'] : null,
      parentKey: typeof body['parent_key'] === 'string' ? body['parent_key'] : null,
      detachParent: body['parent_key'] === null,
      sortKey: typeof body['sort_key'] === 'string' ? body['sort_key'] : null,
      ownerRole: typeof body['owner_role'] === 'string' ? body['owner_role'] : null,
    });
  }

  /** EP-SPEC-16 */
  @Post('specs/:spec/archive')
  archive(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    assertScope(principalOf(req), 'spec:meta');
    const principal = requireHuman(req);
    return this.specs.archive({
      projectId: projectOf(req),
      specKey: spec,
      userId: principal.userId,
    });
  }

  /** EP-SPEC-17 */
  @Post('specs/:spec/restore')
  restore(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    assertScope(principalOf(req), 'spec:meta');
    const principal = requireHuman(req);
    return this.specs.restore({
      projectId: projectOf(req),
      specKey: spec,
      userId: principal.userId,
    });
  }

  /** EP-SPEC-12 — **사람 전용**. 동결은 거버넌스 행위다 */
  @Post('baselines')
  createBaseline(
    @Req() req: ProjectRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    assertScope(principalOf(req), 'spec:approve');
    const principal = requireHuman(req);
    return this.baselines.create({
      projectId: projectOf(req),
      name: String(body['name'] ?? ''),
      noteMd: typeof body['note_md'] === 'string' ? body['note_md'] : null,
      specVersionIds: Array.isArray(body['items']) ? (body['items'] as string[]) : null,
      userId: principal.userId,
    });
  }
}

function projectOf(req: ProjectRequest): string {
  const projectId = req.nervProjectId;
  if (projectId === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.unresolved'), {
      kind: 'unresolved_project',
    });
  }
  return projectId;
}

/** 사람 전용 액션의 문 — A4 는 도구가 없고 웹에서 사람만 한다(agent-integration §2.2). */
function requireHuman(req: ProjectRequest): { userId: string } {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  if (principal.isAgent) {
    throw new NervError(NERV_ERROR.HUMAN_ONLY, msg('error.human_only.approve'), {
      kind: 'human_only',
      web_url: '/inbox',
    });
  }
  return { userId: principal.userId };
}
