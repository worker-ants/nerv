// L1 — SSE 동시 연결 상한 (api.md §3.5)
//
// 이 규칙이 답해야 하는 것은 둘이다: 아홉 번째가 429 인가, 그리고 **끊긴 자리가 돌아오는가**.
// 둘째가 없으면 상한은 하루짜리 폭탄이 된다 — 하루 종일 붙었다 끊긴 사용자는 영영 못 연다.

import { describe, expect, it } from 'vitest';
import { MAX_SSE_PER_USER, NERV_ERROR } from '@nerv/schema';
import { SseController } from './sse.controller.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import type { FanoutService } from './fanout.service.js';
import type { SseRequest } from './sse-access.guard.js';

/** 방송 버스는 여기서 볼 것이 아니다 — 구독을 받아 해제 함수만 돌려준다. */
const fanout = { add: () => () => undefined } as unknown as FanoutService;

const reqFor = (userId: string): SseRequest =>
  ({ nervPrincipal: { userId, tokenId: null } }) as unknown as SseRequest;

/** @Sse 는 반환된 Observable 을 구독한다 — 구독해야 연결이 실제로 열린다. */
function open(controller: SseController, userId: string): () => void {
  const subscription = controller.me(reqFor(userId)).subscribe({ next: () => undefined });
  return () => subscription.unsubscribe();
}

describe('SSE 동시 연결 상한', () => {
  it(`사용자당 ${MAX_SSE_PER_USER}개까지 열리고 그 다음은 429다`, () => {
    const controller = new SseController(fanout);
    const closers = Array.from({ length: MAX_SSE_PER_USER }, () => open(controller, 'u1'));

    let thrown: unknown;
    try {
      open(controller, 'u1');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NervError);
    const error = thrown as NervError;
    expect(error.code).toBe(NERV_ERROR.RATE_LIMIT);
    expect(error.details['kind']).toBe('sse_connection_limit');
    // 다시 시도할 시각을 주지 않으면 클라이언트는 즉시 되돌아온다
    expect(error.retryAfterSeconds).toBeGreaterThan(0);

    for (const close of closers) close();
  });

  it('연결을 끊으면 자리가 돌아온다', () => {
    const controller = new SseController(fanout);
    const closers = Array.from({ length: MAX_SSE_PER_USER }, () => open(controller, 'u1'));
    expect(() => open(controller, 'u1')).toThrow(NervError);

    closers[0]?.();
    const reopened = open(controller, 'u1');
    expect(typeof reopened).toBe('function');

    reopened();
    for (const close of closers.slice(1)) close();
  });

  it('상한은 사용자별이다 — 한 사람이 다 써도 다른 사람은 연다', () => {
    const controller = new SseController(fanout);
    const closers = Array.from({ length: MAX_SSE_PER_USER }, () => open(controller, 'u1'));
    expect(() => open(controller, 'u1')).toThrow(NervError);

    const other = open(controller, 'u2');
    expect(typeof other).toBe('function');

    other();
    for (const close of closers) close();
  });
});
