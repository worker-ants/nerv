// 파드별 팬아웃 — 구독한 봉투를 자기 파드에 붙은 WS 룸·SSE 스트림으로 흘린다.
//
// ※ codebase.md §2.2 트리에는 이 파일이 없다. WS 게이트웨이와 SSE 컨트롤러가 **같은
//   룸 계산·같은 멤버십 판정**을 써야 하는데(D-05), 그것을 둘 중 한쪽에 두면 다른 쪽이
//   그 쪽을 import 하게 된다. 공통 부분을 여기로 올리고 두 표면은 구독만 한다.
//
// 룸 규약은 api.md §3.2·§3.3 정본이다:
//   user:{id}     연결 성공 시 서버가 자동 join — 개인 대상 이벤트
//   project:{id}  클라이언트가 join emit, 서버가 멤버십 검사 — 프로젝트 화면 갱신
// 표의 "룸" 열은 SSE 에 그대로 대응된다: project 룸 = /sse/projects/{p}, user 룸 = /sse/me.

import { Injectable, Logger } from '@nestjs/common';
import type { BroadcastEnvelope } from './event-subscriber.service.js';
import { EventSubscriberService } from './event-subscriber.service.js';

export type RoomName = `project:${string}` | `user:${string}`;

export interface Subscriber {
  /** 이 구독자가 듣는 룸들 */
  rooms: Set<RoomName>;
  deliver: (envelope: BroadcastEnvelope) => void;
}

/** 연결당 join 가능한 project 룸 상한 — WS·SSE 공통(api.md §3.2·§3.5) */
export const MAX_PROJECT_ROOMS = 8;

@Injectable()
export class FanoutService {
  private readonly logger = new Logger(FanoutService.name);
  private readonly subscribers = new Set<Subscriber>();

  constructor(private readonly source: EventSubscriberService) {
    this.source.onBroadcast((envelope) => this.dispatch(envelope));
  }

  /** 구독자 등록. 반환된 함수를 부르면 해제된다. */
  add(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /**
   * 봉투 하나를 관련 룸의 구독자에게만 흘린다.
   *
   * 봉투에는 project_id 만 있고 user 대상 여부는 없다 — 개인 룸 라우팅(승인 요청·질문 등)은
   * notification 파생이 정한다(E13-S03). 여기서는 프로젝트 룸만 계산하고, 개인 룸은
   * 구독자가 명시적으로 join 한 것에만 보낸다.
   */
  dispatch(envelope: BroadcastEnvelope): number {
    const room: RoomName = `project:${envelope.project_id}`;
    let delivered = 0;
    for (const subscriber of this.subscribers) {
      if (!subscriber.rooms.has(room)) continue;
      try {
        subscriber.deliver(envelope);
        delivered += 1;
      } catch (error) {
        // 한 연결의 실패가 다른 연결을 막지 않는다
        this.logger.warn(`전달 실패: ${String(error)}`);
      }
    }
    return delivered;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
