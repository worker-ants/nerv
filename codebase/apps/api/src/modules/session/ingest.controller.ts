// 훅 수집기 — POST /ingest/hooks/{session,tool,subagent,stop,session-end}
// 정본: docs/03-proposal/agent-integration.md §3.3 · docs/04-mvp/api.md §2.9
//
// ingest 는 별도 프로세스가 아니라 컨트롤러다(codebase.md §2.2). 모듈 경계가 분리돼 있어
// 훅 볼륨이 API 지연에 영향을 주는 시점에 같은 이미지의 별도 Deployment 로 뗄 수 있다.
// 인증은 PAT Bearer — 토큰 없는 이벤트는 버린다. 202 즉시 응답 후 적재하며,
// Stop 훅만 동기 판정 경로다. 배선은 E12-S02 소관이다.

import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { SessionService } from './session.service.js';

@Controller('ingest/hooks')
export class IngestController {
  // 표면은 번역만 — 세션 상태 관리는 SessionService 한 곳이 한다(D-05).
  constructor(private readonly sessions: SessionService) {}

  @Post('session')
  @HttpCode(HttpStatus.ACCEPTED)
  session(): never {
    throw new NotImplementedYetError('E12-S02', 'SessionStart 훅 수집');
  }

  @Post('tool')
  @HttpCode(HttpStatus.ACCEPTED)
  tool(): never {
    throw new NotImplementedYetError('E12-S02', 'PostToolUse 훅 수집');
  }

  @Post('subagent')
  @HttpCode(HttpStatus.ACCEPTED)
  subagent(): never {
    throw new NotImplementedYetError('E12-S02', 'SubagentStart/Stop 훅 수집');
  }

  /** Stop 훅만 동기 판정 경로다(architecture §1.3) — 202 가 아니다 */
  @Post('stop')
  stop(): never {
    throw new NotImplementedYetError('E12-S02', 'Stop 훅 동기 판정');
  }

  @Post('session-end')
  @HttpCode(HttpStatus.ACCEPTED)
  sessionEnd(): never {
    throw new NotImplementedYetError('E12-S02', 'SessionEnd 훅 수집');
  }
}
