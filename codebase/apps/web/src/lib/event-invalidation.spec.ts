// 이벤트 → 쿼리 무효화 매핑이 screens.md §1.4 표와 어긋나면 실시간 갱신이 **조용히** 죽는다.
// 화면은 멀쩡히 뜨고 데이터만 낡는다 — 그래서 표 자체를 테스트로 고정한다.

import { describe, expect, it } from 'vitest';
import { NERV_EVENT, NERV_EVENT_NAMES, NERV_EVENT_PHASE2 } from '@nerv/schema';
import type { NervEventEnvelope, NervEventName } from '@nerv/schema';
import { invalidationKeysFor, mappedEventNames, NO_SCREEN_YET } from './event-invalidation.js';
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

  it('승인 요청·질문 생성은 받은 요청을 무효화한다', () => {
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

  it('이벤트는 전부 매핑이나 예외 목록 중 하나에 있다 — 빠지면 그 화면만 낡는다', () => {
    const mapped = new Set([...mappedEventNames(), ...NO_SCREEN_YET]);
    const missing = NERV_EVENT_NAMES.filter((n) => !mapped.has(n));
    expect(missing).toEqual([]);
  });

  it('발견이 열리면 큐와 게이트 현황이 함께 갱신된다 (REQ-WEB-066)', () => {
    // **같은 사실의 두 얼굴**이라 함께 무효화한다. 큐만 갱신하면 "열린 것 0건"인데
    // 판정은 `pending` 인 화면이 남는다.
    const opened = NERV_EVENT_PHASE2.FINDING_OPENED as unknown as NervEventName;
    expect(invalidationKeysFor(envelope(opened))).toEqual([
      queryKeys.projectFindings('prj-1'),
      queryKeys.projectGateCoverage('prj-1'),
    ]);
  });

  it('화면 없는 이벤트는 빈 배열을 준다 — 모르는 이벤트로 화면을 흔들지 않는다', () => {
    const p2 = NERV_EVENT_PHASE2.CR_OPENED as unknown as NervEventName;
    expect(invalidationKeysFor(envelope(p2))).toEqual([]);
    // 예외는 **의도한 공백**이다: 매핑을 가진 채로 목록에 있으면 둘 중 하나가 낡은 것이다
    const mapped = new Set(mappedEventNames());
    for (const name of NO_SCREEN_YET) expect(mapped.has(name)).toBe(false);
  });
});
