// 사람 전용 스코프가 토큰 어휘에 섞이지 않는지 — **시스템 불변식**이라 테스트로 못박는다.
// 정본: docs/04-mvp/api.md §1.3 · agent-integration §6.1 ④

import { describe, expect, it } from 'vitest';
import { AGENT_SCOPES, HUMAN_ONLY_SCOPES, isAgentScope, isHumanOnlyScope } from './scopes.js';

describe('PAT 스코프 어휘', () => {
  it('사람 전용 스코프는 토큰 어휘에 없다 — 정책이 아니라 불변식이다', () => {
    for (const human of HUMAN_ONLY_SCOPES) {
      expect(isAgentScope(human)).toBe(false);
      expect(AGENT_SCOPES as readonly string[]).not.toContain(human);
    }
    expect([...HUMAN_ONLY_SCOPES]).toEqual(['spec:approve', 'approval:decide']);
  });

  it('전부 resource:action 표기다', () => {
    for (const scope of [...AGENT_SCOPES, ...HUMAN_ONLY_SCOPES]) {
      expect(scope).toMatch(/^[a-z][a-z-]*:[a-z]+$/);
    }
  });

  it('도구 표의 권한 열과 같은 어휘다 (agent-integration §2.3)', () => {
    for (const s of [
      'spec:read',
      'spec:draft',
      'task:claim',
      'task:update',
      'agent-session:launch',
    ]) {
      expect(isAgentScope(s)).toBe(true);
    }
  });

  it('import:write 는 토큰에 줄 수 있다 — REST 전용이지만 사람 전용은 아니다', () => {
    expect(isAgentScope('import:write')).toBe(true);
    expect(isHumanOnlyScope('import:write')).toBe(false);
  });
});
