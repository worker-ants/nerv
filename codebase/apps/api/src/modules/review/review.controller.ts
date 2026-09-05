// REST — 리뷰 제출·발견 목록·처분 (Phase 2 · FR-09)
//
// MCP 도구와 **같은 서비스**를 거친다(D-05). 두 표면이 같은 판정을 두 벌 갖지 않는 것이
// 이 구조의 전부다 — 웹에서 처분한 발견과 도구로 처분한 발견이 다른 규칙을 타면
// 게이트는 어느 쪽을 믿어야 하는지 답할 수 없다.

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { intParam } from '../../common/query-vocab.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { principalOf } from '../../common/scope-check.js';
import { ReviewService, resolutionOf } from './review.service.js';
import type { SubmitFinding } from './review.service.js';

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  /** EP-REV-01 — 리뷰 제출. 도구 `nerv_review_submit` 과 같은 입구다 */
  @RequireScope('review:submit')
  @Post('reviews')
  submit(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = principalOf(req);
    const reviewer = (body['reviewer'] ?? {}) as { role?: string; risk?: string };
    return this.reviews.submit({
      projectId: req.nervProjectId!,
      userId: principal.userId,
      isAgent: principal.isAgent,
      branch: String(body['branch'] ?? ''),
      baseSha: String(body['base_sha'] ?? ''),
      headSha: String(body['head_sha'] ?? ''),
      changeset: Array.isArray(body['changeset'])
        ? (body['changeset'] as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
      kind: (typeof body['kind'] === 'string' ? body['kind'] : 'code') as 'code',
      taskId: typeof body['task_id'] === 'string' ? body['task_id'] : null,
      reviewer: {
        role: String(reviewer.role ?? ''),
        risk: (reviewer.risk ?? null) as 'low' | null,
      },
      summaryMd: typeof body['summary'] === 'string' ? body['summary'] : null,
      findings: (Array.isArray(body['findings']) ? body['findings'] : []) as SubmitFinding[],
      payloadRef: typeof body['payload_ref'] === 'string' ? body['payload_ref'] : null,
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
  ): Promise<unknown> {
    return this.reviews.findings({
      projectId: req.nervProjectId!,
      // 기본은 **열린 것만**이다 — 처분한 것까지 함께 보이면 큐가 큐이기를 그만둔다
      status: csv(status) ?? ['open'],
      ...(csv(severity) === undefined ? {} : { severity: csv(severity)! }),
      ...(csv(tag) === undefined ? {} : { tag: csv(tag)! }),
      ...(csv(area) === undefined ? {} : { area: csv(area)! }),
      cursor: cursor ?? null,
      // 숫자가 아니면 400 이다(§1.4j) — NaN 을 상한 계산에 넣으면 조용히 기본값이 된다
      ...((): { limit?: number } => {
        const parsed = intParam(limit, 'limit');
        return parsed === null ? {} : { limit: parsed };
      })(),
    });
  }

  /** EP-REV-04 — 브랜치별 게이트 현황. 표시일 뿐 집행이 아니다 */
  @RequireScope('spec:read')
  @Get('gates/reviews')
  gateCoverage(@Req() req: ProjectRequest, @Query('limit') limit?: string): Promise<unknown> {
    return this.reviews.gateCoverage(
      req.nervProjectId!,
      ...(limit === undefined ? [] : ([Number(limit)] as const)),
    );
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
    const mapped = resolutionOf(String(body['resolution'] ?? 'dismissed'));
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
    });
  }
  /** EP-REV-07 — 발견에 사람의 말을 남긴다(2026-08-30 신설) */
  @RequireScope('review:resolve')
  @Post('findings/:id/comments')
  comment(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    // 처분과 같은 스코프다 — 발견에 개입하는 같은 축의 행동이다
    return this.reviews.comment({
      projectId: req.nervProjectId!,
      findingId: id,
      userId: principalOf(req).userId,
      bodyMd: String(body['body_md'] ?? ''),
    });
  }

  @RequireScope('spec:read')
  @Get('findings/:id/comments')
  findingComments(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    return this.reviews.comments({ projectId: req.nervProjectId!, findingId: id });
  }

  /** EP-REV-08 — 발견을 Task 로 올린다(2026-08-30 신설 · REQ-API-059) */
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
