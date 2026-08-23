// 사람 전용 스코프가 토큰 어휘에 섞이지 않는지 — **시스템 불변식**이라 테스트로 못박는다.
// 정본: docs/04-mvp/api.md §1.3 · agent-integration §6.1 ④

import { describe, expect, it } from 'vitest';
import {
  AGENT_SCOPES,
  HUMAN_ONLY_SCOPES,
  ROLE_SCOPES,
  canCreateSpecType,
  isAgentScope,
  isHumanOnlyScope,
  scopesForRoles,
} from './scopes.js';

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

describe('역할 → 스코프 매트릭스 (0003_multi_role)', () => {
  // 이 검사가 있는 이유는 실패해 봤기 때문이다: `agent-session:launch` 를 빠뜨렸더니
  // developer 토큰에서 그 스코프가 조용히 걸러져 `nerv_bootstrap` 이 막혔다.
  // **역할이 상한이 되는 순간 빠뜨린 스코프는 곧 사라진 권한이다.**
  it('모든 스코프가 최소 한 역할에는 있다 — 빠뜨리면 아무도 못 쓴다', () => {
    const covered = new Set(Object.values(ROLE_SCOPES).flat());
    const orphan = [...AGENT_SCOPES, ...HUMAN_ONLY_SCOPES].filter((s) => !covered.has(s));
    expect(orphan).toEqual([]);
  });

  it('viewer 는 읽기뿐이다', () => {
    expect([...scopesForRoles(['viewer'])]).toEqual(['spec:read']);
  });

  it('겸직은 **합집합**이다 — 고르는 것이 아니다', () => {
    const both = scopesForRoles(['planner', 'developer']);
    expect(both.has('spec:meta')).toBe(true); // planner 쪽
    expect(both.has('task:claim')).toBe(true); // developer 쪽
    // 각각보다 넓거나 같아야 한다
    for (const one of ['planner', 'developer']) {
      for (const s of scopesForRoles([one])) expect(both.has(s)).toBe(true);
    }
  });

  it('사람 전용 스코프는 역할에는 있어도 토큰에는 못 간다', () => {
    // 역할 매트릭스와 토큰 발급 가능 여부는 **다른 축**이다(§1.3).
    expect(scopesForRoles(['planner']).has('spec:approve')).toBe(true);
    expect(isAgentScope('spec:approve')).toBe(false);
  });

  it('스펙 생성 타입은 역할이 가른다 (EP-SPEC-07 의 ● / ○)', () => {
    expect(canCreateSpecType(['designer'], 'design')).toBe(true);
    expect(canCreateSpecType(['designer'], 'feature')).toBe(false);
    expect(canCreateSpecType(['developer'], 'adr')).toBe(true);
    expect(canCreateSpecType(['planner'], 'feature')).toBe(true);
    expect(canCreateSpecType(['viewer'], 'feature')).toBe(false);
    // qa 가 만드는 것은 **리뷰이지 스펙이 아니다**(2026-08-23 확정). 리뷰 표면은 Phase 2 라
    // 현 단계의 qa 에게는 만들 것이 없다 — `null`(제한 없음)이 아니라 `[]`(하나도 없음)이다.
    for (const type of ['feature', 'design', 'convention', 'adr', 'vision', 'area']) {
      expect(canCreateSpecType(['qa'], type)).toBe(false);
    }
    // 그래도 `spec:draft` 는 있다 — 코멘트 해소(EP-CMT-04)와 초안 편집의 몫이다
    expect(scopesForRoles(['qa']).has('spec:draft')).toBe(true);
    // 겸직이면 어느 한쪽이 만들 수 있으면 만들 수 있다
    expect(canCreateSpecType(['designer', 'developer'], 'adr')).toBe(true);
  });
});
