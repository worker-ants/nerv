// MCP — nerv_question_create. 사람의 답변(EP-QST-02)은 REST 전용이다(api.md §4).
import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { requireSession } from '../session/session.tools.js';
import { QuestionService } from './question.service.js';

@Injectable()
export class QuestionTools implements NervToolProvider {
  constructor(private readonly questions: QuestionService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_question_create',
      tier: 'A2',
      phase: 'P1',
      summaryKey: 'mcp.tool.escalate',
      scope: 'task:update',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          urgency: { type: 'string', enum: ['blocking', 'normal'] },
          idempotency_key: { type: 'string' },
        },
        required: ['question'],
      },
      handler: async (input, ctx) =>
        this.questions.create({
          projectId: ctx.projectId,
          sessionId: requireSession(ctx),
          title: String(input['question'] ?? ''),
          options: Array.isArray(input['options']) ? (input['options'] as string[]) : [],
          urgency: input['urgency'] === 'normal' ? 'normal' : 'blocking',
          idempotencyKey: ctx.idempotencyKey,
        }),
    },
  ];
}
