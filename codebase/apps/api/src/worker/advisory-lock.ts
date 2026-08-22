// pg_advisory_lock — 잡 루프 단일 실행 보장 (REQ-CB-011)
//
// replica 1 은 배포 규칙이고 이 lock 이 최종 방어선이다. 어떤 이유로든 워커가 2개 이상 떠도
// 키를 보유한 하나만 잡 루프를 돈다. 키 정본은 @nerv/schema 의 WORKER_ADVISORY_LOCK_KEY.
//
// **세션 수준**(pg_try_advisory_lock)이지 트랜잭션 수준이 아니다 — 워커가 살아 있는 동안
// 계속 쥐고 있어야 하고, 프로세스가 죽으면 커넥션이 끊기며 Postgres 가 알아서 놓는다.
// 그래서 "죽은 워커가 락을 물고 있는" 상태가 원리적으로 생기지 않는다.
import { Injectable, Logger } from '@nestjs/common';
import { WORKER_ADVISORY_LOCK_KEY } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../common/database.module.js';
import type { NervDb } from '../common/database.module.js';

@Injectable()
export class AdvisoryLock {
  private readonly logger = new Logger(AdvisoryLock.name);
  readonly key = WORKER_ADVISORY_LOCK_KEY;
  private held = false;

  constructor(@InjectDb() private readonly db: NervDb) {}

  get isHeld(): boolean {
    return this.held;
  }

  /**
   * 세션 수준 advisory lock 을 잡는다. 실패하면 이 인스턴스는 잡 루프를 돌지 않는다.
   *
   * 실패가 정상 경로다 — 롤링 배포 중에는 두 워커가 잠시 겹치고, 그때 새 워커는
   * 조용히 대기하다 옛 워커가 죽으면 다음 틱에서 획득한다.
   */
  async acquire(): Promise<boolean> {
    if (this.held) return true;
    const { rows } = await this.db.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(${this.key.toString()}::bigint) AS locked`,
    );
    this.held = rows[0]?.locked === true;
    if (this.held) this.logger.log(`잡 루프 lock 획득 (key=${this.key})`);
    return this.held;
  }

  async release(): Promise<void> {
    if (!this.held) return;
    await this.db.execute(sql`SELECT pg_advisory_unlock(${this.key.toString()}::bigint)`);
    this.held = false;
    this.logger.log('잡 루프 lock 해제');
  }
}
