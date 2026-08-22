// 상태 배지 — 정본: docs/04-mvp/screens.md §4.2(상태 → 토큰 매핑) · §4.3(배지 표기 규약)
//
// 두 가지를 구조로 강제한다.
//   REQ-WEB-032  §4.2 매핑의 토큰만 쓴다 — 임의 hex 는 lint 로 막고, 여기서는 토큰 외 값을 받지 못한다
//   REQ-WEB-033  **색 단독 인코딩 금지** — label 이 필수 prop 이라 텍스트 없는 배지를 만들 수 없다

import { cn } from '../lib/utils.js';

/** 행동 축 8종(ui-wireframes §3.1) */
export type StatusToken =
  'idle' | 'action' | 'waiting' | 'agent' | 'progress' | 'ok' | 'done' | 'danger';

const TOKEN_CLASS: Record<StatusToken, string> = {
  idle: 'bg-status-idle text-status-idle-text',
  action: 'bg-status-action-soft text-status-action',
  waiting: 'bg-status-waiting-soft text-status-waiting',
  agent: 'bg-status-agent-soft text-status-agent',
  progress: 'bg-status-progress-soft text-status-progress',
  ok: 'bg-status-ok-soft text-status-ok',
  done: 'bg-status-done-soft text-status-done',
  danger: 'bg-status-danger-soft text-status-danger',
};

export interface StatusBadgeProps {
  token: StatusToken;
  /** 필수다 — 색만으로 상태를 구분하지 않는다(REQ-WEB-033) */
  label: string;
  className?: string;
}

export function StatusBadge({ token, label, className }: StatusBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TOKEN_CLASS[token],
        className,
      )}
    >
      <span aria-hidden="true">●</span>
      {label}
    </span>
  );
}
