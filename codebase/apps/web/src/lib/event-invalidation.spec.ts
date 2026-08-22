// 이벤트 → 쿼리 무효화 매핑이 screens.md §1.4 표와 어긋나면 실시간 갱신이 **조용히** 죽는다.
// 화면은 멀쩡히 뜨고 데이터만 낡는다 — 그래서 표 자체를 테스트로 고정한다.

import { describe, expect, it } from 'vitest';
import { NERV_EVENT, NERV_EVENT_NAMES, NERV_EVENT_PHASE2 } from '@nerv/schema';
import type { NervEventEnvelope, NervEventName } from '@nerv/schema';
import { invalidationKeysFor, mappedEventNames } from './event-invalidation.js';
import { queryKeys } from './query-keys.js';

function envelope(type: NervEventName, over: Partial<NervEventEnvelope> = {}): NervEventEnvelope {
  return {
    id: 'evt-1',
    type,
    project_id: 'prj-1',
    subject_type: 'spec_version',
    subject_id: 'sub-1',
    subject_key: null,
    occurred_at: '2026-08-22T00:00:00Z',
    ...over,
  };
}

describe('invalidationKeysFor — screens.md §1.4', () => {
  it('스펙 문서 축 전이는 스펙·버전·트리 셋을 무효화한다', () => {
    const keys = invalidationKeysFor(envelope(NERV_EVENT.SPEC_APPROVED, { subject_id: 'spc-7' }));
    expect(keys).toEqual([
      queryKeys.spec('spc-7'),
      queryKeys.specVersions('spc-7'),
      queryKeys.projectSpecTree('prj-1'),
    ]);
  });

  it('Task 축 전이는 보드와 개별 Task 를 무효화한다', () => {
    const keys = invalidationKeysFor(envelope(NERV_EVENT.TASK_CLAIMED, { subject_id: 'tsk-3' }));
    expect(keys).toEqual([queryKeys.projectTasks('prj-1'), queryKeys.task('tsk-3')]);
  });

  it('클레임 해제는 보드와 세션 보드를 함께 무효화한다', () => {
    const keys = invalidationKeysFor(envelope(NERV_EVENT.CLAIM_RELEASED));
    expect(keys).toEqual([queryKeys.projectTasks('prj-1'), queryKeys.projectSessions('prj-1')]);
  });

  it('승인 요청·질문 생성은 승인함을 무효화한다', () => {
    expect(invalidationKeysFor(envelope(NERV_EVENT.APPROVAL_REQUESTED))).toEqual([
      queryKeys.inbox(),
    ]);
    expect(invalidationKeysFor(envelope(NERV_EVENT.QUESTION_CREATED))).toEqual([queryKeys.inbox()]);
  });

  it('알림 생성은 개인 알림 목록만 건드린다', () => {
    expect(invalidationKeysFor(envelope(NERV_EVENT.NOTIFICATION_CREATED))).toEqual([
      queryKeys.myNotifications(),
    ]);
  });

  it('MVP 이벤트는 전부 매핑을 갖는다 — 빠지면 그 화면만 낡는다', () => {
    const mapped = new Set(mappedEventNames());
    const missing = NERV_EVENT_NAMES.filter((n) => !mapped.has(n));
    expect(missing).toEqual([]);
  });

  it('Phase 2 이벤트는 빈 배열을 준다 — 모르는 이벤트로 화면을 흔들지 않는다', () => {
    const p2 = NERV_EVENT_PHASE2.FINDING_OPENED as unknown as NervEventName;
    expect(invalidationKeysFor(envelope(p2))).toEqual([]);
  });
});
