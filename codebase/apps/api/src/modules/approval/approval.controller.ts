// REST — 받은 요청 · 결정 · 질문 답변 (api.md §2.6)
//
// 이 표면이 Phase 1 종료 게이트의 대상이다: 파일럿 2주간 **플랫폼 밖에서 처리된 승인 0건**.
// 그러려면 승인이 여기서 되는 것만으로는 부족하고, 여기서 **되어야만** 해야 한다 —
// 그래서 결정은 사람 전용이고 에이전트는 도구로도 도달할 수 없다.

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApprovalDecisionInput,
  GateBypassInput,
  msg,
  NERV_ERROR,
  QuestionAnswerInput,
} from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { parseBody } from '../../common/parse-body.js';
import type { Actor } from '../../common/human-only.js';
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

  /**
   * 프로젝트 소속 받은 요청 — S2·S4 의 사이드 패널용. 전역 받은 요청은 EP-APR-01 이다.
   * **사람 전용이고 판정은 서비스에 있다**(REQ-API-123).
   */
  @RequireScope('spec:read')
  @Get('inbox')
  inbox(@Req() req: ProjectRequest): Promise<InboxCard[]> {
    const { projectId, userId, actor } = human(req);
    return this.approvals.inbox({ projectId, userId, actor });
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

  /**
   * EP-APR-04 — 게이트 면제. 면제도 결재 레코드다(FR-10).
   * **사람 전용이고 판정은 서비스에 있다**(REQ-API-123 — 역할 문턱은 PAT 도 지난다).
   */
  @RequireRole('admin', 'planner', 'developer')
  @Post('gates/bypass')
  bypass(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const { projectId, userId, actor } = human(req);
    const bypass = parseBody(GateBypassInput, body);
    return this.approvals.bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: bypass.subject_id,
      userId,
      reason: bypass.reason,
      actor,
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

  /** EP-QST-02 — 질문 답변. **사람 전용이고 판정은 서비스에 있다**(REQ-API-123) */
  @RequireScope('spec:read')
  @Post('questions/:id/answer')
  answer(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { projectId, userId, actor } = human(req);
    const answer = parseBody(QuestionAnswerInput, body);
    return this.questions.answer({
      projectId,
      questionId: id,
      userId,
      actor,
      ...(answer.answer_key == null ? {} : { answerKey: answer.answer_key }),
      ...(answer.answer_md == null ? {} : { answerMd: answer.answer_md }),
    });
  }
}

/**
 * **전역 경로의 주체** — 경로에 프로젝트가 없다(`/api/v1/inbox`).
 *
 * `human()` 과 나뉜 이유가 이것이다: 그쪽은 프로젝트 경로용이라 `nervProjectId` 를
 * 요구하고, 전역 승인함에는 그 값이 없다. 하나로 합치면 전역 라우트가 401 이 된다.
 */
function globalActor(req: ProjectRequest): Actor {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return { userId: principal.userId, isAgent: principal.isAgent };
}

/**
 * 프로젝트 경로의 주체 — 게이트는 여기 없다(D-05 · REQ-API-111).
 *
 * 예전 이름은 `human()` 이었고 이 자리에서 에이전트를 막았다. 막는 것은 도메인의 몫이라
 * 옮겼고, 남은 일은 요청에서 **누가·어느 프로젝트인가**를 읽는 번역뿐이다.
 */
function human(req: ProjectRequest): { projectId: string; userId: string; actor: Actor } {
  const principal = req.nervPrincipal;
  const projectId = req.nervProjectId;
  if (principal === undefined || projectId === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return {
    projectId,
    userId: principal.userId,
    actor: { userId: principal.userId, isAgent: principal.isAgent },
  };
}

/**
 * 전역 받은 요청 — EP-APR-01·02·03. 경로에 프로젝트가 없다.
 *
 * **사람의 하루는 프로젝트로 나뉘어 있지 않다.** 승인이 프로젝트별로 흩어져 있으면
 * "내가 지금 막고 있는 것"을 세는 곳이 없어지고, 그 순간 승인은 조용히 늦어진다(P4).
 * 그래서 이 표면이 받은 요청의 정본이고, 프로젝트 소속 inbox 는 화면 안의 부분 뷰다.
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
    const actor = globalActor(req);
    const userId = actor.userId;
    return this.approvals.inboxGlobal({
      actor,
      userId,
      state: state === 'decided' ? 'decided' : 'pending',
      projectSlug: project ?? null,
    });
  }

  /** EP-APR-02 */
  @Get(':id')
  detail(@Req() req: ProjectRequest, @Param('id') id: string): Promise<unknown> {
    const actor = globalActor(req);
    return this.approvals.detail({ approvalId: id, userId: actor.userId, actor });
  }

  /** EP-APR-03 — 결정. **사람 전용**이고, 지시자≠승인자 판정은 서비스 안에 있다 */
  @Post(':id/decision')
  async decide(
    @Req() req: ProjectRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const actor = globalActor(req);
    const userId = actor.userId;
    // 전역 경로라 프로젝트를 승인 행에서 되찾는다 — 멤버십 검사는 detail 이 이미 한다.
    await this.approvals.detail({ approvalId: id, userId, actor });
    const projectId = await this.approvals.projectOfApproval(id);
    const input = parseBody(ApprovalDecisionInput, body);
    return this.approvals.decide({
      actor,
      projectId,
      approvalId: id,
      userId,
      decision: input.decision as ApprovalDecision,
      ...(input.comment == null ? {} : { comment: input.comment }),
      ...(input.seen_content_hash == null ? {} : { seenContentHash: input.seen_content_hash }),
    });
  }
}
