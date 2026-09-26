// 상태 배지 — 정본: docs/04-mvp/screens.md §4.2(상태 → 토큰 매핑) · §4.3(배지 표기 규약)
//
// 두 가지를 구조로 강제한다.
//   REQ-WEB-032  §4.2 매핑의 토큰만 쓴다 — 임의 hex 는 lint 로 막고, 여기서는 토큰 외 값을 받지 못한다
//   REQ-WEB-033  **색 단독 인코딩 금지** — label 이 필수 prop 이라 텍스트 없는 배지를 만들 수 없다

import { cn } from '../lib/utils.js';

/** 행동 축 8종(ui-wireframes §3.1) */
export type StatusToken =
  'idle' | 'action' | 'waiting' | 'agent' | 'progress' | 'ok' | 'done' | 'danger';

export const TOKEN_CLASS: Record<StatusToken, string> = {
  idle: 'bg-status-idle text-status-idle-text',
  action: 'bg-status-action-soft text-status-action',
  waiting: 'bg-status-waiting-soft text-status-waiting',
  agent: 'bg-status-agent-soft text-status-agent',
  progress: 'bg-status-progress-soft text-status-progress',
  ok: 'bg-status-ok-soft text-status-ok',
  done: 'bg-status-done-soft text-status-done',
  danger: 'bg-status-danger-soft text-status-danger',
};

export interface StatusBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  token: StatusToken;
  /** 필수다 — 색만으로 상태를 구분하지 않는다(REQ-WEB-033) */
  label: string;
  className?: string;
  /**
   * 앞의 표지 — 상태는 점(●)이 기본이다. **상태가 아닌 표지**(막는 중 · 정족수 · 우선순위)는 점 없이(`null`)
   * 또는 뜻을 가진 기호(`↑` 기준이 지나감)로 선다(2026-09-25 · SYS-07). 손으로 같은 알약을 다시 짜던 자리가 다섯이었다
   */
  mark?: string | null;
  /** 촘촘한 카드 메타 줄 안에서는 `sm` — 여백만 줄고 글자·색은 같다 */
  size?: 'md' | 'sm';
}

export function StatusBadge({
  token,
  label,
  className,
  mark = '●',
  size = 'md',
  ...rest
}: StatusBadgeProps): React.JSX.Element {
  return (
    <span
      data-badge={token}
      {...rest}
      className={cn(
        // 평평하게: 채도 낮은 배경 + 같은 계열의 글자. 테두리도 그림자도 없다.
        // 점(●)은 작게 — 배지 안에서 점이 글자만큼 크면 색이 먼저 읽히고,
        // 이 화면들은 색이 아니라 **글자**가 먼저 읽혀야 한다(REQ-WEB-033)
        // 척도로 접었다(2026-09-26 — 임의 px 장부 PR 3 · 사람 결정): 세로 2px · 가로 8px · 모서리 4px · 11px/500 ·
        // 점은 6px 원. 시안의 반 픽셀(세로 2.5 · 모서리 5)이 척도에 없어 배지가 1px 낮아졌다
        'inline-flex shrink-0 items-center gap-1 rounded-nerv-sm text-2xs leading-normal font-medium whitespace-nowrap',
        size === 'md' ? 'px-2 py-0.5' : 'px-1.5 py-0',
        TOKEN_CLASS[token],
        className,
      )}
    >
      {/* 점은 **원으로 그린다** — 글자 ● 는 크기와 기준선을 글꼴이 정해 8px 글자로 맞추던 값이었다. 원은 토큰 크기
          그대로다. 뜻 있는 기호(↑)는 글자다 */}
      {mark === '●' ? (
        <span
          aria-hidden="true"
          data-dot=""
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : (
        mark !== null && (
          <span aria-hidden="true" className="leading-none">
            {mark}
          </span>
        )
      )}
      {label}
    </span>
  );
}
