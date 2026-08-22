// MCP — nerv_task_* 5종. REST 컨트롤러와 같은 TaskService 인스턴스를 쓴다(D-05).
// 클레임 엔진은 E04 에서 구현됐고 L2 가 지킨다 — 여기는 번역만 한다(REQ-CB-003).

import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { requireSession } from '../session/session.tools.js';
import { TaskService } from './task.service.js';

@Injectable()
export class TaskTools implements NervToolProvider {
  constructor(private readonly tasks: TaskService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_task_next',
      tier: 'A1',
      phase: 'P0',
      summary: '클레임 직전',
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
      name: 'nerv_task_claim',
      tier: 'A2',
      phase: 'P0',
      summary: '작업 착수',
      scope: 'task:claim',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          scope: {
            type: 'object',
            description: '이 작업이 건드릴 스펙·파일. 겹침 판정의 입력이다',
            properties: {
              spec_ids: { type: 'array', items: { type: 'string' } },
              file_globs: { type: 'array', items: { type: 'string' } },
            },
          },
          lease_seconds: { type: 'integer' },
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
      summary: '60초 주기',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: { claim_id: { type: 'string' }, progress: { type: 'string' } },
        required: ['claim_id'],
      },
      handler: async (input) => {
        const beat = await this.tasks.heartbeat({ claimId: String(input['claim_id']) });
        return {
          lease_expires_at: beat.leaseExpiresAt.toISOString(),
          // 서버 → 세션 방향의 유일한 보장된 채널이다(agent-integration §2.4)
          pending: beat.pending,
        };
      },
    },
    {
      name: 'nerv_task_release',
      tier: 'A2',
      phase: 'P0',
      summary: '세션 종료·작업 전환·중단',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          claim_id: { type: 'string' },
          reason: { type: 'string', enum: ['done', 'handoff', 'abandon'] },
          idempotency_key: { type: 'string' },
        },
        required: ['claim_id', 'reason'],
      },
      handler: async (input, ctx) =>
        this.tasks.release({
          claimId: String(input['claim_id']),
          reason: input['reason'] as 'done' | 'handoff' | 'abandon',
          userId: ctx.principal.userId,
        }),
    },
    {
      name: 'nerv_task_update',
      tier: 'A2',
      phase: 'P1',
      summary: '상태 변화 시점(done 시도는 서버 게이트)',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
        required: ['task_id', 'status'],
      },
      handler: async () => {
        throw new NotImplementedYetError('E09-S05', 'Task 전이·done 게이트');
      },
    },
  ];
}
