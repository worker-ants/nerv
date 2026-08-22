// 질문 생성 · 폴링 · awaiting_input 전이
// 정본: docs/03-proposal/agent-integration.md §2.3·§5.3
// 멱등 재호출이 곧 폴링 규약이다(MCP 표면 정의).
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class QuestionService {
  create(): never {
    throw new NotImplementedYetError('E13-S02', '질문 에스컬레이션');
  }

  answer(): never {
    throw new NotImplementedYetError('E13-S02', '질문 답변(하트비트 역채널 적재 포함)');
  }
}
