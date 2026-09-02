// MCP — nerv_question_create. 사람의 답변(EP-QST-02)은 REST 전용이다(api.md §4).
import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { requireSession } from '../session/session.tools.js';
import { QuestionService } from './question.service.js';

/**
 * `blocking` 과 `urgency` 는 **같은 축이다**(data-model §2.7 — 질문의 열은 `urgency` 하나다).
 * 스킬과 spec-workflow §4.7 의 예시가 `blocking: true` 로 부르므로 둘 다 받되, 명시된
 * `urgency` 가 이긴다 — 더 구체적인 말이 이기는 것이 덜 놀랍다.
 *
 * 기본은 `blocking` 이다: 사람을 부르고도 그냥 진행하는 것은 에스컬레이션이 아니다.
 */
function urgencyOf(input: Record<string, unknown>): 'blocking' | 'normal' {
  if (input['urgency'] === 'normal') return 'normal';
  if (input['urgency'] === 'blocking') return 'blocking';
  return input['blocking'] === false ? 'normal' : 'blocking';
}

@Injectable()
export class QuestionTools implements NervToolProvider {
  constructor(private readonly questions: QuestionService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_question_create',
      tier: 'A2',
      // 같은 키의 재호출이 **폴링**이다(§5.3) — 공용 멱등 저장소가 최초 응답을 재생하면
      // 그 폴링은 답이 달린 뒤에도 영원히 `open` 을 받는다.
      selfIdempotent: true,
      phase: 'P1',
      summaryKey: 'mcp.tool.escalate',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          // **출처를 단다** — 사람은 에이전트의 요약이 아니라 원문을 보고 판단한다
          context: {
            type: 'object',
            description: 'mcp.arg.question_context',
            properties: {
              spec_id: { type: 'string', description: 'spec key (SPC-…) or UUID' },
              task_id: { type: 'string', description: 'task key (CLV-T-…) or UUID' },
              finding_id: { type: 'string', description: 'finding UUID' },
            },
          },
          escalate: {
            type: 'string',
            description: 'mcp.arg.escalate',
            enum: ['spec', 'user-decision', 'infra', 'e2e-fail-3x', 'sensitive-fix'],
          },
          urgency: { type: 'string', enum: ['blocking', 'normal'] },
          blocking: { type: 'boolean', description: 'mcp.arg.blocking' },
          wait_seconds: { type: 'integer', description: 'mcp.arg.wait_seconds' },
          session_id: { type: 'string', description: 'mcp.arg.session_id' },
          idempotency_key: { type: 'string' },
        },
        required: ['question'],
      },
      handler: async (input, ctx) => {
        const context = (input['context'] ?? {}) as {
          spec_id?: string;
          task_id?: string;
          finding_id?: string;
        };
        return this.questions.create({
          projectId: ctx.projectId,
          sessionId: requireSession(ctx),
          title: String(input['question'] ?? ''),
          options: Array.isArray(input['options']) ? (input['options'] as string[]) : [],
          urgency: urgencyOf(input),
          taskId: context.task_id ?? null,
          specId: context.spec_id ?? null,
          findingId: context.finding_id ?? null,
          escalate: typeof input['escalate'] === 'string' ? input['escalate'] : null,
          ...(typeof input['wait_seconds'] === 'number'
            ? { waitSeconds: input['wait_seconds'] }
            : {}),
          idempotencyKey: ctx.idempotencyKey,
        });
      },
    },
  ];
}
