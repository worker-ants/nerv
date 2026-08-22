// MCP — nerv_question_create. 사람의 답변(EP-QST-02)은 REST 전용이다(api.md §4).
import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { QuestionService } from './question.service.js';

@Injectable()
export class QuestionTools implements NervToolProvider {
  constructor(private readonly questions: QuestionService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_question_create',
      tier: 'A2',
      phase: 'P1',
      summary: '판단 불가·경계 이탈·게이트 필요',
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
      handler: async () => this.questions.create(),
    },
  ];
}
