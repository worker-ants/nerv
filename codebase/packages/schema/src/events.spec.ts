// 이벤트 이름의 **와이어 값**을 고정한다.
//   정본(알림 카탈로그): docs/03-proposal/spec-workflow.md §6
//   정본(실시간 전수 목록): docs/04-mvp/api.md §3.3
//
// event.type · socket.io 이벤트 이름 · SSE 의 event: 필드가 같은 문자열을 쓴다.

import { describe, expect, it } from 'vitest';
import { NERV_EVENT, NERV_EVENT_NAMES, NERV_EVENT_PHASE2 } from './events.js';

describe('이벤트 이름 카탈로그', () => {
  it('전부 <리소스>.<동사> 규약을 따른다', () => {
    for (const name of NERV_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z]+\.[a-z][a-z_]*$/);
    }
  });

  it('리소스 접두는 카탈로그가 정한 집합 안에 있다', () => {
    const resources = new Set(NERV_EVENT_NAMES.map((n) => n.split('.')[0]));
    expect([...resources].sort()).toEqual([
      'approval',
      'baseline',
      'claim',
      'comment',
      'cr',
      'evidence',
      'finding',
      'gate',
      'import',
      'notification',
      'question',
      'session',
      'spec',
      'task',
    ]);
  });

  it('P0 검증 시나리오가 참조하는 이름이 있다 (backlog §5.1~5.3)', () => {
    expect(NERV_EVENT.TASK_CLAIMED).toBe('task.claimed');
    expect(NERV_EVENT.SESSION_STALE).toBe('session.stale');
    expect(NERV_EVENT.CLAIM_CONFLICT_WARN).toBe('claim.conflict_warn');
    expect(NERV_EVENT.CLAIM_CONFLICT_BLOCKED).toBe('claim.conflict_blocked');
    expect(NERV_EVENT.IMPORT_APPLIED).toBe('import.applied');
  });

  it('Phase 2 이름은 상수로는 갈라져 있고 유니온에는 들어 있다 (2026-08-23 FR-09 착수)', () => {
    // **상수를 계속 나눠 두는 이유**는 "언제 들어온 이름인가"를 읽을 수 있게 하려는
    // 것이다. 유니온을 나눠 둘 이유는 없어졌다 — 리뷰 수집이 들어온 지금 이 이름들은
    // 실제로 emit 되고, 카탈로그(spec-workflow §6)는 처음부터 이것을 싣고 있었다.
    const all = new Set<string>(NERV_EVENT_NAMES);
    for (const name of Object.values(NERV_EVENT_PHASE2)) expect(all.has(name)).toBe(true);
    for (const name of Object.values(NERV_EVENT)) {
      expect(Object.values(NERV_EVENT_PHASE2 as Record<string, string>)).not.toContain(name);
    }
  });

  it('이름은 중복되지 않는다', () => {
    expect(new Set(NERV_EVENT_NAMES).size).toBe(NERV_EVENT_NAMES.length);
  });
});
