// 누름 하나 = 멱등 키 하나 (REQ-WEB-195 · api.md §1.5)
//
// 키를 대상에서 만들던 동안(`claim-<작업 id>`) 서버는 같은 키의 두 번째 누름을 **첫 응답의
// 재생**으로 돌려줬다 — 새 클레임은 없는데 "잡았습니다" 가 떴다. 이 파일은 키가 누름을
// 따라가는지만 본다. 화면이 그것을 쓰는지는 steer-panel·task-detail 검사가 본다.

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { NervApiError } from './api.js';
import { freshKey, isRepeatedPress, usePressKey } from './press-key.js';

function envelope(details: Record<string, unknown>): NervApiError {
  return new NervApiError(409, {
    ok: false,
    code: NERV_ERROR.PRECONDITION,
    message: '처리 중',
    details,
    retry_after_s: 1,
    next_actions: [],
  });
}

describe('usePressKey', () => {
  it('누름이 도는 동안은 같은 키다 — 단추가 잠기기 전의 거듭 누름이 두 번 실행되지 않게', () => {
    const { result } = renderHook(() => usePressKey('claim'));
    const first = result.current.take();
    expect(result.current.take()).toBe(first);
  });

  it('끝난 뒤의 누름은 새 누름이다 — 놓고 다시 잡으면 새 키를 받는다', () => {
    const { result } = renderHook(() => usePressKey('claim'));
    const first = result.current.take();
    result.current.release();
    const second = result.current.take();
    expect(second).not.toBe(first);
    expect(second.startsWith('claim-')).toBe(true);
  });

  it('대상에서 만들지 않는다 — 같은 조작의 두 키가 서로 다르다', () => {
    expect(freshKey('steer')).not.toBe(freshKey('steer'));
  });
});

describe('isRepeatedPress', () => {
  it('같은 누름의 거듭 요청이 막힌 것은 실패가 아니다', () => {
    expect(isRepeatedPress(envelope({ kind: 'idempotency_in_flight' }))).toBe(true);
  });

  it('본문이 다른 재사용(`idempotency_mismatch`)은 실패다 — 숨기지 않는다', () => {
    expect(isRepeatedPress(envelope({ kind: 'idempotency_mismatch' }))).toBe(false);
    expect(isRepeatedPress(new Error('boom'))).toBe(false);
  });
});
