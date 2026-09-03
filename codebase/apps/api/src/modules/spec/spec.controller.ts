// REST — tree · get · draft · submit · 승인/거절 (api.md §2.2)
//
// 표면은 번역만 한다(REQ-CB-003). 프로젝트 해소·멤버십은 가드가 끝내고 온다.
// **승인·거절은 사람 전용이다** — MCP 카탈로그에 대응 도구가 없고 여기만 열려 있다.

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';

/**
 * 회신 객체의 **쓰는 만큼만** 타입을 적는다 — `fastify` 를 직접 의존하지 않으려는 것이다
 * (플랫폼 어댑터가 그것을 감싸고 있고, 여기서 뚫으면 어댑터를 바꿀 때 이 파일이 걸린다).
 */
interface RawReply {
  header(name: string, value: string): RawReply;
  send(body: unknown): unknown;
}
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { principalOf } from '../../common/scope-check.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireRole, RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { BaselineService } from './baseline.service.js';
import { SearchService } from './search.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { SpecRelationService } from './spec-relation.service.js';
import { AttachmentService } from './attachment.service.js';
import { StorageService } from '../../common/storage.service.js';
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
    // 이름 끝의 `_` 는 위의 `attachments()` 메서드와 부딪히지 않게 하려는 것이다
    private readonly attachments_: AttachmentService,
    private readonly storage: StorageService,
  ) {}

  /** EP-SPEC-01 */
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
  @Get('baselines')
  listBaselines(@Req() req: ProjectRequest): Promise<unknown> {
    return this.baselines.list(projectOf(req));
  }

  /** EP-SPEC-14 — baseline 이름 또는 as_of 시각 중 하나(배타) */
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
  @Get('baselines/:name')
  getBaseline(@Req() req: ProjectRequest, @Param('name') name: string): Promise<unknown> {
    return this.baselines.get({ projectId: projectOf(req), name });
  }

  /** EP-SPEC-03 — 기준 버전 지정 조회(`?v=`)를 지원한다 */
  @RequireScope('spec:read')
  @Get('specs/:spec')
  get(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Query('v') version?: string,
    // 쉼표로 온다 — 배열 쿼리 표기(`include[]=`)는 프록시마다 다르게 접힌다
    @Query('include') include?: string,
  ): Promise<Record<string, unknown>> {
    return this.specs.get({
      projectId: projectOf(req),
      specKey: spec,
      versionNo: version === undefined ? null : Number(version),
      include:
        include === undefined || include === ''
          ? null
          : include.split(',').map((name) => name.trim()),
    });
  }

  /**
   * EP-SPEC-07 — **새 스펙 생성**. 생성과 이어쓰기를 문서가 나눈 이유가 있다:
   * 생성은 key·type·title 이 필요하고 이어쓰기는 base_hash 가 필요하다 —
   * 한 경로에 섞으면 어느 쪽 필수 필드가 빠졌는지 오류가 흐려진다.
   */
  @RequireScope('spec:draft')
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
  @RequireScope('spec:draft')
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
      // 비교-교환의 기준 — 웹도 읽은 지문을 그대로 되돌려 준다(§1.4g)
      ...(typeof body['base_hash'] === 'string' ? { baseHash: body['base_hash'] } : {}),
      ...(typeof body['change_summary'] === 'string'
        ? { changeSummary: body['change_summary'] }
        : {}),
      // 리스 인계 — 웹에서 "인계" 를 누른 다음 저장이 이것을 싣는다(§1.4h)
      ...(body['takeover'] === true ? { takeover: true } : {}),
    });
  }

  /** EP-SPEC-10 — A3. 게이트 티어에 따라 자동 통과 또는 승인 대기 */
  @RequireScope('spec:draft')
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

  // 승인·거절 REST 는 **없다**(api.md §2.2). 전이는 EP-APR-03 `POST /approvals/{id}/decision`
  // 한 경로다 — 결재 카드가 남고, 지시자≠승인자와 자기승인 완화가 거기서 판정되며,
  // 결정과 문서 상태가 같은 트랜잭션에서 함께 움직인다(REQ-API-063).
  //
  // 예전에는 `POST specs/approve`·`specs/reject` 가 열려 있었고 문턱이 `requireHuman` 뿐이라
  // **결재를 거치지 않고** 문서를 확정할 수 있었다. 거절은 `project_id` 조차 보지 않아 다른
  // 프로젝트의 in_review 를 되돌렸다(2026-09-02 제거).

  /** EP-COV-01 — 관계 그래프 집계다(§5.5). 문서 안의 ✅ 가 아니다 */
  @RequireScope('spec:read')
  @Get('coverage')
  coverage(@Req() req: ProjectRequest, @Query('spec') spec?: string): Promise<unknown> {
    return this.specs.coverage({ projectId: projectOf(req), specKey: spec ?? null });
  }

  /** EP-REQ-01 */
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
  @Get('requirements/:ref')
  requirement(@Req() req: ProjectRequest, @Param('ref') ref: string): Promise<unknown> {
    return this.specs.requirement({ projectId: projectOf(req), ref });
  }

  /** EP-REQ-03 — CI 가 PAT 로 부르는 경로이기도 하다 */
  @RequireRole('developer', 'qa', 'admin')
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
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
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
  @RequireScope('spec:draft')
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
  @RequireScope('spec:read')
  @Get('specs/:spec/versions')
  versions(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    return this.specs.versions({ projectId: projectOf(req), specKey: spec });
  }

  /** EP-SPEC-05 — 불변 스냅샷. 같은 `{no}` 는 영원히 같은 응답이다 */
  @RequireScope('spec:read')
  @Get('specs/:spec/versions/:no')
  version(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Param('no') no: string,
  ): Promise<unknown> {
    return this.specs.get({ projectId: projectOf(req), specKey: spec, versionNo: Number(no) });
  }

  /** EP-SPEC-06 */
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
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
  @RequireScope('spec:read')
  @Get('spec-versions/:ver/check')
  check(@Req() req: ProjectRequest, @Param('ver') ver: string): Promise<unknown> {
    return this.specs.check({ projectId: projectOf(req), specVersionId: ver });
  }

  /** EP-SPEC-15 — 메타 편집. 이동해도 버전·관계·코멘트는 그대로다(FR-01) */
  @RequireScope('spec:meta')
  @Patch('specs/:spec')
  updateMeta(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
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
  @RequireScope('spec:meta')
  @Post('specs/:spec/archive')
  archive(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    const principal = requireHuman(req);
    return this.specs.archive({
      projectId: projectOf(req),
      specKey: spec,
      userId: principal.userId,
    });
  }

  /** EP-SPEC-17 */
  @RequireScope('spec:meta')
  @Post('specs/:spec/restore')
  restore(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    const principal = requireHuman(req);
    return this.specs.restore({
      projectId: projectOf(req),
      specKey: spec,
      userId: principal.userId,
    });
  }

  /** EP-SPEC-12 — **사람 전용**. 동결은 거버넌스 행위다 */
  @RequireScope('spec:approve')
  @Post('baselines')
  createBaseline(
    @Req() req: ProjectRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = requireHuman(req);
    return this.baselines.create({
      projectId: projectOf(req),
      name: String(body['name'] ?? ''),
      noteMd: typeof body['note_md'] === 'string' ? body['note_md'] : null,
      specVersionIds: Array.isArray(body['items']) ? (body['items'] as string[]) : null,
      userId: principal.userId,
    });
  }

  /**
   * EP-SPEC-20 — 첨부 목록. 디자인 시안이 문서 밖에 있으면 문서가 아니다(§2.10).
   */
  @RequireScope('spec:read')
  @Get('specs/:spec/attachments')
  attachments(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    return this.attachments_.list({ projectId: projectOf(req), specKey: spec });
  }

  /** EP-SPEC-21 — 사람 업로드(multipart). 에이전트는 presign 2단계를 쓴다 */
  @RequireScope('spec:draft')
  @Post('specs/:spec/attachments')
  async upload(@Req() req: ProjectRequest, @Param('spec') spec: string): Promise<unknown> {
    const principal = principalOf(req);
    const file = await (
      req as unknown as { file: () => Promise<MultipartFile | undefined> }
    ).file();
    if (file === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
        kind: 'invalid_input',
        missing: ['file'],
      });
    }
    return this.attachments_.upload({
      projectId: projectOf(req),
      specKey: spec,
      userId: principal.userId,
      filename: file.filename,
      contentType: file.mimetype,
      body: await file.toBuffer(),
    });
  }

  /**
   * EP-SPEC-22 — 첨부 내려받기. **서버를 거친다**(REQ-API-070).
   *
   * presigned GET 을 주면 그 URL 이 권한 밖으로 새고, 첨부 주소가 공개면 스펙 권한이
   * 무의미해진다. SVG 를 허용하므로(사람 결정) 응답에 **CSP sandbox 와 nosniff** 를 붙인다 —
   * `<img src>` 로 부른 SVG 는 스크립트를 실행하지 않지만, 주소를 직접 연 경우가 남는다.
   */
  @RequireScope('spec:read')
  @Get('attachments/:id')
  async attachment(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Res() reply: RawReply,
  ): Promise<void> {
    const projectId = projectOf(req);
    const found = await this.attachments_.open({ projectId, attachmentId: id });
    if (found === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.not_found'), {
        kind: 'not_found',
      });
    }
    const object = await this.storage.get(found.storageKey);
    if (object === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.not_uploaded'), {
        kind: 'not_uploaded',
      });
    }
    void reply
      .header('content-type', found.contentType)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox; default-src 'none'")
      // 이름은 남기되 브라우저가 열게 둔다 — 시안은 보라고 올리는 것이다
      .header(
        'content-disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(found.filename)}`,
      )
      .send(object.body);
  }

  @RequireScope('spec:draft')
  @Delete('attachments/:id')
  removeAttachment(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    return this.attachments_.remove({ projectId: projectOf(req), attachmentId: id });
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
