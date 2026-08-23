// 이벤트 → 쿼리 무효화 매핑 — 정본: docs/04-mvp/screens.md §1.4
//
// 클라이언트 계약은 세 줄이다(같은 절).
//   ① 룸 2종 — user:{id} 는 서버가 자동 join, project:{id} 는 화면 진입 시 클라이언트가 join
//   ② **이벤트는 무효화 신호다** — 봉투에 본문이 없으므로 받으면 해당 키를 invalidate 하고 재조회한다
//   ③ 재연결 = 전체 재조회 — replay 는 없다(api.md §3.4, D-14)
//
// 그래서 이 파일은 "무엇을 다시 읽을 것인가"만 정하고 어떤 상태도 직접 바꾸지 않는다.

import { NERV_EVENT, NERV_EVENT_PHASE2 } from '@nerv/schema';
import type { NervEventEnvelope, NervEventName } from '@nerv/schema';
import { queryKeys } from './query-keys.js';
import type { NervQueryKey } from './query-keys.js';

const E = NERV_EVENT;

/** subject_id 를 그 이벤트의 주체 키로 해석하는 규칙(§1.4 표의 두 번째 열). */
type KeyBuilder = (e: NervEventEnvelope) => NervQueryKey[];

const specAxis: KeyBuilder = (e) => [
  queryKeys.spec(e.subject_id),
  queryKeys.specVersions(e.subject_id),
  queryKeys.projectSpecTree(e.project_id),
];
const specComments: KeyBuilder = (e) => [queryKeys.specComments(e.subject_id)];
const taskAxis: KeyBuilder = (e) => [
  queryKeys.projectTasks(e.project_id),
  queryKeys.task(e.subject_id),
];
const sessionAxis: KeyBuilder = (e) => [
  queryKeys.projectSessions(e.project_id),
  queryKeys.session(e.subject_id),
];
const inboxAxis: KeyBuilder = () => [queryKeys.inbox()];

const MAP: Partial<Record<NervEventName, KeyBuilder>> = {
  [E.SPEC_DRAFT_CREATED]: specAxis,
  [E.SPEC_SUBMITTED]: specAxis,
  [E.SPEC_REJECTED]: specAxis,
  [E.SPEC_APPROVED]: specAxis,
  [E.SPEC_SUPERSEDED]: specAxis,
  [E.SPEC_DEPRECATED]: specAxis,
  [E.SPEC_META_UPDATED]: specAxis,
  [E.SPEC_ARCHIVED]: specAxis,
  [E.SPEC_RESTORED]: specAxis,
  // 참조 전파 — S3 참조 갱신 배지가 함께 붙는다
  [E.SPEC_RECHECK_REQUESTED]: (e) => [queryKeys.spec(e.subject_id)],

  [E.SPEC_COMMENT_ADDED]: specComments,
  [E.COMMENT_RESOLVED]: specComments,

  [E.TASK_READY]: taskAxis,
  [E.TASK_CLAIMED]: taskAxis,
  [E.TASK_BLOCKED]: taskAxis,
  [E.TASK_DONE]: taskAxis,
  [E.TASK_CREATED]: taskAxis,
  [E.TASK_UPDATED]: taskAxis,
  // 재브리핑 — S4 배지가 함께 붙는다
  [E.TASK_REBRIEF_REQUIRED]: taskAxis,

  [E.BASELINE_CREATED]: (e) => [queryKeys.projectBaselines(e.project_id)],

  // 증적은 Task 상세와 커버리지 두 곳에 나타난다 — GitHub 웹훅이 붙인 PR 링크가
  // 작업 화면에 뜨지 않으면 "수집됐는지" 확인할 방법이 사람에게 없다(FR-13).
  [E.EVIDENCE_ADDED]: (e) => [
    queryKeys.task(e.subject_id),
    queryKeys.projectTasks(e.project_id),
    [...queryKeys.project(e.project_id), 'coverage'],
  ],

  // 겹침 경고는 무효화 + 경고 토스트다(토스트는 UI 계층 — E08-S01)
  [E.CLAIM_CONFLICT_WARN]: (e) => [queryKeys.projectSessions(e.project_id)],
  [E.CLAIM_CONFLICT_BLOCKED]: (e) => [queryKeys.projectSessions(e.project_id)],
  [E.CLAIM_RELEASED]: (e) => [
    queryKeys.projectTasks(e.project_id),
    queryKeys.projectSessions(e.project_id),
  ],

  [E.SESSION_STARTED]: sessionAxis,
  [E.SESSION_STALE]: sessionAxis,
  [E.SESSION_COMPLETE]: sessionAxis,
  [E.SESSION_STEERED]: sessionAxis,

  [E.APPROVAL_REQUESTED]: inboxAxis,
  [E.QUESTION_CREATED]: inboxAxis,
  [E.QUESTION_ANSWERED]: (e) => [queryKeys.inbox(), queryKeys.projectSessions(e.project_id)],

  [E.NOTIFICATION_CREATED]: () => [queryKeys.myNotifications()],

  [E.GATE_BYPASSED]: (e) => [queryKeys.projectEvents(e.project_id)],
  [E.GATE_FAILOPEN]: (e) => [queryKeys.projectEvents(e.project_id)],

  [E.IMPORT_APPLIED]: (e) => [
    queryKeys.projectSpecTree(e.project_id),
    queryKeys.projectTasks(e.project_id),
  ],
};

/**
 * **아직 화면이 없는 이벤트.** 매핑이 빠진 것과 구분하려고 이름을 적어 둔다.
 *
 * 리뷰 수집(FR-09)은 서버에 들어왔지만 S6 리뷰 센터는 아직 없다 — 무효화할 쿼리가
 * 없으니 빈 배열이 맞다. 화면이 생기는 날 이 목록에서 빠지고 `MAP` 으로 옮겨간다.
 * 목록으로 두는 이유는 하나다: **잊어서 빈 것과 알고 비운 것은 다르다.**
 */
export const NO_SCREEN_YET: readonly NervEventName[] = Object.values(NERV_EVENT_PHASE2);

/** 이 이벤트를 받으면 어떤 쿼리를 다시 읽어야 하는가. 모르는 이벤트면 빈 배열이다. */
export function invalidationKeysFor(event: NervEventEnvelope): NervQueryKey[] {
  const build = MAP[event.type];
  return build === undefined ? [] : build(event);
}

/** 매핑을 가진 이벤트 이름 목록 — 테스트와 개발 도구용. */
export function mappedEventNames(): NervEventName[] {
  return Object.keys(MAP) as NervEventName[];
}
