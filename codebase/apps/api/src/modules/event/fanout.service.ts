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

// 상한은 @nerv/schema 가 정본이다 — 웹과 API 가 각각 8 을 들고 있으면 언젠가 어긋난다.
export { MAX_PROJECT_ROOMS } from '@nerv/schema';

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
   * 룸은 둘이다(api.md §3.3). 프로젝트 룸은 `project_id` 로 곧장 계산되고, **개인 룸은
   * 봉투가 지목한다** — `recipient_user_ids` 가 그 자리다. 수신자 산출은 표면이 아니라
   * 알림 파생이 하고(D-05: 판정은 한 곳), 여기서는 지목된 룸으로 흘리기만 한다.
   *
   * 한 사람이 두 룸에 다 있으면 **한 번만** 받는다 — 같은 봉투를 두 번 흘리면 화면은
   * 같은 Query 를 두 번 무효화한다.
   */
  dispatch(envelope: BroadcastEnvelope): number {
    const room: RoomName = `project:${envelope.project_id}`;
    const personal = new Set<RoomName>(
      (envelope.recipient_user_ids ?? []).map((id) => `user:${id}` as RoomName),
    );
    let delivered = 0;
    for (const subscriber of this.subscribers) {
      const listening =
        subscriber.rooms.has(room) || [...personal].some((r) => subscriber.rooms.has(r));
      if (!listening) continue;
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
