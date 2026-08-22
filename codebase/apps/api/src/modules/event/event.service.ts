// event 행 삽입(도메인 트랜잭션 안) + 커밋 후 Valkey PUBLISH — REQ-CB-004
// 채널·페이로드 규약 정본: docs/04-mvp/database.md §3
//
// 도메인 서비스는 상태 전이와 **같은 트랜잭션**에서 append() 를 부르고, 커밋 후에야 방송이
// 나간다(롤백 시 발행 없음). 이 순서가 D-10(감사·알림의 단일 원천)의 실행 규칙이다.

import { Injectable } from '@nestjs/common';
import type { NervEventName } from '@nerv/schema';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

/** WS·SSE 로 흐르는 최소 봉투 — 본문 데이터를 싣지 않는다(api.md §3.3). */
export interface NervEventEnvelope {
  id: string;
  type: NervEventName;
  project_id: string;
  subject_type: string;
  subject_id: string;
  subject_key: string | null;
  occurred_at: string;
}

@Injectable()
export class EventService {
  /** 도메인 트랜잭션 안에서 event 행을 남긴다. */
  append(): never {
    throw new NotImplementedYetError('E05-S04', 'Event 적재 표준화');
  }

  /** 커밋 후 Valkey nerv_events 로 방송한다. */
  publishCommitted(): never {
    throw new NotImplementedYetError('E02-S03', '이벤트 방송 규약(Valkey PUBLISH)');
  }
}
