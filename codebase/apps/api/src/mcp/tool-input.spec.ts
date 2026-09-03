// 도구 입력 검증 — 모르는 인자를 세는 부분(REQ-API-080).
//
//   WHEN 도구 호출이 스키마에 없는 인자를 실으면,
//   THE SYSTEM SHALL 그 이름을 무시 목록으로 돌려준다(거부하지는 않는다)
//
// 이 검사가 지키는 것은 **조용한 실패의 부재**다. 예전에는 스키마에 없는 속성을 검사도
// 거부도 없이 지나쳐, 스킬이 지시하는 인자 열한 종이 성공 응답과 함께 사라졌다.

import { NERV_ERROR } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { assertToolInput } from './tool-input.js';

const SCHEMA = {
  type: 'object',
  properties: {
    claim_id: { type: 'string' },
    reason: { type: 'string', enum: ['done', 'handoff', 'abandon'] },
    lease_seconds: { type: 'integer' },
  },
  required: ['claim_id'],
};

describe('모르는 인자 — 버렸다는 사실을 말한다', () => {
  it('스키마에 있는 인자만 보내면 무시 목록이 비어 있다', () => {
    expect(assertToolInput(SCHEMA, { claim_id: 'c1', reason: 'done' })).toEqual([]);
  });

  it('스키마에 없는 인자의 이름을 돌려준다 — 거부하지는 않는다', () => {
    // 배포된 스킬이 지금 이 인자를 보낸다. 거부하면 첫 세션 경로가 다시 막힌다.
    expect(assertToolInput(SCHEMA, { claim_id: 'c1', state_note: '인계 메모' })).toEqual([
      'state_note',
    ]);
  });

  it('값이 null 이어도 이름은 드리프트다', () => {
    expect(assertToolInput(SCHEMA, { claim_id: 'c1', stats: null })).toEqual(['stats']);
  });

  it('봉투 인자는 유령이 아니다 — 게이트웨이가 직접 읽는다', () => {
    const ignored = assertToolInput(SCHEMA, {
      claim_id: 'c1',
      session_id: 's1',
      idempotency_key: 'k1',
    });
    expect(ignored).toEqual([]);
  });

  it('거절당한 호출에도 함께 말한다 — 이름을 잘못 적은 것이 원인일 수 있다', () => {
    try {
      assertToolInput(SCHEMA, { claimId: 'c1' });
      expect.unreachable('필수 인자가 없으므로 던져야 한다');
    } catch (error) {
      const details = (error as { code: string; details: Record<string, unknown> }).details;
      expect((error as { code: string }).code).toBe(NERV_ERROR.PRECONDITION);
      expect(details['missing']).toEqual(['claim_id']);
      // 오타는 "빠졌다" 와 "모르는 이름" 으로 동시에 보인다 — 그 둘이 같이 있어야 고칠 수 있다
      expect(details['unknown']).toEqual(['claimId']);
    }
  });

  it('기존 판정은 그대로다 — 타입·열거값', () => {
    expect(() => assertToolInput(SCHEMA, { claim_id: 'c1', lease_seconds: 'soon' })).toThrow();
    expect(() => assertToolInput(SCHEMA, { claim_id: 'c1', reason: 'later' })).toThrow();
  });
});
