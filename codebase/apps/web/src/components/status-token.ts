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
