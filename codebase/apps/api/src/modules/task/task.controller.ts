// REST — Task · 클레임 (docs/04-mvp/api.md §2.4)
//
// 표면은 번역만 한다(REQ-CB-003). 프로젝트 해소·멤버십은 가드가 끝내고 오고, 판정은 전부
// TaskService 한 곳에 있다 — 클레임 원자성·done 게이트가 REST 와 MCP 에서 갈라질 수 없는 이유다(D-05).

import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ClaimReleaseInput,
  HeartbeatInput,
  msg,
  NERV_ERROR,
  TaskClaimInput,
  TaskCreateInput,
  TaskTransitionInput,
  TaskUpdateInput,
} from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { parseBody } from '../../common/parse-body.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireRoleAndScope, RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { TaskService } from './task.service.js';
import type { ClaimActor } from './task.service.js';

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  /** EP-TASK-01 — S4 보드 */
  @RequireScope('spec:read')
  @Get('tasks')
  list(
    @Req() req: ProjectRequest,
    @Query('status') status?: string,
    @Query('assignee') assignee?: string,
    @Query('spec') spec?: string,
    @Query('include_archived') includeArchived?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<unknown> {
    return this.tasks.list({
      projectId: projectOf(req),
      statuses: status === undefined || status === '' ? null : status.split(','),
      assigneeUserId: assignee ?? null,
      specId: spec ?? null,
      // 기본은 **닫혀 있다** — 스펙 아카이브(REQ-API-022)와 같은 규약이다.
      includeArchived: includeArchived === 'true',
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  /** EP-TASK-02 */
  @RequireScope('task:claim')
  @Get('tasks/next')
  next(@Req() req: ProjectRequest, @Query('limit') limit?: string): Promise<unknown> {
    return this.tasks.next({
      projectId: projectOf(req),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  /** EP-TASK-04 */
  @RequireScope('spec:read')
  @Get('tasks/:task')
  get(@Req() req: ProjectRequest, @Param('task') task: string): Promise<unknown> {
    return this.tasks.get({ projectId: projectOf(req), taskKey: task });
  }

  /**
   * EP-TASK-03 — 생성은 언제나 backlog 다. ready 승격은 서버 판정(FR-05)
   *
   * MCP `nerv_task_create` 는 `task:update` 를 요구하는데 이 REST 자리는 역할만 봤다
   * (2026-09-04). **같은 작업의 권한이 경로마다 달랐다** — 토큰에서 스코프를 빼도
   * REST 로는 그대로 만들어졌다.
   */
  @RequireRoleAndScope(['planner', 'developer', 'admin', 'qa'], 'task:update')
  @Post('tasks')
  create(@Req() req: ProjectRequest, @Body() body: Record<string, unknown>): Promise<unknown> {
    const input = parseBody(TaskCreateInput, body);
    return this.tasks.create({
      projectId: projectOf(req),
      userId: principalOf(req).userId,
      title: input.title,
      bodyMd: input.body_md ?? null,
      sourceSpecVersionId: input.source_spec_version_id ?? null,
      baseline: input.baseline ?? null,
      sourceRequirementId: input.source_requirement_id ?? null,
      priority: input.priority ?? null,
      goalMd: input.goal_md ?? null,
      outputFormatMd: input.output_format_md ?? null,
      toolsSourcesMd: input.tools_sources_md ?? null,
      boundariesMd: input.boundaries_md ?? null,
    });
  }

  /** EP-TASK-05 — MCP `nerv_task_update` 와 같은 스코프를 요구한다(2026-09-04) */
  @RequireRoleAndScope(['planner', 'developer', 'admin'], 'task:update')
  @Patch('tasks/:task')
  update(
    @Req() req: ProjectRequest,
    @Param('task') task: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const input = parseBody(TaskUpdateInput, body);
    return this.tasks.update({
      projectId: projectOf(req),
      taskKey: task,
      userId: principalOf(req).userId,
      title: input.title ?? null,
      bodyMd: input.body_md ?? null,
      priority: input.priority ?? null,
      goalMd: input.goal_md ?? null,
      outputFormatMd: input.output_format_md ?? null,
      toolsSourcesMd: input.tools_sources_md ?? null,
      boundariesMd: input.boundaries_md ?? null,
      assigneeUserId: input.assignee_user_id ?? null,
      dependsOnKeys: input.depends_on ?? null,
    });
  }

  /** EP-TASK-09 — done 게이트 판정의 단일 지점(FR-10) */
  @RequireScope('task:update')
  @Post('tasks/:task/transition')
  transition(
    @Req() req: ProjectRequest,
    @Param('task') task: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const input = parseBody(TaskTransitionInput, body);
    return this.tasks.transition({
      roles: req.nervRoles ?? [],
      projectId: projectOf(req),
      taskId: task,
      status: input.status,
      userId: principalOf(req).userId,
      blockedReason: input.blocked_reason ?? null,
      specImpact: input.spec_impact ?? null,
      ...(input.evidence == null ? {} : { evidence: input.evidence }),
    });
  }

  /** EP-TASK-06 */
  @RequireScope('task:claim')
  @Post('tasks/:task/claim')
  claim(
    @Req() req: ProjectRequest,
    @Param('task') task: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const input = parseBody(TaskClaimInput, body);
    return this.tasks.claim({
      projectId: projectOf(req),
      taskId: task,
      userId: principalOf(req).userId,
      sessionId: input.session_id ?? null,
      // branch·worktree 는 클레임이 아니라 세션의 속성이다(agent_session) — 부트스트랩이 싣는다.
      scope: { specIds: input.scope.spec_ids, fileGlobs: input.scope.file_globs },
      ...(input.lease_seconds == null ? {} : { leaseSeconds: input.lease_seconds }),
    });
  }

  /** EP-TASK-07 */
  @RequireScope('task:update')
  @Post('claims/:claim/heartbeat')
  heartbeat(
    @Req() req: ProjectRequest,
    @Param('claim') claim: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    // 프로젝트 소속 확인은 가드가 끝냈다.
    projectOf(req);
    // **본문을 읽는다**(2026-09-05 · REQ-API-081). 여기 있던 `void body;` 가 전표의
    // `progress`·`stats`·`lease_seconds` 를 통째로 버렸다 — 서비스는 셋 다 받고 있었고
    // MCP 만 넘기고 있었다. 세션 카드의 +N −M 이 REST 경로에서만 비던 이유다.
    const input = parseBody(HeartbeatInput, body);
    return this.tasks.heartbeat({
      claimId: claim,
      actor: claimActor(req),
      progress: input.progress ?? null,
      stats:
        input.stats == null
          ? null
          : {
              ...(input.stats.added == null ? {} : { added: input.stats.added }),
              ...(input.stats.removed == null ? {} : { removed: input.stats.removed }),
              ...(input.stats.files == null ? {} : { files: input.stats.files }),
            },
      ...(input.lease_seconds == null ? {} : { leaseSeconds: input.lease_seconds }),
    });
  }

  /** EP-TASK-08 */
  @RequireScope('task:update')
  @Post('claims/:claim/release')
  release(
    @Req() req: ProjectRequest,
    @Param('claim') claim: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    projectOf(req);
    const release = parseBody(ClaimReleaseInput, body);
    return this.tasks.release({
      actor: claimActor(req),
      claimId: claim,
      userId: principalOf(req).userId,
      // **고른 값을 그대로 넘긴다**(2026-09-05 · REQ-API-107). 여기 있던 삼항식이
      // "셋 중 하나가 아니면 handoff" 로 **조용히 바꾸고** 있었다 — 보낸 쪽은 자기가
      // 고른 값이 들어갔다고 믿는다. 어휘 판정은 도메인 서비스 한 곳이다(D-05).
      reason: release.reason,
      // **인수인계 노트도 나른다**(2026-09-05 · REQ-API-081). 저장할 열까지 만들어 두고
      // MCP 만 배선했다 — REST 로 내려놓으면 노트는 남았다고 응답하면서 사라졌다.
      stateNote: release.state_note ?? null,
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

function principalOf(req: ProjectRequest): { userId: string } {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal;
}

/**
 * 클레임을 만지는 주체 — 표면은 "누가·어디서·무엇으로" 를 모아 넘기기만 한다(D-05).
 * REST 에는 에이전트 세션이 없다: 사람이 웹에서 부르는 경로이고, 그때의 보유 판정 축은
 * 클레임을 만든 사용자다.
 */
function claimActor(req: ProjectRequest): ClaimActor {
  return {
    projectId: projectOf(req),
    userId: principalOf(req).userId,
    sessionId: null,
    isAdmin: (req.nervRoles ?? []).includes('admin'),
  };
}
