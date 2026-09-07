// MCP — nerv_task_* 5종. REST 컨트롤러와 같은 TaskService 인스턴스를 쓴다(D-05).
// 클레임 엔진은 E04 에서 구현됐고 L2 가 지킨다 — 여기는 번역만 한다(REQ-CB-003).

import { Injectable } from '@nestjs/common';
import { BLOCKED_REASONS, LEASE_TTL_SECONDS, TASK_TRANSITION_TARGETS } from '@nerv/schema';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { wrapText } from '../../mcp/untrusted.js';
import { requireSession } from '../session/session.tools.js';
import { TaskService } from './task.service.js';
import type { ClaimActor } from './task.service.js';
import type { ToolContext } from '../../mcp/tool-context.js';

@Injectable()
export class TaskTools implements NervToolProvider {
  constructor(private readonly tasks: TaskService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_task_next',
      tier: 'A1',
      phase: 'P0',
      summaryKey: 'mcp.tool.before_claim',
      scope: 'task:claim',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      },
      handler: async (input, ctx) => ({
        candidates: await this.tasks.next({
          projectId: ctx.projectId,
          ...(typeof input['limit'] === 'number' ? { limit: input['limit'] } : {}),
        }),
        next_actions: ['nerv_task_claim'],
      }),
    },
    {
      // **읽을 길이 없었다**(사람 보고 2026-08-30). `nerv_task_next` 는 "지금 클레임할 수
      // 있는 후보"만 주므로, 이미 진행 중인 Task 를 펼쳐 읽거나 위임 명세 4요소를 확인할
      // 방법이 에이전트에게 없었다 — REST 에는 처음부터 있었다(§4 대응표).
      name: 'nerv_task_get',
      tier: 'A1',
      phase: 'P1',
      summaryKey: 'mcp.tool.before_claim',
      // 읽기지만 클레임 축의 읽기다 — `nerv_task_next` 와 같은 권한을 쓴다
      scope: 'task:claim',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          task_id: { type: 'string', description: 'task key (CLV-T-…) or UUID' },
        },
        required: ['task_id'],
      },
      handler: async (input, ctx) =>
        this.tasks.get({ projectId: ctx.projectId, taskKey: String(input['task_id'] ?? '') }),
    },
    {
      // **훑을 길도 없었다**(2026-08-30 사람 요청). `nerv_task_next` 는 "지금 클레임할 수
      // 있는 것"만, `nerv_task_get` 은 "이미 아는 하나"만 준다 — 그래서 "이 프로젝트에
      // 지금 무엇이 도는가" 를 물을 수 없었다. 그건 클레임 전에 하는 물음이고,
      // 사람에게 보고할 때 필요한 물음이다.
      name: 'nerv_task_list',
      tier: 'A1',
      phase: 'P1',
      summaryKey: 'mcp.tool.before_claim',
      scope: 'task:claim',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          // 배열이 아니라 쉼표 목록이다 — REST 질의와 같은 모양이라 사람이 옮겨 적기 쉽다
          status: { type: 'string', description: 'mcp.arg.task_status_filter' },
          assignee: { type: 'string', description: 'user UUID' },
          spec: { type: 'string', description: 'spec key (e.g. SUD-DSN-UI) or UUID' },
          // 기본은 **닫혀 있다** — 보관한 것까지 함께 오면 목록이 목록이기를 그만둔다
          include_archived: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string', description: 'mcp.arg.cursor' },
        },
      },
      handler: async (input, ctx) => {
        const status = typeof input['status'] === 'string' ? input['status'] : '';
        return this.tasks.list({
          projectId: ctx.projectId,
          statuses: status === '' ? null : status.split(',').map((v) => v.trim()),
          assigneeUserId: typeof input['assignee'] === 'string' ? input['assignee'] : null,
          specId: typeof input['spec'] === 'string' ? input['spec'] : null,
          includeArchived: input['include_archived'] === true,
          ...(typeof input['limit'] === 'number' ? { limit: input['limit'] } : {}),
          ...(typeof input['cursor'] === 'string' ? { cursor: input['cursor'] } : {}),
        });
      },
    },
    {
      // **만들 길도 없었다.** Task 는 임포터와 웹만 만들 수 있었고, 그래서 에이전트가
      // "이건 이번 작업 밖의 별도 건이다" 를 남길 방법이 질문밖에 없었다 —
      // 별도 작업이 질문 카드로 흘러가거나 그냥 잊혔다.
      name: 'nerv_task_create',
      tier: 'A2',
      phase: 'P1',
      summaryKey: 'mcp.tool.on_transition',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          title: { type: 'string' },
          body_md: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          // **위임 명세 4요소**(D-09). 넷이 다 차야 서버가 `ready` 로 올린다 —
          // 만들자마자 누가 집어 갈 수 있는 상태가 되는 것이 아니라는 뜻이다.
          goal_md: { type: 'string', description: 'mcp.arg.goal_md' },
          output_format_md: { type: 'string', description: 'mcp.arg.output_format_md' },
          tools_sources_md: { type: 'string', description: 'mcp.arg.tools_sources_md' },
          boundaries_md: { type: 'string', description: 'mcp.arg.boundaries_md' },
          source_spec_version_id: { type: 'string' },
          // 주변 문서까지 포함한 기준 세트 — 문서 하나의 핀만으로는 그것이 참조하는
          // 문서들의 기준이 흔들린다(spec-workflow §4.1)
          baseline: { type: 'string', description: 'mcp.arg.baseline' },
          source_requirement_id: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
        required: ['title'],
      },
      handler: async (input, ctx) =>
        this.tasks.create({
          projectId: ctx.projectId,
          userId: ctx.principal.userId,
          title: String(input['title'] ?? ''),
          ...pick(input, {
            body_md: 'bodyMd',
            priority: 'priority',
            goal_md: 'goalMd',
            output_format_md: 'outputFormatMd',
            tools_sources_md: 'toolsSourcesMd',
            boundaries_md: 'boundariesMd',
            source_spec_version_id: 'sourceSpecVersionId',
            baseline: 'baseline',
            source_requirement_id: 'sourceRequirementId',
          }),
        }),
    },
    {
      name: 'nerv_task_claim',
      tier: 'A2',
      phase: 'P0',
      summaryKey: 'mcp.tool.start_work',
      scope: 'task:claim',
      inputSchema: {
        type: 'object',
        properties: {
          // 키·UUID 둘 다 받는다(§1.4b). 화면과 로그가 쓰는 것은 키다
          task_id: { type: 'string', description: 'task key (CLV-T-…) or UUID' },
          scope: {
            type: 'object',
            description: 'mcp.arg.scope',
            properties: {
              spec_ids: {
                type: 'array',
                items: { type: 'string', description: 'spec key (e.g. SUD-DSN-UI) or UUID' },
              },
              file_globs: { type: 'array', items: { type: 'string' } },
            },
          },
          lease_seconds: {
            type: 'integer',
            minimum: 1,
            maximum: LEASE_TTL_SECONDS,
            description: 'mcp.arg.lease_seconds',
          },
          session_id: { type: 'string', description: 'mcp.arg.session_id' },
          idempotency_key: { type: 'string' },
        },
        required: ['task_id'],
      },
      handler: async (input, ctx) => {
        const scope = (input['scope'] ?? {}) as { spec_ids?: string[]; file_globs?: string[] };
        const result = await this.tasks.claim({
          projectId: ctx.projectId,
          taskId: String(input['task_id']),
          sessionId: requireSession(ctx),
          userId: ctx.principal.userId,
          scope: { specIds: scope.spec_ids ?? [], fileGlobs: scope.file_globs ?? [] },
          ...(typeof input['lease_seconds'] === 'number'
            ? { leaseSeconds: input['lease_seconds'] }
            : {}),
        });
        return {
          claim_id: result.claimId,
          lease_expires_at: result.leaseExpiresAt.toISOString(),
          warnings: result.warnings,
          replayed: result.replayed,
          next_actions: ['nerv_task_heartbeat'],
        };
      },
    },
    {
      name: 'nerv_task_heartbeat',
      tier: 'A1',
      phase: 'P0',
      summaryKey: 'mcp.tool.every_60s',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          claim_id: { type: 'string' },
          progress: { type: 'string' },
          // 카탈로그(3.4 §2.3)가 처음부터 적고 있던 셋 — 스키마에도 없어 조용히 버려졌다
          stats: { type: 'object' },
          lease_seconds: {
            type: 'integer',
            minimum: 1,
            maximum: LEASE_TTL_SECONDS,
            description: 'mcp.arg.lease_seconds',
          },
        },
        required: ['claim_id'],
      },
      handler: async (input, ctx) => {
        const beat = await this.tasks.heartbeat({
          claimId: String(input['claim_id']),
          actor: claimActor(ctx),
          progress: str(input['progress']),
          stats: (input['stats'] as { added?: number } | undefined) ?? null,
          ...(typeof input['lease_seconds'] === 'number'
            ? { leaseSeconds: input['lease_seconds'] }
            : {}),
        });
        // 답변은 하트비트 역채널로도 온다 — 한 경로만 감싸면 반대 경로가 구멍이다(REQ-API-153).
        // **사람의 지시(`instructions`)와 리뷰 코멘트는 감싸지 않는다**: 그것은 따라야 할
        // 것이고, 따라야 할 것을 "데이터일 뿐" 이라고 표시하면 경계가 반대로 쓰인다.
        return wrapPendingAnswers(TaskService.toHeartbeatResult(beat));
      },
    },
    {
      name: 'nerv_task_release',
      tier: 'A2',
      phase: 'P0',
      summaryKey: 'mcp.tool.session_end',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          claim_id: { type: 'string' },
          reason: { type: 'string', enum: ['done', 'handoff', 'abandon'] },
          // 인수인계 노트 — 다음 사람이 "왜 내려놨나" 에 답을 얻는 자리다(REQ-API-081)
          state_note: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
        required: ['claim_id', 'reason'],
      },
      handler: async (input, ctx) =>
        this.tasks.release({
          claimId: String(input['claim_id']),
          reason: String(input['reason'] ?? ''),
          userId: ctx.principal.userId,
          stateNote: str(input['state_note']),
          actor: claimActor(ctx),
        }),
    },
    {
      name: 'nerv_task_update',
      tier: 'A2',
      phase: 'P1',
      summaryKey: 'mcp.tool.on_transition',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'task key (CLV-T-…) or UUID' },
          // **허용값을 적는다.** 열거가 없으면 에이전트는 상태 이름을 지어내고, 그 실패는
          // "전이 불가" 로 보여 스펙 문제처럼 읽힌다(2026-08-30 사람 보고)
          // **`claimed` 는 여기 없다**(2026-09-07 · REQ-API-132) — 그 상태는 `nerv_task_claim`
          // 만이 만든다. 스키마는 모델이 읽는 계약이라, 목표값으로 노출되어 있는 동안은
          // 클레임 행 없는 `claimed` 를 만드는 길이 열려 있는 것과 같다.
          status: {
            type: 'string',
            description: 'mcp.arg.status',
            enum: [...TASK_TRANSITION_TARGETS],
          },
          // **핸들러는 처음부터 이 셋을 읽고 있었는데 스키마에 없었다** — `nerv_question_create`
          // 와 같은 결함이다. 도구는 스키마를 읽으므로, 적지 않은 입력은 실리지 않는다.
          // done 게이트가 증적을 요구하는데 증적을 실을 길이 없던 것이 그 결과다.
          evidence: {
            type: 'array',
            description: 'mcp.arg.evidence',
            items: {
              type: 'object',
              required: ['kind', 'locator'],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['code_path', 'test', 'pr', 'commit', 'review', 'user_guide'],
                },
                locator: { type: 'string' },
              },
            },
          },
          blocked_reason: {
            type: 'string',
            // **어휘를 스키마에 싣는다.** 적지 않으면 모델이 자연어 문장을 넣고, 그것은
            // 도메인에서 거절되거나(지금) 저장돼 필터를 망친다(2026-09-06 이전).
            enum: [...BLOCKED_REASONS],
            description: 'mcp.arg.blocked_reason',
          },
          // **모양을 적는다.** done 게이트는 "비어 있지 않은 객체"만 보는데, 그것만으로는
          // 무엇을 넣어야 할지 알 수 없다 — 열쇠 이름을 적어야 계약이 된다.
          spec_impact: {
            type: 'object',
            description: 'mcp.arg.spec_impact',
            properties: {
              changed: { type: 'array', items: { type: 'string' }, description: 'spec keys' },
              none: { type: 'boolean', description: 'no spec was affected' },
            },
          },
          idempotency_key: { type: 'string' },
        },
        required: ['task_id', 'status'],
      },
      handler: async (input, ctx) =>
        this.tasks.transition({
          roles: ctx.principal.roles,
          projectId: ctx.projectId,
          taskId: String(input['task_id'] ?? ''),
          status: String(input['status'] ?? ''),
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
          specImpact: (input['spec_impact'] as Record<string, unknown> | undefined) ?? null,
          ...(typeof input['blocked_reason'] === 'string'
            ? { blockedReason: input['blocked_reason'] }
            : {}),
          ...(Array.isArray(input['evidence'])
            ? { evidence: input['evidence'] as { kind: string; locator: string }[] }
            : {}),
        }),
    },
  ];
}

