// 표기 규약은 화면의 계약이다 — ui-wireframes §3.3 이 못박은 것들을 고정한다.
import { describe, expect, it } from 'vitest';
import { diffStat, identity, leaseRemaining, relativeTime } from './format.js';

describe('상대 시각 (§3.3 — 하트비트는 상대 시각만)', () => {
  const now = new Date('2026-08-22T12:00:00Z').getTime();
  it.each([
    ['2026-08-22T11:59:48Z', '12초 전'],
    ['2026-08-22T11:57:00Z', '3분 전'],
    ['2026-08-22T10:00:00Z', '2시간 전'],
    ['2026-08-20T12:00:00Z', '2일 전'],
  ])('%s → %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it('하트비트가 없으면 시각 대신 사실을 적는다', () => {
    expect(relativeTime(null, now)).toBe('기록 없음');
  });

  it('미래 시각도 음수로 새지 않는다 — 시계 오차 방어', () => {
    expect(relativeTime('2026-08-22T12:00:30Z', now)).toBe('0초 전');
  });
});

describe('리스 잔여', () => {
  it('mm:ss 로 쓴다', () => {
    expect(leaseRemaining(1800)).toBe('30:00');
    expect(leaseRemaining(65)).toBe('01:05');
  });

  it('만료를 숫자로 흘리지 않는다', () => {
    expect(leaseRemaining(0)).toBe('만료');
    expect(leaseRemaining(-5)).toBe('만료');
  });

  it('클레임이 없으면 대시', () => {
    expect(leaseRemaining(null)).toBe('—');
  });
});

describe('신원 3요소 · diff', () => {
  const card = { user_name: '도현', hostname: 'mac-02', agent_type: 'claude-code' };

  it('사용자 · hostname · 에이전트 종류를 모두 적는다', () => {
    expect(identity(card)).toBe('도현 · mac-02 · claude-code');
  });

  it('좁은 화면은 hostname/agent 로 줄인다', () => {
    expect(identity(card, true)).toBe('mac-02/claude-code');
  });

  it('diff 는 +N −M', () => {
    expect(diffStat(218, 34)).toBe('+218 −34');
  });
});
