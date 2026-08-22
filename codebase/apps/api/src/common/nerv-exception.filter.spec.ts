// NERV_* ↔ HTTP 상태 매핑 — 정본: docs/04-mvp/api.md §1.4
// 매핑이 틀어지면 에이전트의 에러 대응 규약(agent-integration §2.7)이 통째로 어긋난다.

import { describe, expect, it } from 'vitest';
import { NERV_ERROR, NERV_ERROR_CODES } from '@nerv/schema';
import { statusFor } from './nerv-exception.filter.js';

describe('statusFor — api.md §1.4 매핑표', () => {
  it.each([
    [NERV_ERROR.UNAUTHENTICATED, 401],
    [NERV_ERROR.FORBIDDEN, 403],
    [NERV_ERROR.CONFLICT_SCOPE, 409],
    [NERV_ERROR.LEASE_EXPIRED, 409],
    [NERV_ERROR.DRAFT_LEASED, 409],
    [NERV_ERROR.APPROVAL_REQUIRED, 202],
    [NERV_ERROR.HUMAN_ONLY, 403],
    [NERV_ERROR.RATE_LIMIT, 429],
    [NERV_ERROR.UNAVAILABLE, 503],
  ])('%s → %i', (code, status) => {
    expect(statusFor(code, {})).toBe(status);
  });

  it('NERV_PRECONDITION 은 두 갈래다 — zod 위반은 400, 그 밖은 409', () => {
    expect(statusFor(NERV_ERROR.PRECONDITION, { issues: [] })).toBe(400);
    expect(statusFor(NERV_ERROR.PRECONDITION, { kind: 'base_version' })).toBe(409);
  });

  it('코드 10종 전부가 매핑을 갖는다', () => {
    expect(NERV_ERROR_CODES).toHaveLength(10);
    for (const code of NERV_ERROR_CODES) {
      expect(typeof statusFor(code, {})).toBe('number');
    }
  });
});
