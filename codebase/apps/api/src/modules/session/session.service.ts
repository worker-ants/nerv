// AgentSession 수명주기 — pending→active↔awaiting_input→complete/error/stale
// 정본: docs/03-proposal/data-model.md §2.5 · FR-07 · D-13
import { Injectable } from '@nestjs/common';
import { SESSION_STALE_SECONDS } from '@nerv/schema';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

@Injectable()
export class SessionService {
  /** 무활동 초과 시 stale 자동 전이 + 클레임 자동 회수(D-13) */
  readonly staleAfterSeconds = SESSION_STALE_SECONDS;

  constructor(private readonly events: EventService) {}

  /** nerv_bootstrap — 세션 등록 + 컨텍스트 팩. 같은 session_id 재호출은 동일 스냅샷(멱등) */
  bootstrap(): never {
    throw new NotImplementedYetError('E03-S03', 'nerv_bootstrap 컨텍스트 팩');
  }

  /** 훅 ingest 와 nerv_session_event 가 **같은 메서드**를 쓴다(api.md §4) */
  appendActivity(): never {
    throw new NotImplementedYetError('E05-S01', 'Activity 적재');
  }

  /** 무활동 세션의 stale 전이 — 워커의 session-stale 잡이 호출한다 */
  markStale(): never {
    throw new NotImplementedYetError('E04-S04', 'stale 전이');
  }
}
