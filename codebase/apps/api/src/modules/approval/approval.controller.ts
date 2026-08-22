// REST — 승인함 · 결정 · 질문 답변 (api.md §2.6)
//
// 이 표면이 Phase 1 종료 게이트의 대상이다: 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건**.
// 그러려면 승인이 여기서 되는 것만으로는 부족하고, 여기서 **되어야만** 해야 한다 —
// 그래서 결정은 사람 전용이고 에이전트는 도구로도 도달할 수 없다.

import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { ApprovalService } from './approval.service.js';
import type { ApprovalDecision, InboxCard } from './approval.service.js';
import { QuestionService } from './question.service.js';

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly questions: QuestionService,
  ) {}

  /** EP-APR-01 — 승인함. 내 결정을 기다리는 것만 온다 */
  @Get('inbox')
  inbox(@Req() req: ProjectRequest): Promise<InboxCard[]> {
    const { projectId, userId } = human(req);
    return this.approvals.inbox({ projectId, userId });
  }

  /** EP-APR-03 — 결정. 사람 전용 */
  @Post('approvals/:id/decide')
  decide(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { projectId, userId } = human(req);
    return this.approvals.decide({
      projectId,
      approvalId: id,
      userId,
      decision: (body['decision'] as ApprovalDecision | undefined) ?? 'comment',
      ...(typeof body['comment'] === 'string' ? { comment: body['comment'] } : {}),
      ...(typeof body['seen_content_hash'] === 'string'
        ? { seenContentHash: body['seen_content_hash'] }
        : {}),
    });
  }

  /** EP-APR-04 — 게이트 면제. 면제도 결재 레코드다(FR-10) */
  @Post('approvals/bypass')
  bypass(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const { projectId, userId } = human(req);
    return this.approvals.bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: String(body['subject_id'] ?? ''),
      userId,
      reason: String(body['reason'] ?? ''),
    });
  }

  /** EP-QST-02 — 질문 답변. 사람 전용 */
  @Post('questions/:id/answer')
  answer(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { projectId, userId } = human(req);
    return this.questions.answer({
      projectId,
      questionId: id,
      userId,
      ...(typeof body['answer_key'] === 'string' ? { answerKey: body['answer_key'] } : {}),
      ...(typeof body['answer_md'] === 'string' ? { answerMd: body['answer_md'] } : {}),
    });
  }
}

/**
 * 사람 전용 문. `approval:decide` 는 토큰에 부여 자체가 불가능한 스코프라(api.md §1.3)
 * 에이전트는 여기 도달할 수 없어야 한다 — 도달하면 딥링크와 함께 되돌려 보낸다.
 */
function human(req: ProjectRequest): { projectId: string; userId: string } {
  const principal = req.nervPrincipal;
  const projectId = req.nervProjectId;
  if (principal === undefined || projectId === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 없습니다.', { kind: 'missing' });
  }
  if (principal.isAgent) {
    throw new NervError(NERV_ERROR.HUMAN_ONLY, '승인함 결정은 사람만 할 수 있습니다.', {
      kind: 'human_only',
      web_url: '/inbox',
    });
  }
  return { projectId, userId: principal.userId };
}
