// 무활동 30분 세션 stale 전이 + 클레임 회수 (D-13)
import { Injectable, Logger } from '@nestjs/common';
import { SessionService } from '../../modules/session/session.service.js';

@Injectable()
export class SessionStaleJob {
  readonly name = 'session-stale';
  private readonly logger = new Logger(SessionStaleJob.name);
  constructor(private readonly sessions: SessionService) {}

  async run(): Promise<number> {
    const staled = await this.sessions.markStale();
    if (staled > 0) this.logger.log(`무활동 세션 ${staled}건을 stale 로 전이했다`);
    return staled;
  }
}
