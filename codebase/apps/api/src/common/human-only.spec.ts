// 사람 전용 게이트의 판정 축 하나 — 에이전트인가 (common/human-only.ts · api.md §1.3b)
//
// 공용 판정 함수인데 L1 이 없었다. 값(`HumanOnlyAction`)이 늘 때 i18n 키 매핑을 빠뜨리면
// 메시지가 키 문자열 그대로 나가는데, 그것은 화면에서만 드러난다 — 여기서 잡는다.

import { NERV_ERROR } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { assertHuman } from './human-only.js';
import type { HumanOnlyAction } from './human-only.js';
import { NervError } from './nerv-exception.filter.js';

const ACTIONS: HumanOnlyAction[] = [
  'project_admin',
  'inbox',
  'inbox_decide',
  'approve',
  'bypass',
  'steer',
  'baseline',
  'token_issue',
];

describe('assertHuman — 가르는 축은 isAgent 하나다', () => {
  it.each(ACTIONS)('%s — 에이전트는 HUMAN_ONLY 로 막힌다', (action) => {
    try {
      assertHuman({ userId: 'u1', isAgent: true }, action);
      expect.unreachable('막지 않았다');
    } catch (error) {
      const err = error as NervError;
      expect(err).toBeInstanceOf(NervError);
      expect(err.code).toBe(NERV_ERROR.HUMAN_ONLY);
      expect(err.details).toMatchObject({ kind: 'human_only', action });
      // 메시지 매핑이 빠지면 키가 그대로 새어 나간다 — 그것을 여기서 본다
      expect(err.message).not.toContain('error.human_only.');
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it.each(ACTIONS)('%s — 사람은 아무 일도 일어나지 않는다', (action) => {
    expect(() => assertHuman({ userId: 'u1', isAgent: false }, action)).not.toThrow();
  });

  it('대신 갈 곳을 주면 details 에 실린다 — 막기만 하면 같은 호출을 재시도한다', () => {
    try {
      assertHuman({ userId: 'u1', isAgent: true }, 'inbox_decide', '/inbox');
      expect.unreachable('막지 않았다');
    } catch (error) {
      expect((error as NervError).details).toMatchObject({ web_url: '/inbox' });
    }
  });

  it('대신 갈 곳이 없으면 그 키도 없다 — 없는 화면으로 보내지 않는다', () => {
    try {
      assertHuman({ userId: 'u1', isAgent: true }, 'bypass');
      expect.unreachable('막지 않았다');
    } catch (error) {
      expect((error as NervError).details).not.toHaveProperty('web_url');
    }
  });
});
