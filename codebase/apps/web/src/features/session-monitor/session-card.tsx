// 세션 카드 — 정본: ui-wireframes §2.5·§3.3 · screens.md §2.6
//
// REQ-WEB-019 가 필수 표기를 못박는다: 사용자·hostname·에이전트 종류·하트비트 상대 시각·
// 리스 잔여·diff 통계. 그리고 **hostname 이 없는 세션은 렌더링하지 않는다** — "누구의 어느
// 머신인가"가 이 화면의 존재 이유(P8)라 그것을 모르는 카드는 화면에 있어선 안 된다.

import { StatusBadge } from '../../components/status-badge.js';
import { SESSION_TOKEN } from '../../components/status-token.js';
import type { StatusToken } from '../../components/status-badge.js';
import { diffStat, identity, leaseRemaining, relativeTime } from './format.js';
import type { SessionCard as Card } from './types.js';

export interface SessionCardProps {
  card: Card;
  now?: number;
}

export function SessionCard({
  card,
  now = Date.now(),
}: SessionCardProps): React.JSX.Element | null {
  // REQ-WEB-019 — hostname 없는 세션은 렌더링하지 않는다
  if (card.hostname === '') return null;

  const token: StatusToken = SESSION_TOKEN[card.state as keyof typeof SESSION_TOKEN] ?? 'idle';

  return (
    <article
      data-testid="session-card"
      className="flex flex-col gap-2 rounded-nerv border border-border bg-bg-elev px-3 py-2.5 transition-colors hover:border-border-strong"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm">
          <span className="font-medium">{card.user_name}</span>
          <span className="text-text-faint"> · </span>
          <span className="font-mono text-xs">{card.hostname}</span>
          <span className="text-text-faint"> · </span>
          <span className="text-text-mute">{card.agent_type}</span>
        </span>
        <StatusBadge token={token} label={card.state} />
      </header>

      {card.task_key !== null && (
        <div className="truncate text-sm">
          <span className="font-mono text-xs text-text-faint">{card.task_key}</span>{' '}
          <span className="text-text-mute">{card.task_title}</span>
        </div>
      )}

      <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-faint">
        <div>
          <dt className="inline">하트비트 </dt>
          <dd className="inline">{relativeTime(card.last_heartbeat_at, now)}</dd>
        </div>
        <div>
          <dt className="inline">리스 잔여 </dt>
          <dd className="inline font-mono">{leaseRemaining(card.lease_remaining_seconds)}</dd>
        </div>
        <div>
          <dt className="inline">diff </dt>
          <dd className="inline font-mono">{diffStat(card.diff_added, card.diff_removed)}</dd>
        </div>
        {card.branch !== null && (
          <div>
            <dt className="inline">브랜치 </dt>
            <dd className="inline font-mono">{card.branch}</dd>
          </div>
        )}
      </dl>

      {/* 선언 scope — 겹침 경고를 읽으려면 무엇을 잡았는지 보여야 한다 */}
      {(card.scope_spec_ids.length > 0 || card.scope_file_globs.length > 0) && (
        <ul className="flex flex-wrap gap-1" aria-label="선언 scope">
          {card.scope_file_globs.map((glob) => (
            <li
              key={glob}
              className="rounded-nerv-sm bg-bg-sunken px-1.5 py-0.5 font-mono text-2xs text-text-mute"
            >
              {glob}
            </li>
          ))}
        </ul>
      )}

      {/* stale 은 왜 그렇게 됐는지까지 적는다(REQ-WEB-020 · D-13) */}
      {card.state === 'stale' && (
        <p className="rounded-nerv-sm bg-status-danger-soft px-2 py-1 text-xs text-status-danger">
          무활동 임계 30:00 초과 → 자동 전이. 클레임은 회수됐다.
        </p>
      )}
    </article>
  );
}

/** 신원 3요소의 축약형 — 좁은 화면용(§3.3) */
export function compactIdentity(card: Card): string {
  return identity(card, true);
}