/** 준 것만 넘긴다 — 안 준 값을 `null` 로 바꾸면 "지워라" 가 된다 */
function pick(
  input: Record<string, unknown>,
  names: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(names)) {
    if (typeof input[from] === 'string' && input[from] !== '') out[to] = input[from];
  }
  return out;
}

/**
 * 도구 호출의 주체 — 에이전트는 **세션이 축이다**(그 세션이 클레임을 쥔다).
 * 세션을 못 좁혔으면 null 이고, 그때는 사용자 축으로만 판정된다.
 */
function claimActor(ctx: ToolContext): ClaimActor {
  return {
    projectId: ctx.projectId,
    userId: ctx.principal.userId,
    sessionId: ctx.sessionId,
    // 에이전트 토큰에 admin 해제 권한을 주지 않는다 — 전표의 admin 은 사람이다
    isAdmin: false,
  };
}

/** 빈 문자열은 값이 아니다 — 지우려는 것과 말하지 않은 것을 같게 두지 않는다. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 하트비트 `pending[]` 중 답변 본문만 비신뢰 경계로 감싼다(REQ-API-153) */
function wrapPendingAnswers<T extends { pending: unknown[] }>(result: T): T {
  return {
    ...result,
    pending: result.pending.map((item) => {
      if (typeof item !== 'object' || item === null) return item;
      const row = item as Record<string, unknown>;
      if (typeof row['answer_md'] !== 'string') return row;
      return {
        ...row,
        answer_md: wrapText('answer', row['answer_md'], {
          question_id: typeof row['question_id'] === 'string' ? row['question_id'] : null,
        }),
      };
    }),
  };
}
