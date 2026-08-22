// 무활동 30분 세션 stale 전이 + 클레임 회수 (D-13)
import { Injectable } from '@nestjs/common';
import { SessionService } from '../../modules/session/session.service.js';

@Injectable()
export class SessionStaleJob {
  readonly name = 'session-stale';
  constructor(private readonly sessions: SessionService) {}

  run(): never {
    return this.sessions.markStale();
  }
}
