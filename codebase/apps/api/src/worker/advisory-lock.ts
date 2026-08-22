// pg_advisory_lock — 잡 루프 단일 실행 보장 (REQ-CB-011)
//
// replica 1 은 배포 규칙이고 이 lock 이 최종 방어선이다. 어떤 이유로든 워커가 2개 이상 떠도
// 키를 보유한 하나만 잡 루프를 돈다. 키 정본은 @nerv/schema 의 WORKER_ADVISORY_LOCK_KEY.
import { Injectable, Logger } from '@nestjs/common';
import { WORKER_ADVISORY_LOCK_KEY } from '@nerv/schema';
import { NotImplementedYetError } from '../common/nerv-exception.filter.js';

@Injectable()
export class AdvisoryLock {
  private readonly logger = new Logger(AdvisoryLock.name);
  readonly key = WORKER_ADVISORY_LOCK_KEY;

  /** 세션 수준 advisory lock 을 잡는다. 실패하면 이 인스턴스는 잡 루프를 돌지 않는다. */
  acquire(): never {
    throw new NotImplementedYetError('E04-S04', 'pg_advisory_lock 획득');
  }

  release(): never {
    throw new NotImplementedYetError('E04-S04', 'pg_advisory_lock 해제');
  }
}
