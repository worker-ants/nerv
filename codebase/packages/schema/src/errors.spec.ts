// 에러 코드의 **와이어 값**을 고정한다 — 정본: docs/04-mvp/api.md §1.4
//
// apps/* 안에서는 리터럴 하드코딩이 lint 로 금지되므로(REQ-CB-006), 문자열 자체를 대조하는
// 자리는 여기 하나다. 이 값이 바뀌면 에이전트의 에러 대응 규약과 웹의 UI 매핑이 동시에 깨진다.

import { describe, expect, it } from 'vitest';
import { NERV_ERROR, NERV_ERROR_CODES } from './errors.js';

describe('NERV_* 에러 코드 어휘', () => {
  it('api.md §1.4 의 10종과 문자 단위로 일치한다', () => {
    expect([...NERV_ERROR_CODES].sort()).toEqual([
      'NERV_APPROVAL_REQUIRED',
      'NERV_CONFLICT_SCOPE',
      'NERV_DRAFT_LEASED',
      'NERV_FORBIDDEN',
      'NERV_HUMAN_ONLY',
      'NERV_LEASE_EXPIRED',
      'NERV_PRECONDITION',
      'NERV_RATE_LIMIT',
      'NERV_UNAUTHENTICATED',
      'NERV_UNAVAILABLE',
    ]);
  });

  it('키와 값이 NERV_ 접두만 다르다 — 참조 실수를 만들지 않는다', () => {
    for (const [key, value] of Object.entries(NERV_ERROR)) {
      expect(value).toBe(`NERV_${key}`);
    }
  });

  it('REST 전용 코드를 신설하지 않는다 — MCP 와 같은 체계다', () => {
    expect(NERV_ERROR_CODES).toHaveLength(10);
  });
});
