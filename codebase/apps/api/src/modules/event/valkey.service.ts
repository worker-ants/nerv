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

/**
 * 방송 시한. 커밋 후 방송은 응답 경로 위에 있으므로(EventService.transact) Valkey 가
 * 느리거나 죽었을 때 API 지연으로 번지면 안 된다 — 시한을 넘기면 유실로 처리한다(D-14).
 */
const PUBLISH_TIMEOUT_MS = 1000;

/**
 * 구독 시한. 기동 경로 위에 있으므로 Valkey 가 없을 때 **기동 자체가 멈추면 안 된다** —
 * 문서가 약속한 것은 "실시간 없이 뜬다" 이지 "뜨지 않는다" 가 아니다(D-14).
 * 재시도는 구독 서비스가 배경에서 계속한다.
 */
const SUBSCRIBE_TIMEOUT_MS = 3000;

/** 종료 인사의 시한. 넘기면 인사 없이 끊는다 — 닫히지 않는 프로세스보다 낫다. */
const QUIT_TIMEOUT_MS = 500;

@Injectable()
export class ValkeyService implements OnApplicationShutdown {
  private readonly logger = new Logger(ValkeyService.name);
  readonly url = process.env['NERV_VALKEY_URL'] ?? 'redis://localhost:6379';

  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;

  /** 발행 실패 누적 — 운영에서 "조용한 유실"을 눈에 보이게 한다. */
  private publishFailures = 0;

  /** 접속 불가 로그가 초당 수십 줄로 쌓이는 것을 막는다 — 첫 실패만 자세히 남긴다. */
  private warnedOnce = false;

  private client(): Redis {
    this.publisher ??= this.connect('publisher', { maxRetriesPerRequest: 1 });
    return this.publisher;
  }

  /**
   * 커넥션 하나를 만든다.
   *
   * **'error' 리스너를 반드시 단다.** ioredis 는 접속 실패마다 error 이벤트를 내는데,
   * EventEmitter 에 리스너가 없으면 Node 가 그것을 unhandled error 로 던진다 — 방송 버스가
   * 잠깐 죽었다는 이유로 API 프로세스가 내려간다. 유실은 허용되지만 프로세스 종료는 아니다(D-14).
   */
  private connect(role: string, options: Record<string, unknown>): Redis {
    const client = new Redis(this.url, { lazyConnect: false, ...options });
    client.on('error', (error: Error) => {
      if (!this.warnedOnce) {
        this.warnedOnce = true;
        this.logger.warn(
          `Valkey ${role} 접속 실패 — 실시간 방송 없이 계속한다(D-14). ${error.message}`,
        );
      }
    });
    return client;
  }

  /**
   * 커밋 후 방송. 실패는 삼키고 기록만 한다(위 주석의 이유).
   * @returns 실제로 발행됐으면 true
   */
  async publish(channel: string, payload: string): Promise<boolean> {
    try {
      const sent = this.client().publish(channel, payload);
      // 시한을 넘긴 뒤에도 큐에 남은 명령이 나중에 실패할 수 있다 — unhandled rejection 방지
      sent.catch(() => undefined);
      await withTimeout(sent, PUBLISH_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.publishFailures += 1;
      if (!this.warnedOnce) {
        this.warnedOnce = true;
        this.logger.warn(`방송 실패 — 유실은 허용된다(D-14). ${String(error)}`);
      } else if (this.publishFailures % 100 === 0) {
        this.logger.warn(`방송 실패 누적 ${this.publishFailures}건`);
      }
      return false;
    }
  }

  /**
   * 파드별 구독. 구독 전용 커넥션을 따로 연다.
   *
   * **시한이 있다.** 구독 커넥션은 `maxRetriesPerRequest: null`(무제한 재시도)로 열리고
   * ioredis 는 접속 전 명령을 오프라인 큐에 넣으므로, Valkey 가 없으면 이 프로미스는
   * 거부되지도 해결되지도 않는다 — 영원히 pending 이다. 기동이 이것을 await 하고 있어서
   * "구독 실패는 프로세스를 죽이지 않는다" 는 catch 문에 **도달할 수 없었다**: 서버는
   * 죽지도 않고 뜨지도 않았다(healthz 무응답 → k8s 재시작 루프, CI L1 은 훅 타임아웃).
   */
  async subscribe(channel: string, handler: ValkeyMessageHandler): Promise<void> {
    this.subscriber ??= this.connect('subscriber', { maxRetriesPerRequest: null });
    this.subscriber.on('message', handler);
    const subscribed = this.subscriber.subscribe(channel);
    // 오프라인 큐에 남은 명령이 나중에 거부되면 unhandled rejection 이 된다
    subscribed.catch(() => undefined);
    await withTimeout(subscribed, SUBSCRIBE_TIMEOUT_MS);
    this.logger.log(`SUBSCRIBE ${channel}`);
  }

  /**
   * 고정 창 카운터 — 쿼터(api.md §1.8)의 저장소.
   *
   * **파드가 여럿이라 프로세스 메모리로는 셀 수 없다.** api 는 replicas 2 로 뜨므로
   * (deploy/k8s/base/api/deployment.yaml) 각자 세면 실효 한도가 파드 수만큼 늘어난다 —
   * 300 req/min 이라 적어 두고 600 을 허용하는 것은 한도가 아니라 장식이다.
   *
   * 실패는 **null** 로 돌려준다. 방송과 달리 여기서 삼키면 안 되는 것이 하나 있다:
   * 부르는 쪽이 "Valkey 가 죽어서 못 셌다" 와 "0건이다" 를 구별해야 한다. 못 셌을 때
   * 무엇을 할지(프로세스 메모리로 낮춰 세기)는 부르는 쪽의 판정이다.
   */
  async incrementWindow(key: string, ttlSeconds: number): Promise<number | null> {
    try {
      const client = this.client();
      // INCR 로 만들어진 키에는 TTL 이 없다 — 첫 히트에서 붙이지 않으면 창이 영원히 산다.
      const pipeline = client.multi().incr(key).expire(key, ttlSeconds, 'NX');
      const exec = pipeline.exec();
      exec.catch(() => undefined);
      const replies = await withTimeout(exec, PUBLISH_TIMEOUT_MS);
      const first = replies?.[0];
      if (first === undefined) return null;
      const [error, value] = first;
      if (error !== null || typeof value !== 'number') return null;
      return value;
    } catch {
      return null;
    }
  }

  get failureCount(): number {
    return this.publishFailures;
  }

  /**
   * 종료. **`quit()` 을 기다리지 않는다.**
   *
   * `quit` 은 QUIT 명령을 보내고 응답을 기다리는데, 접속이 없으면 그 명령은 오프라인 큐에
   * 앉아 영원히 돌아오지 않는다 — Valkey 가 죽은 상태에서 앱을 닫으면 `close()` 가 멈췄고,
   * 그래서 테스트는 훅 타임아웃으로, 컨테이너는 SIGTERM 뒤 강제 종료로 끝났다.
   * 시한 안에 인사하고, 안 되면 그냥 끊는다(`disconnect`).
   */
  async onApplicationShutdown(): Promise<void> {
    const close = async (client: Redis | null): Promise<void> => {
      if (client === null) return;
      const quitting = client.quit();
      quitting.catch(() => undefined);
      try {
        await withTimeout(quitting, QUIT_TIMEOUT_MS);
      } catch {
        client.disconnect();
      }
    };
    await Promise.allSettled([close(this.publisher), close(this.subscriber)]);
  }
}

/** 시한 초과를 실패로 바꾼다. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`방송 시한 ${ms}ms 초과`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
