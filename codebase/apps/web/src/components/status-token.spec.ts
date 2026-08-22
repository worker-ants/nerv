// 엔티티 상태 → 토큰 배정 — screens.md §4.2 표 그대로.
// "엔티티마다 색을 새로 정하지 않는다"가 규칙이라 표가 곧 테스트다.

import { describe, expect, it } from 'vitest';
import {
  REQUIREMENT_TOKEN,
  SESSION_TOKEN,
  SEVERITY_TOKEN,
  SPEC_VERSION_TOKEN,
  TASK_TOKEN,
} from './status-token.js';

describe('상태 → 토큰 매핑 (screens.md §4.2)', () => {
  it('SpecVersion', () => {
    expect(SPEC_VERSION_TOKEN).toEqual({
      draft: 'idle',
      in_review: 'waiting',
      approved: 'ok',
      superseded: 'idle',
      deprecated: 'danger',
    });
  });

  it('Task — claimed 는 에이전트 점유(보라), ready 는 사람의 행동 대기(남색)', () => {
    expect(TASK_TOKEN.claimed).toBe('agent');
    expect(TASK_TOKEN.ready).toBe('action');
    expect(TASK_TOKEN.blocked).toBe('danger');
    expect(TASK_TOKEN.done).toBe('done');
  });

  it('AgentSession — error 와 stale 은 같은 위험 토큰이다', () => {
    expect(SESSION_TOKEN.error).toBe('danger');
    expect(SESSION_TOKEN.stale).toBe('danger');
    expect(SESSION_TOKEN.active).toBe('ok');
    expect(SESSION_TOKEN.awaiting_input).toBe('waiting');
  });

  it('Requirement · severity', () => {
    expect(REQUIREMENT_TOKEN).toEqual({
      unimplemented: 'idle',
      in_progress: 'progress',
      implemented: 'done',
      verified: 'ok',
    });
    expect(SEVERITY_TOKEN).toEqual({ info: 'progress', warning: 'waiting', critical: 'danger' });
  });
});
