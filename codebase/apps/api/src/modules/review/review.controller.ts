// REST — 리뷰 제출·발견 목록·처분 (Phase 2 · FR-09)
//
// MCP 도구와 **같은 서비스**를 거친다(D-05). 두 표면이 같은 판정을 두 벌 갖지 않는 것이
// 이 구조의 전부다 — 웹에서 처분한 발견과 도구로 처분한 발견이 다른 규칙을 타면
// 게이트는 어느 쪽을 믿어야 하는지 답할 수 없다.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { intParam } from '../../common/query-vocab.js';
import { parseBody } from '../../common/parse-body.js';
import {
  FindingCommentInput,
  FindingResolveInput,
  FindingToChangeRequestInput,
  GateCheckReportInput,
  msg,
  NERV_ERROR,
  ReviewSubmitInput,
} from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { principalOf } from '../../common/scope-check.js';
import { ReviewService, resolutionOf, toSubmitFindings } from './review.service.js';
import { ChangeRequestService } from '../spec/change-request.service.js';
import { CutoverService } from './cutover.service.js';

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class ReviewController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly changeRequests: ChangeRequestService,
    private readonly cutover: CutoverService,
  ) {}

  /** EP-REV-01 — 리뷰 제출. 도구 `nerv_review_submit` 과 같은 입구다 */
  @RequireScope('review:submit')
  @Post('reviews')
  submit(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = principalOf(req);
    const input = parseBody(ReviewSubmitInput, body);
    return this.reviews.submit({
      projectId: req.nervProjectId!,
      userId: principal.userId,
      isAgent: principal.isAgent,
      branch: input.branch,
      baseSha: input.base_sha,
      headSha: input.head_sha,
      changeset: input.changeset,
      kind: input.kind as 'code',
      taskId: input.task_id ?? null,
      // **REST 도 세션을 붙인다**(2026-09-28 · REQ-API-238) — 버리고 있어서 REST 로 낸 라운드에는 세션도,
      // 클레임에서 채우는 Task 도 없었다. 제출자의 세션인지는 서비스가 판정한다
      sessionId: input.session_id ?? null,
      reviewer: {
        role: input.reviewer?.role ?? '',
        risk: (input.reviewer?.risk ?? null) as 'low' | null,
      },
      summaryMd: input.summary ?? null,
      // **캐스팅이 아니라 번역이다**(REQ-API-114). 계약은 `body`·`suggestion` 으로 오고
      // 저장은 `body_md`·`suggestion_md` 다 — 예전에는 여기서 타입만 맞춰 넘겨 REST 로 올린
      // 리뷰의 지적 본문이 전부 NULL 이었다. MCP 와 같은 매퍼를 쓴다.
      findings: toSubmitFindings(input.findings),
      payloadRef: input.payload_ref ?? null,
    });
  }

  /** EP-REV-03 — 발견 큐. S6 리뷰 센터가 읽는 곳. facet 은 같은 응답에 실린다 */
  @RequireScope('spec:read')
  @Get('findings')
  findings(
    @Req() req: ProjectRequest,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('tag') tag?: string,
    @Query('area') area?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('branch') branch?: string,
  ): Promise<unknown> {
    return this.reviews.findings({
      projectId: req.nervProjectId!,
      // 기본은 **열린 것만**이다 — 처분한 것까지 함께 보이면 큐가 큐이기를 그만둔다
      status: csv(status) ?? ['open'],
      ...(csv(severity) === undefined ? {} : { severity: csv(severity)! }),
      ...(csv(tag) === undefined ? {} : { tag: csv(tag)! }),
      ...(csv(area) === undefined ? {} : { area: csv(area)! }),
      branch: branch ?? null,
      cursor: cursor ?? null,
      // 숫자가 아니면 400 이다(§1.4j) — NaN 을 상한 계산에 넣으면 조용히 기본값이 된다
      ...((): { limit?: number } => {
        const parsed = intParam(limit, 'limit');
        return parsed === null ? {} : { limit: parsed };
      })(),
    });
  }

  /** EP-REV-04 — 브랜치별 게이트 현황. 표시용이다 — Task done 을 막는 판정은 done 게이트다 */
  @RequireScope('spec:read')
  @Get('gates/reviews')
  gateCoverage(@Req() req: ProjectRequest, @Query('limit') limit?: string): Promise<unknown> {
    // 숫자가 아니거나 1 보다 작으면 400 이다 — `Number('abc')` 가 LIMIT NaN 으로 가서 500 이던 자리다(REQ-API-237)
    const n = intParam(limit, 'limit');
    if (n !== null && n < 1) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
        kind: 'invalid_input',
        field: 'limit',
        unknown: [limit],
        allowed: ['integer >= 1'],
      });
    }
    return this.reviews.gateCoverage(req.nervProjectId!, ...(n === null ? [] : ([n] as const)));
  }

  /**
   * EP-REV-08 — 게이트 판정(2026-09-28 · clemvion 요청 N1 · 사람 결정 D1 · D2 · REQ-API-247). **집행에 써도 되는 조회다**
   * — push 훅과 CI 가 "이 브랜치의 이 종류 라운드가 통과했나" 를 한 번에 묻는다. 표시용인 EP-REV-04 와 판정
   * 기준이 달라서(열린 warning 도 막는다) 경로를 나눴다. 판정은 `review-gate.ts` 한 곳이다.
   */
  @RequireScope('spec:read')
  @Get('gates/reviews/check')
  gateCheck(
    @Req() req: ProjectRequest,
    @Query('branch') branch?: string,
    @Query('kind') kind?: string,
    @Query('head_sha') headSha?: string,
  ): Promise<unknown> {
    if (branch === undefined || branch.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
        kind: 'invalid_input',
        field: 'branch',
        allowed: ['branch name'],
      });
    }
    return this.reviews.gateCheck({
      projectId: req.nervProjectId!,
      branch,
      kinds: csv(kind) ?? null,
      headSha: headSha === undefined || headSha.trim() === '' ? null : headSha.trim(),
    });
  }

  /**
   * EP-REV-08b — 게이트 판정에 **로컬 판정을 함께 보낸다**(2026-10-16 · 사람 결정 D6 · E21-S03 · REQ-API-345 · roadmap §7.4 규칙 3).
   * 판정은 GET 과 같고, 서버가 두 판정을 견주어 남긴다. 비교를 남기는 쓰기라 권한은 `review:submit` 이다 — 로컬 판정을 가진 쪽은
   * 개발자 기계의 훅이고 그 훅은 그 사람의 에이전트 토큰(권장 묶음에 `review:submit` 이 있다)을 쓴다. 읽기 권한뿐인 CI 토큰은 로컬
   * 판정이 없으니 GET 을 그대로 쓴다. viewer 는 비교를 남길 수 없다 — 롤백 지표를 움직이는 기록이다.
   */
  @RequireScope('review:submit')
  @Post('gates/reviews/check')
  // 판정을 묻는 호출이라 GET 과 같은 200 이다 — 비교 기록은 부수 효과이고 새로 만든 자원을 돌려주지 않는다
  @HttpCode(HttpStatus.OK)
  gateCheckWithLocal(
    @Req() req: ProjectRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = principalOf(req);
    const input = parseBody(GateCheckReportInput, body ?? {});
    return this.cutover.checkWithLocal({
      projectId: req.nervProjectId!,
      userId: principal.userId,
      isAgent: principal.isAgent,
      branch: input.branch,
      kind: input.kind ?? null,
      headSha: input.head_sha,
      local: {
        verdict: input.local_state.verdict,
        hook: input.local_state.hook ?? null,
        reason: input.local_state.reason ?? null,
      },
    });
  }

  /**
   * EP-REV-10 — 컷오버 지표(2026-10-16 · 사람 결정 D6 · REQ-API-348). 이중화 기간의 불일치율 · 리뷰 제출 실패율과 로드맵 기준(§7.5 ·
   * §7.6)에 견준 상태다. 역할(admin · planner)은 서비스가 본다 — CLI(`nerv cutover report`)가 그 사람의 토큰으로 부른다.
   */
  @RequireScope('spec:read')
  @Get('gates/reviews/cutover')
  cutoverReport(
    @Req() req: ProjectRequest,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ): Promise<unknown> {
    return this.cutover.report({
      projectId: req.nervProjectId!,
      roles: req.nervRoles ?? [],
      since: since ?? null,
      until: until ?? null,
    });
  }

  /**
   * EP-REV-02 — 처분. **사람도 이 문으로 들어온다.**
   *
   * 사람이 부르면 `sessionId` 가 없고, 그래서 critical 하향의 A3 게이트가 걸리지 않는다 —
   * 게이트가 막는 것은 "에이전트가 자기 리뷰의 심각도를 스스로 낮추는 것"이지 사람의
   * 판단이 아니다(agent-integration §2.3). 사람의 판단은 `rationale` 로 남는다.
   */
  @RequireScope('review:resolve')
  @Post('findings/:id/resolve')
  resolve(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = principalOf(req);
    // 번역표는 도메인 쪽 한 벌이다 — 예전에는 여기 3값짜리 사본이 있어서 웹이 보낸
    // `spec_change` 가 `dismissed` 로 접히고 `spec_version_id` 가 버려졌다(REQ-API-060).
    const resolve = parseBody(FindingResolveInput, body);
    const mapped = resolutionOf(resolve.resolution);
    return this.reviews.resolve({
      projectId: req.nervProjectId!,
      findingId: id,
      userId: principal.userId,
      isAgent: principal.isAgent,
      kind: mapped.kind,
      status: mapped.status,
      rationale: String(body['rationale'] ?? ''),
      commitSha: typeof body['commit_sha'] === 'string' ? body['commit_sha'] : null,
      changeRequestId:
        typeof body['change_request_id'] === 'string' ? body['change_request_id'] : null,
      specVersionId: typeof body['spec_version_id'] === 'string' ? body['spec_version_id'] : null,
      // `escalated` 의 필수 짝 — 왜 사람을 부르는가(2026-09-05 · REQ-API-108)
      escalateReason: typeof body['escalate_reason'] === 'string' ? body['escalate_reason'] : null,
      // 넘긴 쪽이 기다리는가(2026-10-16 · REQ-API-334) — 이 표면에는 세션이 없어 기본은 기다리지 않는다
      ...(resolve.blocking == null ? {} : { blocking: resolve.blocking }),
    });
  }

  /**
   * EP-REV-09 — **발견을 변경 요청으로 보낸다**(2026-10-16 · 사람 결정 · REQ-API-332 · spec-workflow §3.4). `spec_drift` 발견의 유래
   * 스펙에 초안 · CR 을 열고(이미 열린 CR 이 있으면 거기에 잇는다) 발견을 그 CR 에 묶는다. 처분 권한(`review:resolve`)이 문턱이고
   * 역할(planner · admin)은 서비스가 본다(D-05).
   */
  @RequireScope('review:resolve')
  @Post('findings/:id/change-request')
  toChangeRequest(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = principalOf(req);
    const input = parseBody(FindingToChangeRequestInput, body ?? {});
    return this.changeRequests.fromFinding({
      projectId: req.nervProjectId!,
      findingId: id,
      userId: principal.userId,
      sessionId: null,
      isAgent: principal.isAgent,
      roles: req.nervRoles ?? [],
      ...(input.rationale == null ? {} : { rationale: input.rationale }),
    });
  }
  /**
   * EP-REV-05 · EP-REV-06 — 발견에 말을 남기고 읽는다(2026-08-30 신설).
   *
   * **코멘트는 참여이고 처분은 권한이다**(2026-10-11 · REQ-API-294 · 사람 결정). 예전에는 처분과 같은 `review:resolve` 를
   * 요구해 developer · designer 가 자기 코드에 달린 발견에 답하지 못했다. 이제 `review:submit`(viewer 를 뺀 모든 역할)이고,
   * 처분(EP-REV-04)은 그대로 `review:resolve` 다 — 스펙 코멘트(EP-CMT-02)와 같은 원칙이다. 에이전트 토큰도 남긴다.
   */
  @RequireScope('review:submit')
  @Post('findings/:id/comments')
  comment(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = principalOf(req);
    return this.reviews.comment({
      projectId: req.nervProjectId!,
      findingId: id,
      userId: principal.userId,
      // 감사의 주체는 토큰에서 읽는다(FR-16) — 세션 id 가 없는 REST 호출도 에이전트면 에이전트로 남는다
      isAgent: principal.isAgent,
      bodyMd: parseBody(FindingCommentInput, body).body_md,
    });
  }

  @RequireScope('spec:read')
  @Get('findings/:id/comments')
  findingComments(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    return this.reviews.comments({ projectId: req.nervProjectId!, findingId: id });
  }

  /** EP-REV-07 — 발견을 Task 로 올린다(2026-08-30 신설 · REQ-API-059) */
  @RequireScope('task:update')
  @Post('findings/:id/task')
  promote(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    return this.reviews.promote({
      projectId: req.nervProjectId!,
      findingId: id,
      userId: principalOf(req).userId,
    });
  }
}

/** `?status=open,fixed` — 쉼표 목록을 배열로. 빈 값은 "필터 없음"이지 "0건"이 아니다. */
function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  return parts.length === 0 ? undefined : parts;
}
