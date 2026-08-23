// 이벤트 타입 → 사람이 읽는 문구.
//
// 알림·활동 피드가 같은 문구를 써야 한다 — 한쪽은 "스펙 승인됨", 다른 쪽은 `spec.approved`
// 라고 쓰면 같은 사건이 두 사건으로 보인다.
//
// **카탈로그 전체를 덮는다.** 몇 개만 옮기면 활동 피드에 한국어와 점 표기가 섞여 나오고,
// 그 섞임이 화면을 미완성으로 보이게 한다(실측: 프로젝트 개요의 "task.claimed").
//
// 이벤트 이름은 하드코딩하지 않는다 — 카탈로그가 정본이고 이름이 바뀌면 여기가 먼저
// 깨진다(REQ-CB-006).

import { NERV_EVENT } from '@nerv/schema';

export const EVENT_LABEL: Record<string, string> = {
  // 스펙 문서 축
  [NERV_EVENT.SPEC_DRAFT_CREATED]: '스펙 초안 생성',
  [NERV_EVENT.SPEC_SUBMITTED]: '스펙 검토 요청',
  [NERV_EVENT.SPEC_REJECTED]: '스펙 거절됨',
  [NERV_EVENT.SPEC_APPROVED]: '스펙 승인됨',
  [NERV_EVENT.SPEC_SUPERSEDED]: '스펙 새 판으로 대체됨',
  [NERV_EVENT.SPEC_DEPRECATED]: '스펙 폐기됨',
  [NERV_EVENT.SPEC_COMMENT_ADDED]: '스펙 코멘트',
  [NERV_EVENT.SPEC_META_UPDATED]: '스펙 메타 변경',
  [NERV_EVENT.SPEC_ARCHIVED]: '스펙 아카이브됨',
  [NERV_EVENT.SPEC_RESTORED]: '스펙 복원됨',
  [NERV_EVENT.SPEC_RECHECK_REQUESTED]: '참조 문서 재확인 요청',
  [NERV_EVENT.COMMENT_RESOLVED]: '코멘트 해소됨',

  // 베이스라인
  [NERV_EVENT.BASELINE_CREATED]: '베이스라인 생성',

  // Task 축
  [NERV_EVENT.TASK_CREATED]: '작업 생성',
  [NERV_EVENT.TASK_UPDATED]: '작업 수정',
  [NERV_EVENT.TASK_READY]: '작업 준비됨',
  [NERV_EVENT.TASK_CLAIMED]: '작업 클레임됨',
  [NERV_EVENT.TASK_BLOCKED]: '작업이 막힘',
  [NERV_EVENT.TASK_DONE]: '작업 완료',
  [NERV_EVENT.TASK_REBRIEF_REQUIRED]: '기준 버전이 바뀌어 재브리핑 필요',

  // 클레임
  [NERV_EVENT.CLAIM_CONFLICT_WARN]: '범위 겹침 경고',
  [NERV_EVENT.CLAIM_CONFLICT_BLOCKED]: '범위 겹침으로 클레임 거부',
  [NERV_EVENT.CLAIM_RELEASED]: '클레임 반납됨',

  // 세션
  [NERV_EVENT.SESSION_STARTED]: '세션 시작',
  [NERV_EVENT.SESSION_STALE]: '세션 무응답 — 클레임 회수됨',
  [NERV_EVENT.SESSION_COMPLETE]: '세션 종료',
  [NERV_EVENT.SESSION_STEERED]: '세션에 지시 전달',

  // 사람 개입
  [NERV_EVENT.APPROVAL_REQUESTED]: '승인 요청',
  [NERV_EVENT.QUESTION_CREATED]: '에이전트 질문',
  [NERV_EVENT.QUESTION_ANSWERED]: '질문에 답변함',

  // 게이트
  [NERV_EVENT.GATE_BYPASSED]: '게이트 통과(승인 불요)',
  [NERV_EVENT.GATE_FAILOPEN]: '게이트 판정 불가 — 진행하고 기록함',

  // 증적·임포트·알림
  [NERV_EVENT.EVIDENCE_ADDED]: '증적 추가',
  [NERV_EVENT.IMPORT_APPLIED]: '임포트 적재',
  [NERV_EVENT.NOTIFICATION_CREATED]: '알림 생성',
};

/** 모르는 이벤트는 **원래 이름 그대로** 보인다 — 빈칸보다 낫다(디버깅 단서가 된다) */
export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type;
}
