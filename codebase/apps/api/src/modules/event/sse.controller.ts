// SSE 스트림 — GET /sse/projects/{proj} · GET /sse/me (계약 정본 docs/04-mvp/api.md §3.5)
//
// 브라우저 밖 소비자(CLI·외부 도구)용 단방향 채널이다. replay 없음(Last-Event-ID 무시, D-14),
// keep-alive 25초 코멘트 라인, 사용자당 동시 연결 8개. 프록시 버퍼링 해제는 REQ-CB-014.
// 스트림 배선은 E05-S02 소관이다.

import { Controller, Param, Sse } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from './event.service.js';

@Controller('sse')
export class SseController {
  constructor(private readonly events: EventService) {}

  /** EP-SSE-01 — project:{id} 룸과 동일한 이벤트 흐름 */
  @Sse('projects/:proj')
  project(@Param('proj') _proj: string): never {
    throw new NotImplementedYetError('E05-S02', 'SSE 프로젝트 스트림');
  }

  /** EP-SSE-02 — user:{id} 룸과 동일한 이벤트 흐름 */
  @Sse('me')
  me(): never {
    throw new NotImplementedYetError('E05-S02', 'SSE 개인 스트림');
  }
}
