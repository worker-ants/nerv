// 세션 카드 — 정본: ui-wireframes §2.5·§3.3 · screens.md §2.6
//
// REQ-WEB-019 가 필수 표기를 못박는다: 사용자·hostname·에이전트 종류·하트비트 상대 시각·
// 리스 잔여·diff 통계. 그리고 **hostname 이 없는 세션은 렌더링하지 않는다** — "누구의 어느
// 머신인가"가 이 화면의 존재 이유(P8)라 그것을 모르는 카드는 화면에 있어선 안 된다.

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SESSION_TOKEN } from '../../components/status-token.js';
import type { StatusToken } from '../../components/status-badge.js';
import { Avatar } from '../../components/ui/primitives.js';
import { cn } from '../../lib/utils.js';
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
  const t = useT();
  // REQ-WEB-019 — hostname 없는 세션은 렌더링하지 않는다
  if (card.hostname === '') return null;

  const token: StatusToken = SESSION_TOKEN[card.state as keyof typeof SESSION_TOKEN] ?? 'idle';

  return (
    // **카드가 아니라 줄이다**(2026-08-23 재검토). 상자를 쌓으면 세션 셋이 화면 하나를
    // 채우고, 그런데도 "누가 무엇을 얼마나 오래 쥐고 있나"는 카드마다 눈을 옮겨야 읽힌다.
    // 한 줄에 고정 폭으로 늘어놓으면 세로로 훑는 것만으로 비교가 된다.
    <article
      data-testid="session-card"
      className="group flex items-center gap-3 border-b border-border px-2.5 py-3 transition-colors last:border-b-0 hover:bg-bg-hover"
    >
      <Avatar name={card.user_name} size="lg" />

      {/* 신원 3요소는 **한 덩어리**다 — 흩어 놓으면 매번 다시 모아 읽어야 한다(REQ-WEB-019) */}
      <div className="w-40 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{card.user_name}</span>
          <span className="truncate font-mono text-2xs text-text-mute">{card.hostname}</span>
        </div>
        <div className="mt-0.5 text-2xs text-text-faint">{card.agent_type}</div>
      </div>

      <div className="w-[5.5rem] shrink-0">
        <StatusBadge token={token} label={t(statusLabelKey('session', card.state))} />
      </div>

      <div className="min-w-0 flex-1">
        {card.task_key === null ? (
          <span className="text-sm text-text-faint">{t('session.no_task')}</span>
        ) : (
          <>
            <div className="truncate text-sm">{card.task_title}</div>
            <div className="mt-0.5 flex items-center gap-2 text-2xs text-text-faint">
              <span className="font-mono">{card.task_key}</span>
              {card.branch !== null && <span className="truncate font-mono">{card.branch}</span>}
              {/* 2분 미만은 호박색 — 곧 회수된다는 뜻이고, 그때 화면이 조용하면
                  사람은 작업이 사라진 이유를 모른다(REQ-WEB-017 · D-04) */}
              <span
                className={cn(
                  'font-mono tabular-nums',
                  (card.lease_remaining_seconds ?? 0) < 120 &&
                    (card.lease_remaining_seconds ?? 0) > 0
                    ? 'font-medium text-status-waiting'
                    : 'text-text-faint',
                )}
              >
                {leaseRemaining(t, card.lease_remaining_seconds)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="w-24 shrink-0 text-right">
        <div className="font-mono text-2xs tabular-nums">
          {diffStat(card.diff_added, card.diff_removed)}
        </div>
        {/* 하트비트는 **생존** 신호라 리스·경과와 뜻이 다르다(REQ-WEB-019 필수 표기).
            브랜치로 덮었다가 테스트가 잡았다 — 브랜치는 작업 줄로 옮겼다 */}
        <div className="mt-0.5 truncate text-2xs text-text-faint">
          {relativeTime(t, card.last_heartbeat_at, now)}
        </div>
      </div>

      {/* 선언 scope 는 **평소에 접어 둔다** — 줄마다 글롭이 늘어서면 다시 텍스트 벽이다.
          겹침을 읽어야 할 때는 hover 로 드러난다(REQ-WEB-019 는 표기 여부만 요구한다) */}
      {card.scope_file_globs.length > 0 && (
        <div
          className="hidden w-40 shrink-0 truncate font-mono text-2xs text-text-faint opacity-0 transition-opacity group-hover:opacity-100 xl:block"
          title={card.scope_file_globs.join('\n')}
          aria-label={t('session.scope')}
        >
          {card.scope_file_globs[0]}
          {card.scope_file_globs.length > 1 && ` +${card.scope_file_globs.length - 1}`}
        </div>
      )}

      {/* stale 은 왜 그렇게 됐는지까지 적는다(REQ-WEB-020 · D-13) — 다만 **조용하게**.
          채운 빨강 덩어리가 줄마다 서면 그 자체가 소음이 되고, 그때는 진짜 위험한 줄이
          어느 것인지 알 수 없다. 사유는 남기되 배경을 걷는다(2026-08-23 재검토). */}
      {card.state === 'stale' && (
        <span className="w-40 shrink-0 text-2xs leading-snug text-text-mute">
          {t('session.stale_note')}
        </span>
      )}
    </article>
  );
}

/** 신원 3요소의 축약형 — 좁은 화면용(§3.3) */
export function compactIdentity(card: Card): string {
  return identity(card, true);
}
