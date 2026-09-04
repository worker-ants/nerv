// 쿼터 — 정본: docs/04-mvp/api.md §1.8 (REQ-API-012)
//
// 한도 값은 `@nerv/schema` 가 정본으로 export 하고 이 파일은 **주체를 정하고 셀 뿐**이다
// (판정은 한 곳 · D-05). 창은 고정 1분이다 — 문서가 그렇게 적었고, 슬라이딩 창은 저장 비용이
// 다르다.
//
// **주체가 넷이고 목적이 둘이다.** PAT·웹 세션·ingest 셋은 과부하 방어이고, `/api/auth/*` 의
// IP 한도는 무차별 대입 방어라 여기 없다 — 인증 스택(better-auth)이 자기 표면에서 센다.
//
// 저장소는 Valkey 다. 프로세스 메모리는 **폴백**이며, 그 사실이 중요하다: api 는 파드가
// 여럿이라(replicas 2) 각자 세면 실효 한도가 파드 수배로 늘어난다. Valkey 가 죽었을 때
// 아예 안 세는 것보다는 파드별로라도 세는 편이 낫다 — 과부하 방어의 목적은 서버를 살리는
// 것이고, 그때 필요한 것은 정확한 숫자가 아니라 상한의 존재다.

import { Injectable } from '@nestjs/common';
import {
  RATE_LIMIT_INGEST_PER_MIN,
  RATE_LIMIT_PAT_PER_MIN,
  RATE_LIMIT_WEB_PER_MIN,
} from '@nerv/schema';
import { ValkeyService } from '../modules/event/valkey.service.js';

/** 고정 창 길이. 문서가 "분당" 이라고 적었으므로 60 초다. */
export const RATE_WINDOW_SECONDS = 60;

/** 창이 지나도 키가 남으면 메모리가 샌다 — 창 하나만큼 더 살려 두고 지운다. */
const KEY_TTL_SECONDS = RATE_WINDOW_SECONDS + 10;

export type RateSubjectKind = 'pat' | 'web' | 'ingest';

export interface RateSubject {
  kind: RateSubjectKind;
  /** 주체 식별자 — 토큰 id · 사용자 id · 세션 id */
  id: string;
}

export interface RateDecision {
  allowed: boolean;
  /** 남은 창의 초 — 429 의 `Retry-After` 와 `retry_after_s` 가 같은 값을 쓴다 */
  retryAfterSeconds: number;
  limit: number;
  count: number;
}

export const LIMIT_OF: Readonly<Record<RateSubjectKind, number>> = {
  pat: RATE_LIMIT_PAT_PER_MIN,
  web: RATE_LIMIT_WEB_PER_MIN,
  ingest: RATE_LIMIT_INGEST_PER_MIN,
};

@Injectable()
export class RateLimitService {
  /** Valkey 를 못 쓸 때의 폴백. 창 번호를 함께 담아 창이 바뀌면 버린다. */
  private readonly local = new Map<string, { window: number; count: number }>();

  constructor(private readonly valkey: ValkeyService) {}

  /**
   * 한 요청을 센다.
   *
   * @param now 창 번호 계산용 epoch ms. 테스트가 시간을 넘길 수 있도록 인자로 받는다 —
   *            `Date.now()` 를 안에서 부르면 창 경계를 검증할 방법이 없다.
   */
  async hit(subject: RateSubject, now: number = Date.now()): Promise<RateDecision> {
    const limit = LIMIT_OF[subject.kind];
    const window = Math.floor(now / (RATE_WINDOW_SECONDS * 1000));
    const key = `nerv:rl:${subject.kind}:${subject.id}:${window}`;

    const shared = await this.valkey.incrementWindow(key, KEY_TTL_SECONDS);
    const count = shared ?? this.countLocally(key, window);

    // 창이 끝날 때까지 남은 초. 올림이라 0 초를 주지 않는다 — 0 은 "지금 다시" 라는 뜻이라
    // 클라이언트를 곧장 다음 429 로 보낸다.
    const elapsedMs = now - window * RATE_WINDOW_SECONDS * 1000;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((RATE_WINDOW_SECONDS * 1000 - elapsedMs) / 1000),
    );

    return { allowed: count <= limit, retryAfterSeconds, limit, count };
  }

  /** 폴백 카운터. 창이 바뀐 항목은 그 자리에서 버려 맵이 자라지 않게 한다. */
  private countLocally(key: string, window: number): number {
    for (const [k, v] of this.local) if (v.window !== window) this.local.delete(k);
    const entry = this.local.get(key);
    if (entry === undefined || entry.window !== window) {
      this.local.set(key, { window, count: 1 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}
