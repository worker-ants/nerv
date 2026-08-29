// 파드별 SUBSCRIBE nerv_events → 자기 소켓·SSE 스트림 emit (codebase.md §2.1)
//
// 크로스파드 socket.io 어댑터를 두지 않는 이유가 여기다 — 모든 emit 의 원천이 Valkey 방송이라
// 파드마다 구독만 걸면 자기에게 붙은 연결에 밀어줄 수 있다. 그래서 스티키 세션도 필요 없다.
//
// 수신한 봉투에는 참조만 있다(id·type·project_id). 이 서비스는 그것을 그대로 흘리고,
// 상세 조회는 수신자(웹·CLI)가 자기 권한으로 한다(database.md §3.3).

import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { EVENTS_CHANNEL } from '@nerv/schema';
import type { NervEventEnvelope } from '@nerv/schema';
import { ValkeyService } from './valkey.service.js';

/**
 * 방송 봉투 — WS·SSE 가 그대로 흘린다. **정본은 `NervEventEnvelope`**(api.md §3.3).
 *
 * 예전에는 세 필드짜리 "최소 형태"였고, 그래서 받는 쪽이 무엇이 바뀌었는지(`subject_id`·
 * `subject_key`) 알 수 없었다 — 화면은 무효화할 키를 만들지 못했다(실측 2026-08-29).
 * 여기서 타입을 좁히면 그 사고가 다시 난다.
 */
export type BroadcastEnvelope = NervEventEnvelope;

export type BroadcastListener = (envelope: BroadcastEnvelope) => void;

@Injectable()
export class EventSubscriberService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EventSubscriberService.name);
  private readonly listeners = new Set<BroadcastListener>();
  private started = false;

  constructor(private readonly valkey: ValkeyService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  /** 기동 시 1회. 구독 실패는 프로세스를 죽이지 않는다 — 폴백은 재조회다(D-14). */
  async start(): Promise<void> {
    if (this.started) return;
    try {
      await this.valkey.subscribe(EVENTS_CHANNEL, (_channel, payload) => this.dispatch(payload));
      this.started = true;
    } catch (error) {
      this.logger.warn(`구독 실패 — 실시간 갱신 없이 기동한다(D-14). ${String(error)}`);
    }
  }

  /** WS 게이트웨이·SSE 컨트롤러가 자기 팬아웃을 여기 등록한다. */
  onBroadcast(listener: BroadcastListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private dispatch(payload: string): void {
    let envelope: BroadcastEnvelope;
    try {
      envelope = JSON.parse(payload) as BroadcastEnvelope;
    } catch {
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
      this.logger.warn('방송 페이로드를 해석하지 못했습니다');
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(envelope);
      } catch (error) {
        // 한 수신자의 실패가 다른 수신자를 막지 않는다
        this.logger.warn(`수신자 처리 실패: ${String(error)}`);
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
