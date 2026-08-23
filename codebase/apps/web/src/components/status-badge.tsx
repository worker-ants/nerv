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
        // 평평하게: 채도 낮은 배경 + 같은 계열의 글자. 테두리도 그림자도 없다.
        // 점(●)은 작게 — 배지 안에서 점이 글자만큼 크면 색이 먼저 읽히고,
        // 이 화면들은 색이 아니라 **글자**가 먼저 읽혀야 한다(REQ-WEB-033)
        'inline-flex shrink-0 items-center gap-1 rounded-nerv-sm px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap',
        TOKEN_CLASS[token],
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.6em] leading-none">
        ●
      </span>
      {label}
    </span>
  );
}
