// NERV_* 에러 코드 → UI 동작 (screens.md §1.5)
//
// **그 표는 "모든 화면의 기본값" 으로 선언된 계약인데 코드를 보는 자리는 셋뿐이었다**
// (2026-09-06 대조): 나머지 여덟 코드가 일반 에러 카드로 떨어져 서버가 왜 막았는지가
// 화면에서 사라졌고, 봉투의 `retry_after_s`·`next_actions` 는 파싱만 되고 참조가 0건이었다.

import { createTranslator, NERV_ERROR } from '@nerv/schema';
import type { NervErrorCode } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { NervApiError } from './api.js';
import { describeApiError } from './api-errors.js';

const ko = createTranslator('ko');

function err(
  code: NervErrorCode | null,
  over: Partial<{
    message: string;
    details: Record<string, unknown>;
    retry_after_s: number | null;
    next_actions: string[];
  }> = {},
): NervApiError {
  return new NervApiError(409, {
    ok: false,
    code,
    message: '',
    details: {},
    retry_after_s: null,
    next_actions: [],
    ...over,
  });
}

describe('에러 코드 → UI 동작', () => {
  it('열 코드 전부 부류를 말한다 — "알 수 없는 오류" 로 떨어지는 코드가 없다', () => {
    const unknown = ko('apierr.unknown');
    for (const code of Object.values(NERV_ERROR)) {
      expect(describeApiError(ko, err(code)).message).not.toBe(unknown);
    }
  });

  it('UNAUTHENTICATED 는 로그인으로 보낸다', () => {
    expect(describeApiError(ko, err(NERV_ERROR.UNAUTHENTICATED)).redirectToLogin).toBe(true);
    expect(describeApiError(ko, err(NERV_ERROR.FORBIDDEN)).redirectToLogin).toBe(false);
  });

  it('UNAVAILABLE 은 배너를 격상한다 — 그 코드만', () => {
    expect(describeApiError(ko, err(NERV_ERROR.UNAVAILABLE)).escalateBanner).toBe(true);
    expect(describeApiError(ko, err(NERV_ERROR.RATE_LIMIT)).escalateBanner).toBe(false);
  });

  it('RATE_LIMIT 은 Retry-After 를 존중한다 — 그 값은 파싱만 되고 쓰이지 않았다', () => {
    const action = describeApiError(ko, err(NERV_ERROR.RATE_LIMIT, { retry_after_s: 30 }));
    expect(action.retryAfterS).toBe(30);
    expect(action.message).toContain('30');
  });

  it('APPROVAL_REQUIRED 는 받은 요청으로 데려간다 — "그래서 어디로" 에서 멈추지 않게', () => {
    expect(describeApiError(ko, err(NERV_ERROR.APPROVAL_REQUIRED)).href).toBe('/inbox');
  });

  it('details.web_url 이 있으면 그것이 이긴다 — HUMAN_ONLY 가 딥링크를 실어 온다', () => {
    const action = describeApiError(
      ko,
      err(NERV_ERROR.HUMAN_ONLY, { details: { web_url: '/p/clemvion/specs/s-1' } }),
    );
    expect(action.href).toBe('/p/clemvion/specs/s-1');
  });

  it('**서버 문장을 버리지 않는다** — 코드는 부류이고 서버 문장은 이 건이다', () => {
    const action = describeApiError(
      ko,
      err(NERV_ERROR.CONFLICT_SCOPE, { message: '도현/mac-02 가 같은 파일을 잡고 있습니다' }),
    );
    expect(action.message).toContain('겹칩니다');
    expect(action.message).toContain('mac-02');
  });

  it('next_actions 를 덧붙인다 — 서버가 적어 보낸 다음 행동이다', () => {
    const action = describeApiError(
      ko,
      err(NERV_ERROR.LEASE_EXPIRED, { next_actions: ['재클레임'] }),
    );
    expect(action.message).toContain('재클레임');
  });

  it('봉투가 없는 실패는 문장만 옮긴다 — 배너 스위치는 도달 판정이 쥐고 있다', () => {
    const action = describeApiError(ko, new TypeError('Failed to fetch'));
    expect(action.escalateBanner).toBe(false);
    expect(action.message).toContain('Failed to fetch');
  });
});
