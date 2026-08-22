// Valkey 클라이언트 provider — PUBLISH·SUBSCRIBE 공용 커넥션 관리 (codebase.md §2.2)
//
// 커넥션을 둘로 나눈다. RESP 프로토콜에서 구독 모드에 들어간 커넥션은 일반 명령을 받지
// 못하기 때문이다 — 발행용과 구독용이 같은 소켓이면 PUBLISH 가 막힌다.
//
// **방송 실패는 요청을 깨뜨리지 않는다.** 이미 커밋된 트랜잭션 뒤에 도는 코드이고,
// 방송 유실은 규약상 허용된다(D-14 — 진실은 DB, 클라이언트는 재조회, 워커는 폴링 폴백).
// 여기서 예외를 올리면 "DB 는 바뀌었는데 API 는 500" 이라는 최악의 조합이 된다.

import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

export type ValkeyMessageHandler = (channel: string, payload: string) => void;

@Injectable()
export class ValkeyService implements OnApplicationShutdown {
  private readonly logger = new Logger(ValkeyService.name);
  readonly url = process.env['NERV_VALKEY_URL'] ?? 'redis://localhost:6379';

  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  /** 발행 실패 누적 — 운영에서 "조용한 유실"을 눈에 보이게 한다. */
  private publishFailures = 0;

  private client(): Redis {
    this.publisher ??= new Redis(this.url, { lazyConnect: false, maxRetriesPerRequest: 1 });
    return this.publisher;
  }

  /**
   * 커밋 후 방송. 실패는 삼키고 기록만 한다(위 주석의 이유).
   * @returns 실제로 발행됐으면 true
   */
  async publish(channel: string, payload: string): Promise<boolean> {
    try {
      await this.client().publish(channel, payload);
      return true;
    } catch (error) {
      this.publishFailures += 1;
      this.logger.warn(
        `방송 실패(누적 ${this.publishFailures}) — 유실은 허용된다(D-14). ${String(error)}`,
      );
      return false;
    }
  }

  /** 파드별 구독. 구독 전용 커넥션을 따로 연다. */
  async subscribe(channel: string, handler: ValkeyMessageHandler): Promise<void> {
    this.subscriber ??= new Redis(this.url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.subscriber.on('message', handler);
    await this.subscriber.subscribe(channel);
    this.logger.log(`SUBSCRIBE ${channel}`);
  }

  get failureCount(): number {
    return this.publishFailures;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }
}
