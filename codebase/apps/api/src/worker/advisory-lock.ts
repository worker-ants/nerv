// pg_advisory_lock — 잡 루프 단일 실행 보장 (REQ-CB-011)
//
// replica 1 은 배포 규칙이고 이 lock 이 최종 방어선이다. 어떤 이유로든 워커가 2개 이상 떠도
// 키를 보유한 하나만 잡 루프를 돈다. 키 정본은 @nerv/schema 의 WORKER_ADVISORY_LOCK_KEY.
//
// **세션 수준**(pg_try_advisory_lock)이지 트랜잭션 수준이 아니다 — 워커가 살아 있는 동안
// 계속 쥐고 있어야 하고, 프로세스가 죽으면 커넥션이 끊기며 Postgres 가 알아서 놓는다.
// 그래서 "죽은 워커가 락을 물고 있는" 상태가 원리적으로 생기지 않는다.
//
// **그 커넥션을 이 클래스가 직접 쥔다**(2026-09-02 정정). 예전에는 풀에서 아무 커넥션이나
// 빌려 `pg_try_advisory_lock` 을 실행하고 곧바로 반납했다. 세션 수준 락은 **그 물리
// 커넥션**에 묶이므로, 풀이 유휴 커넥션을 닫는 순간(pg-pool 기본 10초) Postgres 는 락을
// 놓아 버린다 — 그런데 메모리의 `held` 는 여전히 true 라 이 워커는 락 없이 잡을 계속 돌고,
// 두 번째 워커는 이제 락을 얻어 **둘이 같이 돈다**. 알림이 두 번 파생되고 보존 잡이 겹쳐
// 도는 상태가 REQ-CB-011 이 막으려던 바로 그것이다.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { WORKER_ADVISORY_LOCK_KEY } from '@nerv/schema';
import type pg from 'pg';
import { NERV_PG_POOL } from '../common/database.module.js';

@Injectable()
export class AdvisoryLock {
  private readonly logger = new Logger(AdvisoryLock.name);
  readonly key = WORKER_ADVISORY_LOCK_KEY;

  /** 락을 쥔 커넥션. null 이면 락도 없다 — 둘은 같은 사실의 두 표현이다. */
  private client: pg.PoolClient | null = null;

  constructor(@Inject(NERV_PG_POOL) private readonly pool: pg.Pool) {}

  get isHeld(): boolean {
    return this.client !== null;
  }

  /**
   * 세션 수준 advisory lock 을 잡는다. 실패하면 이 인스턴스는 잡 루프를 돌지 않는다.
   *
   * 실패가 정상 경로다 — 롤링 배포 중에는 두 워커가 잠시 겹치고, 그때 새 워커는
   * 조용히 대기하다 옛 워커가 죽으면 다음 틱에서 획득한다.
   */
  async acquire(): Promise<boolean> {
    // 쥐고 있다고 **믿는** 것과 쥐고 있는 것은 다르다 — 커넥션이 살아 있는지 확인한다
    if (this.client !== null) {
      try {
        await this.client.query('SELECT 1');
        return true;
      } catch {
        this.forget();
      }
    }

    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        [this.key.toString()],
      );
      if (rows[0]?.locked !== true) {
        client.release();
        return false;
      }
      // 커넥션이 죽으면 락도 죽는다 — 그 사실을 메모리에도 반영한다
      client.on('error', () => this.forget());
      this.client = client;
      this.logger.log(`잡 루프 lock 획득 (key=${this.key})`);
      return true;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async release(): Promise<void> {
    const client = this.client;
    if (client === null) return;
    this.client = null;
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [this.key.toString()]);
    } finally {
      client.release();
    }
    // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
    this.logger.log('잡 루프 lock 해제');
  }

  /** 커넥션이 끊겼다 — 락은 이미 Postgres 가 놓았다. 다음 틱에서 다시 잡는다. */
  private forget(): void {
    const client = this.client;
    this.client = null;
    try {
      client?.release(true);
    } catch {
      // 이미 반납된 커넥션 — 무시한다
    }
  }
}
