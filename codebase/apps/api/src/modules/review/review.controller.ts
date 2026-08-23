// REST — 리뷰 제출·발견 목록·처분 (Phase 2 · FR-09)
//
// MCP 도구와 **같은 서비스**를 거친다(D-05). 두 표면이 같은 판정을 두 벌 갖지 않는 것이
// 이 구조의 전부다 — 웹에서 처분한 발견과 도구로 처분한 발견이 다른 규칙을 타면
// 게이트는 어느 쪽을 믿어야 하는지 답할 수 없다.

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { assertScope, principalOf } from '../../common/scope-check.js';
import { ReviewService } from './review.service.js';
import type { ResolutionKind, SubmitFinding } from './review.service.js';

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  /** EP-REV-01 — 리뷰 제출. 도구 `nerv_review_submit` 과 같은 입구다 */
  @Post('reviews')
  submit(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const principal = principalOf(req);
    assertScope(principal, 'review:submit');
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

  /** EP-REV-03 — 발견 목록. S6 리뷰 센터가 읽는 곳 */
  @Get('findings')
  findings(
    @Req() req: ProjectRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    assertScope(principalOf(req), 'spec:read');
    return this.reviews.findings({
      projectId: req.nervProjectId!,
      status: status ?? 'open',
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  /**
   * EP-REV-02 — 처분. **사람도 이 문으로 들어온다.**
   *
   * 사람이 부르면 `sessionId` 가 없고, 그래서 critical 하향의 A3 게이트가 걸리지 않는다 —
   * 게이트가 막는 것은 "에이전트가 자기 리뷰의 심각도를 스스로 낮추는 것"이지 사람의
   * 판단이 아니다(agent-integration §2.3). 사람의 판단은 `rationale` 로 남는다.
   */
  @Post('findings/:id/resolve')
  resolve(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const principal = principalOf(req);
    assertScope(principal, 'review:resolve');
    const asked = String(body['resolution'] ?? 'dismissed');
    const status: 'fixed' | 'dismissed' | 'wont_fix' =
      asked === 'fixed' || asked === 'wont_fix' ? asked : 'dismissed';
    return this.reviews.resolve({
      projectId: req.nervProjectId!,
      findingId: id,
      userId: principal.userId,
      isAgent: principal.isAgent,
      kind: (status === 'wont_fix' ? 'deferred' : status) as ResolutionKind,
      status,
      rationale: String(body['rationale'] ?? ''),
      commitSha: typeof body['commit_sha'] === 'string' ? body['commit_sha'] : null,
      changeRequestId:
        typeof body['change_request_id'] === 'string' ? body['change_request_id'] : null,
    });
  }
}
