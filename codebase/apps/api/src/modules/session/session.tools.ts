// MCP — nerv_bootstrap · nerv_session_event.
// nerv_session_event 는 훅 ingest 와 같은 SessionService.appendActivity 를 쓴다(api.md §4).
import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { SessionService } from './session.service.js';

@Injectable()
export class SessionTools implements NervToolProvider {
  constructor(private readonly sessions: SessionService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_bootstrap',
      tier: 'A1',
      phase: 'P0',
      summary: '세션 시작 직후 첫 도구 호출',
      handler: async () => this.sessions.bootstrap(),
    },
    {
      name: 'nerv_session_event',
      tier: 'A1',
      phase: 'P1',
      summary: '훅 없는 실행 환경의 폴백',
      handler: async () => this.sessions.appendActivity(),
    },
  ];
}
