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
const P2 = NERV_EVENT_PHASE2;

/** subject_id 를 그 이벤트의 주체 키로 해석하는 규칙(§1.4 표의 두 번째 열). */
type KeyBuilder = (e: NervEventEnvelope) => NervQueryKey[];

/**
 * 스펙 축 — **키로 잡는다**(2026-08-29 정정).
 *
 * 화면의 쿼리 키는 고정 ID(스펙 키)인데 봉투의 `subject_id` 는 버전·스펙 UUID 라
 * 축이 달랐다. `['spec', <버전UUID>]` 를 무효화해도 `['spec','SPC-CWC-007']` 에는 닿지
 * 않는다 — 그래서 상세 화면이 **한 번도** 다시 읽히지 않았다. 서버가 `subject_key` 를
 * 싣게 됐으므로(api.md §3.3) 그것을 쓰고, 없으면 예전대로 id 로 떨어진다.
 */
const specAxis: KeyBuilder = (e) => {
  const ref = e.subject_key ?? e.subject_id;
  return [
    queryKeys.spec(ref),
    queryKeys.specVersions(ref),
    queryKeys.projectSpecTree(e.project_id),
    // 표·그래프(EP-SPEC-19)도 스펙이 생기거나 승인되면 낡는다 — 어떤 이벤트에도
    // 걸려 있지 않아 새로고침 전까지 옛 그림을 보여 주고 있었다
    queryKeys.projectSpecGraph(e.project_id),
  ];
};
// 코멘트·Task 도 **같은 축**이다(2026-09-02). 스펙 축만 2026-08-29 에 고정 ID로 옮겼고
// 나머지는 UUID 로 남아 있었다 — 화면의 키는 고정 ID라 코멘트가 달려도, Task 가 done 이
// 돼도 단건 캐시는 한 번도 무효화되지 않았다(서버가 그 이벤트에 키를 싣게 됐다).
const specComments: KeyBuilder = (e) => [queryKeys.specComments(e.subject_key ?? e.subject_id)];
const taskAxis: KeyBuilder = (e) => [
  queryKeys.projectTasks(e.project_id),
  queryKeys.task(e.subject_key ?? e.subject_id),
];
const sessionAxis: KeyBuilder = (e) => [
  queryKeys.projectSessions(e.project_id),
  queryKeys.session(e.subject_id),
];
const inboxAxis: KeyBuilder = () => [queryKeys.inbox()];

const MAP: Partial<Record<NervEventName, KeyBuilder>> = {
  [E.SPEC_DRAFT_CREATED]: specAxis,
  [E.SPEC_DRAFT_UPDATED]: specAxis,
  [E.SPEC_SUBMITTED]: specAxis,
  [E.SPEC_REJECTED]: specAxis,
  [E.SPEC_APPROVED]: specAxis,
  [E.SPEC_SUPERSEDED]: specAxis,
  [E.SPEC_DEPRECATED]: specAxis,
  [E.SPEC_META_UPDATED]: specAxis,
  [E.SPEC_ARCHIVED]: specAxis,
  [E.SPEC_RESTORED]: specAxis,
  // 참조 전파 — S3 참조 갱신 배지가 함께 붙는다
  [E.SPEC_RECHECK_REQUESTED]: (e) => [queryKeys.spec(e.subject_key ?? e.subject_id)],

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
    queryKeys.task(e.subject_key ?? e.subject_id),
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
  // 취소도 답변과 같은 자리를 바꾼다 — 수신함에서 사라지고, 기다리던 세션이 깨어난다
  [E.QUESTION_CANCELLED]: (e) => [queryKeys.inbox(), queryKeys.projectSessions(e.project_id)],

  // **받은 요청도 함께 되읽는다.** 이 이벤트는 개인 룸으로 오는 유일한 방송이고(api.md §3.3),
  // 다른 프로젝트 화면에 있는 사람에게는 승인 요청·질문이 닿는 유일한 길이다 — 종만
  // 갱신하면 숫자는 늘어나는데 목록은 그대로다.
  [E.NOTIFICATION_CREATED]: () => [queryKeys.myNotifications(), queryKeys.inbox()],

  [E.GATE_BYPASSED]: (e) => [queryKeys.projectEvents(e.project_id)],
  [E.GATE_FAILOPEN]: (e) => [queryKeys.projectEvents(e.project_id)],

  [E.IMPORT_APPLIED]: (e) => [
    queryKeys.projectSpecTree(e.project_id),
    queryKeys.projectTasks(e.project_id),
  ],

  // S6 리뷰 센터(2026-08-23) — 큐와 게이트 현황은 같은 사실의 두 얼굴이라 함께 무효화한다.
  // 큐만 갱신하면 "열린 것 0건"인데 판정은 `pending` 인 화면이 남는다(REQ-WEB-066).
  // 라운드가 들어오면 큐도 게이트도 바뀐다 — 새 발견이 0건이어도 그렇다(2026-08-30)
  [P2.REVIEW_SUBMITTED]: (e) => [
    queryKeys.projectFindings(e.project_id),
    queryKeys.projectGateCoverage(e.project_id),
  ],
  [P2.FINDING_OPENED]: (e) => [
    queryKeys.projectFindings(e.project_id),
    queryKeys.projectGateCoverage(e.project_id),
  ],
  // 코멘트는 큐의 수를 바꾸지 않는다 — 레일이 편 대화만 다시 읽는다(2026-08-30)
  [P2.FINDING_COMMENTED]: (e) => [['finding', e.subject_id, 'comments']],
  [P2.FINDING_RESOLVED]: (e) => [
    queryKeys.projectFindings(e.project_id),
    queryKeys.projectGateCoverage(e.project_id),
  ],
};

/**
 * **아직 화면이 없는 이벤트.** 매핑이 빠진 것과 구분하려고 이름을 적어 둔다.
 *
 * 목록으로 두는 이유는 하나다: **잊어서 빈 것과 알고 비운 것은 다르다.**
 * `finding.*` 는 2026-08-23 S6 리뷰 센터가 생기면서 여기서 빠지고 `MAP` 으로 옮겨갔다 —
 * 남은 것은 `cr.opened` 뿐이고, CR 델타 화면(FR-04)은 Phase 2 의 다른 조각이다.
 */
export const NO_SCREEN_YET: readonly NervEventName[] = [P2.CR_OPENED];

/** 이 이벤트를 받으면 어떤 쿼리를 다시 읽어야 하는가. 모르는 이벤트면 빈 배열이다. */
export function invalidationKeysFor(event: NervEventEnvelope): NervQueryKey[] {
  const build = MAP[event.type];
  return build === undefined ? [] : build(event);
}

/** 매핑을 가진 이벤트 이름 목록 — 테스트와 개발 도구용. */
export function mappedEventNames(): NervEventName[] {
  return Object.keys(MAP) as NervEventName[];
}
