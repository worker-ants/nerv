// 이벤트가 **무엇에** 일어났나 — 피드와 알림이 같은 말로 대상을 적고 같은 곳으로 데려간다
// (2026-09-24 · UI/UX 검토 · REQ-WEB-210 · REQ-API-181)
//
// 홈과 개요의 활동 줄은 "초안 수정 · 관리자 · 16일 전" 만 적어 어느 스펙인지 알 수 없었고, 눌러 볼
// 수도 없었다. 알림 센터의 가장 무거운 줄(결재 요청 · 에이전트 질문)은 "승인 요청" 만 반복했다.
// 서버가 대상의 키·버전·제목을 싣고(event-subject.ts — 두 목록이 같은 조각이다), 화면은 여기 한 곳에서
// 그것을 읽는다. 알림은 이벤트 참조라 문구를 행에 굳혀 저장하지 않는다(D-10) — 링크도 여기서 만든다.

import { NERV_EVENT } from '@nerv/schema';

export type EventRow = Record<string, unknown>;

/** 데려갈 곳 — 경로와 **뷰 상태**(ui-wireframes §1.4: "승인 요청 알림에 그대로 붙는다") */
export interface EventTarget {
  to: string;
  search?: Record<string, string>;
}

export interface EventSubject {
  /** Mono 로 적는 키 — 스펙·작업 키, 없으면 리뷰 브랜치 · 세션의 기계 */
  key: string | null;
  /** 스펙 버전 번호 — 대상이 스펙 버전일 때만 */
  version: number | null;
  /** 사람이 읽는 이름 — 질문·발견은 **그 제목**이 먼저다(작업 키는 그 곁의 맥락이다) */
  title: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** 피드는 `type`, 알림은 `event_type` 으로 싣는다 */
export function eventType(n: EventRow): string {
  return String(n['event_type'] ?? n['type'] ?? '');
}

export function eventSubject(n: EventRow): EventSubject {
  const spec = text(n['spec_key']);
  const task = text(n['task_key']);
  const key = spec ?? task ?? text(n['review_branch']) ?? text(n['session_hostname']);
  const version = Number(n['version_no']);
  const title =
    text(n['question_title']) ??
    text(n['finding_title']) ??
    (spec !== null ? text(n['spec_title']) : text(n['task_title']));
  return {
    key,
    version: spec !== null && Number.isInteger(version) && version > 0 ? version : null,
    // 제목이 키와 같으면 두 번 적지 않는다(임포트한 문서는 제목이 비면 키를 제목으로 쓴다)
    title: title === key ? null : title,
  };
}

/**
 * 이벤트 → 대상. 대상이 사라졌거나 모르는 종류면 프로젝트 개요로 보낸다 — 막다른 길을 만들지
 * 않는다(§1.5).
 *
 * **요청(결재·질문)을 어디로 보낼지**는 목록이 정한다. 알림은 내게 온 요청이라 그 카드로 간다
 * (`inbox` — REQ-WEB-204). 피드는 프로젝트의 흐름이라 **요청이 가리키는 것**(결재할 스펙 버전·플랜의
 * 작업·내릴 발견)으로 간다(`subject`) — 결재할 사람이 아닌 사람이 받은 요청으로 가면 "없는 카드" 에 선다.
 */
export function eventTarget(n: EventRow, requests: 'inbox' | 'subject' = 'inbox'): EventTarget {
  const project = text(n['project_slug']);
  if (project === null) return { to: '/' };
  const type = eventType(n);
  const isRequest = type.startsWith('approval.') || type.startsWith('question.');
  const inbox = (): EventTarget => {
    const subject = text(n['subject_id']);
    return subject === null ? { to: '/inbox' } : { to: '/inbox', search: { focus: subject } };
  };
  // **그 카드로 간다**(REQ-WEB-204). 맨 `/inbox` 는 첫 카드에 서서, 사람은 방금 누른 요청을
  // 목록에서 다시 찾아야 했다. 이미 처리된 요청이면 받은 요청이 그렇다고 말한다
  if (isRequest && requests === 'inbox') return inbox();
  const spec = text(n['spec_key']);
  if (spec !== null) return { to: `/p/${project}/specs/${spec}`, ...specView(n, type) };
  const task = text(n['task_key']);
  if (task !== null) return { to: `/p/${project}/tasks/${task}` };
  const finding = text(n['finding_id']);
  if (finding !== null) return { to: `/p/${project}/reviews`, search: { finding } };
  const branch = text(n['review_branch']);
  if (branch !== null) return { to: `/p/${project}/reviews`, search: { branch } };
  const subject = text(n['subject_id']);
  if (n['subject_type'] === 'agent_session' && subject !== null) {
    return { to: `/p/${project}/sessions/${subject}` };
  }
  if (isRequest) return inbox();
  if (type.startsWith('session.') || type.startsWith('claim.')) {
    return { to: `/p/${project}/sessions` };
  }
  // 초대를 거절했다 — 부른 사람이 보는 초대 탭으로(REQ-API-178 · REQ-WEB-242). 다시 부를지 거기서 정한다
  if (type === NERV_EVENT.INVITATION_DECLINED) {
    return { to: '/settings/members', search: { tab: 'invites' } };
  }
  return { to: `/p/${project}` };
}

/**
 * 스펙 이벤트가 열어야 하는 **자리**(REQ-WEB-163 — 알림 센터에서 옮겨 왔다).
 *
 * `spec.comment_added` 는 **두 곳에서 난다**. 갈라 주는 것은 `subject_type` 이다:
 *   - `spec`         — 본문에 달린 코멘트(`spec_comment` 행이 있다) → 코멘트 레일
 *   - `spec_version` — 리뷰 결정 "코멘트"(문서를 draft 로 되돌린다). **행이 없다** —
 *                      코멘트는 이벤트 payload 에만 있으므로 레일을 열면 **빈 목록**이다.
 *                      그 알림이 데려가야 하는 곳은 되돌아온 문서 자신이다.
 *
 * 그 밖의 스펙 버전 이벤트(승인·반려 · 결재 요청)는 직전 버전과의 diff 로 간다. v1 은 이전이
 * 없으니 본문이 곧 그 버전이라 아무것도 붙이지 않는다 — 뜻 없는 인자를 주소에 남기지 않는다.
 * 버전이 없는 이벤트(재검토 요청은 subject 가 `spec` 이다)도 본문이다.
 */
function specView(n: EventRow, type: string): { search?: Record<string, string> } {
  if (type === NERV_EVENT.SPEC_COMMENT_ADDED) {
    return n['subject_type'] === 'spec' ? { search: { rail: 'comments' } } : {};
  }
  const version = Number(n['version_no']);
  if (!Number.isInteger(version) || version < 2) return {};
  return { search: { diff: `v${String(version - 1)}..v${String(version)}` } };
}

/** 경로 + 뷰 상태 → 주소 한 줄 */
export function hrefOf(target: EventTarget): string {
  return target.search === undefined
    ? target.to
    : `${target.to}?${new URLSearchParams(target.search).toString()}`;
}

export interface EventGroup<T> {
  /** 무리의 **가장 최근** 줄 — 목록이 최신순이라 첫 줄이다 */
  head: T;
  rows: T[];
}

/**
 * **잇달아 같은 것은 한 줄로 접는다**(HUB-07). 에이전트는 초안을 저장할 때마다 `spec.draft_updated`
 * 를 내서, 홈의 여덟 줄이 "초안 수정 · 도현 · 3분 전" 으로 채워졌다 — 여덟 번째 줄을 보려고 일곱을
 * 읽게 하는 목록은 흐름을 따라잡는 자리가 못 된다. 떨어져 있는 같은 일은 접지 않는다: 그 사이에
 * 다른 일이 있었다는 것 자체가 흐름이다.
 *
 * 대상을 모르는 줄(`subject_id` 가 없다)은 접지 않는다 — "모름" 둘은 같은 대상이 아니다.
 */
export function collapseRepeats<T extends EventRow>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): EventGroup<T>[] {
  const groups: EventGroup<T>[] = [];
  let lastKey: string | null = null;
  for (const row of rows) {
    const known = typeof row['subject_id'] === 'string' && row['subject_id'] !== '';
    const key = known ? keyOf(row) : null;
    const last = groups.at(-1);
    if (last !== undefined && key !== null && key === lastKey) last.rows.push(row);
    else groups.push({ head: row, rows: [row] });
    lastKey = key;
  }
  return groups;
}
