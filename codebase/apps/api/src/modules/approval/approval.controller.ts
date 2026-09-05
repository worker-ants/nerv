// REST — 받은 요청 · 결정 · 질문 답변 (api.md §2.6)
//
// 이 표면이 Phase 1 종료 게이트의 대상이다: 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건**.
// 그러려면 승인이 여기서 되는 것만으로는 부족하고, 여기서 **되어야만** 해야 한다 —
// 그래서 결정은 사람 전용이고 에이전트는 도구로도 도달할 수 없다.

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireRole, RequireScope } from '../../common/route-permission.js';
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

  /** 프로젝트 스코프 받은 요청 — S2·S4 의 사이드 패널용. 전역 받은 요청은 EP-APR-01 이다 */
  @RequireScope('spec:read')
  @Get('inbox')
  inbox(@Req() req: ProjectRequest): Promise<InboxCard[]> {
    const { projectId, userId } = human(req);
    return this.approvals.inbox({ projectId, userId });
  }

  /** EP-QST-01 — 열린 질문 목록 */
  @RequireScope('spec:read')
  @Get('questions')
  questionList(@Req() req: ProjectRequest, @Query('status') status?: string): Promise<unknown> {
    const { projectId } = human(req);
    return this.approvals.questions({
      projectId,
      status: status === 'answered' ? 'answered' : 'open',
    });
  }

  /** EP-APR-04 — 게이트 면제. 면제도 결재 레코드다(FR-10) */
  @RequireRole('admin', 'planner', 'developer')
  @Post('gates/bypass')
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

  /**
   * EP-QST-03 — 질문 취소. **사람 전용이 아니다**(2026-09-05 · REQ-API-109).
   *
   * 사람이 "물을 일이 아니었다" 고 내리거나, **만든 세션이 스스로 답을 찾아** 거둔다.
   * 후자를 막으면 답이 필요 없어진 질문이 수신함에 남고 사람이 그것을 처리해야 한다.
   * 누가 부를 수 있는지의 판정은 도메인 서비스에 있다(D-05).
   */
  @RequireScope('task:update')
  @Post('questions/:id/cancel')
  cancel(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    const principal = req.nervPrincipal;
    if (principal === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    return this.questions.cancel({
      projectId: req.nervProjectId ?? '',
      questionId: id,
      userId: principal.userId,
      isAgent: principal.isAgent,
    });
  }

  /** EP-QST-02 — 질문 답변. 사람 전용 */
  @RequireScope('spec:read')
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
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  if (principal.isAgent) {
    throw new NervError(NERV_ERROR.HUMAN_ONLY, msg('error.human_only.inbox_decide'), {
      kind: 'human_only',
      web_url: '/inbox',
    });
  }
  return { projectId, userId: principal.userId };
}

/**
 * 전역 받은 요청 — EP-APR-01·02·03. 경로에 프로젝트가 없다.
 *
 * **사람의 하루는 프로젝트로 나뉘어 있지 않다.** 승인이 프로젝트별로 흩어져 있으면
 * "내가 지금 막고 있는 것"을 세는 곳이 없어지고, 그 순간 승인은 조용히 늦어진다(P4).
 * 그래서 이 표면이 받은 요청의 정본이고, 프로젝트 스코프 inbox 는 화면 안의 부분 뷰다.
 */
@Controller('api/v1/approvals')
export class ApprovalInboxController {
  constructor(private readonly approvals: ApprovalService) {}

  /** EP-APR-01 */
  @Get()
  list(
    @Req() req: ProjectRequest,
    @Query('state') state?: string,
    @Query('project') project?: string,
  ): Promise<unknown> {
    return this.approvals.inboxGlobal({
      userId: humanUser(req),
      state: state === 'decided' ? 'decided' : 'pending',
      projectSlug: project ?? null,
    });
  }

  /** EP-APR-02 */
  @Get(':id')
  detail(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    return this.approvals.detail({ approvalId: id, userId: humanUser(req) });
  }

  /** EP-APR-03 — 결정. **사람 전용**이고, 지시자≠승인자 판정은 서비스 안에 있다 */
  @Post(':id/decision')
  async decide(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const userId = humanUser(req);
    // 전역 경로라 프로젝트를 승인 행에서 되찾는다 — 멤버십 검사는 detail 이 이미 한다.
    await this.approvals.detail({ approvalId: id, userId });
    const projectId = await this.approvals.projectOfApproval(id);
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
}

function humanUser(req: ProjectRequest): string {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  if (principal.isAgent) {
    throw new NervError(NERV_ERROR.HUMAN_ONLY, msg('error.human_only.inbox'), {
      kind: 'human_only',
      web_url: '/inbox',
    });
  }
  return principal.userId;
}
