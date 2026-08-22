// Activity 적재·조회 — 세션 타임라인 (codebase.md §2.2)
//
// 적재 경로(훅 ingest · nerv_session_event)와 조회 경로(S5 타임라인)가 **같은 구현**을 쓰도록
// SessionService 에 위임한다. 여기에 두 번째 구현을 두면 seq 멱등 규칙이 두 벌이 되고,
// 그 순간 훅 재전송이 타임라인을 중복으로 채운다.
import { Injectable } from '@nestjs/common';
import { SessionService } from './session.service.js';

@Injectable()
export class ActivityService {
  constructor(private readonly sessions: SessionService) {}

  append(input: {
    sessionId: string;
    projectId: string;
    seq: bigint;
    type: 'thought' | 'action' | 'elicitation' | 'response' | 'error';
    title?: string | null;
    bodyMd?: string | null;
    toolName?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<{ accepted: boolean }> {
    return this.sessions.appendActivity(input);
  }

  timeline(input: {
    projectId: string;
    sessionId: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    return this.sessions.timeline(input);
  }
}
