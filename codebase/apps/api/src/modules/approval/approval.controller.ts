// REST — 승인함 · 질문 (docs/04-mvp/api.md §2.6)
import { Controller, Get, Post } from '@nestjs/common';
import { ApprovalService } from './approval.service.js';
import { QuestionService } from './question.service.js';

@Controller('api/v1')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly questions: QuestionService,
  ) {}

  /** EP-APR-01 — 승인함은 조직 전역 하나다(FR-14) */
  @Get('inbox')
  inbox(): never {
    return this.approvals.request();
  }

  /** EP-APR-03 — 사람 전용 */
  @Post('approvals/:id/decide')
  decide(): never {
    return this.approvals.decide();
  }

  /** EP-QST-02 */
  @Post('questions/:id/answer')
  answer(): never {
    return this.questions.answer();
  }
}
