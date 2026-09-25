// 엔티티 상태 → 토큰 배정 — 정본: docs/04-mvp/screens.md §4.2
//
// "엔티티마다 색을 새로 정하지 않는다"가 규칙이다(같은 절). 이 표가 ui-wireframes §3.1 을
// 토큰 이름으로 옮긴 것이고, 화면은 여기를 거쳐서만 색을 고른다.

import type { StatusToken } from './status-badge.js';

export const SPEC_VERSION_TOKEN = {
  draft: 'idle',
  in_review: 'waiting',
  approved: 'ok',
  superseded: 'idle',
  deprecated: 'danger',
} as const satisfies Record<string, StatusToken>;

export const REQUIREMENT_TOKEN = {
  unimplemented: 'idle',
  in_progress: 'progress',
  implemented: 'done',
  verified: 'ok',
} as const satisfies Record<string, StatusToken>;

export const TASK_TOKEN = {
  backlog: 'idle',
  ready: 'action',
  claimed: 'agent',
  in_progress: 'progress',
  in_review: 'waiting',
  done: 'done',
  blocked: 'danger',
} as const satisfies Record<string, StatusToken>;

export const SESSION_TOKEN = {
  pending: 'idle',
  active: 'ok',
  awaiting_input: 'waiting',
  complete: 'done',
  error: 'danger',
  stale: 'danger',
} as const satisfies Record<string, StatusToken>;

export const SEVERITY_TOKEN = {
  info: 'progress',
  warning: 'waiting',
  critical: 'danger',
} as const satisfies Record<string, StatusToken>;

/**
 * **맨 점의 색** — 토큰의 진한 쪽이다(2026-09-25 · UI/UX 검토 SYS-07). 배지는 옅은 칠 + 같은 계열 글자인데, 배경이
 * 없는 점에는 진한 값이 필요하다. 레인 점과 세션 요약 줄의 점이 각자 표를 들고 있어서 같은 `stale` 이 요약 줄에서는
 * 회색, 바로 옆 세션 카드의 배지에서는 빨강이었다(ui-wireframes 가 stale 을 적색으로 정한 까닭이 있다) — 점은
 * **엔티티 → 토큰 → 점** 한 길로만 고른다.
 */
export const STATUS_DOT = {
  idle: 'bg-status-idle-text',
  action: 'bg-status-action',
  waiting: 'bg-status-waiting',
  agent: 'bg-status-agent',
  progress: 'bg-status-progress',
  ok: 'bg-status-ok',
  done: 'bg-status-done',
  danger: 'bg-status-danger',
} as const satisfies Record<StatusToken, string>;

/** 엔티티의 값 → 점 색. 매핑 밖의 값은 idle 의 점이다(조용히 사라지는 칸을 만들지 않는다) */
export function statusDot(map: Readonly<Record<string, StatusToken>>, value: string): string {
  return STATUS_DOT[map[value] ?? 'idle'];
}
