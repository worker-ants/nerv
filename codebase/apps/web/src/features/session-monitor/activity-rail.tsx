// 활동 레일 — 세션 모니터의 오른쪽 절반(시안 Sessions · screens.md §2.6)
//
// **고른 세션의 지금을 보여 준다.** 목록에서 줄을 고르면 그 세션의 Activity 가 여기
// 흐른다 — 상세 페이지로 건너가지 않고도 "왜 멈췄나 · 무엇을 하고 있나"를 답하게 하는
// 것이 master-detail 로 바꾼 이유의 전부다. 전체 이력·클레임 이력은 상세 페이지의 몫이다.

import { useT } from '../../lib/i18n.js';
import { Link } from '@tanstack/react-router';
import { rows, useSessionTimeline } from '../../lib/queries.js';
import { Avatar, SectionLabel, Skeleton } from '../../components/ui/primitives.js';
import { SteerPanel } from './steer-panel.js';
import { relativeTime } from './format.js';
import { cn } from '../../lib/utils.js';
import type { SessionCard } from './types.js';

/** 활동 5종 → 표식·색(시안). 어휘는 D-10 의 typed Activity 그대로다 */
const MARK: Record<string, { glyph: string; tone: string }> = {
  thought: { glyph: '·', tone: 'bg-status-idle text-status-idle-text' },
  action: { glyph: '⚙', tone: 'bg-status-action-soft text-status-action' },
  elicitation: { glyph: '?', tone: 'bg-status-waiting-soft text-status-waiting' },
  response: { glyph: '↩', tone: 'bg-status-agent-soft text-status-agent' },
  error: { glyph: '!', tone: 'bg-status-danger-soft text-status-danger' },
};

export function ActivityRail({
  projectSlug,
  card,
  now = Date.now(),
}: {
  projectSlug: string;
  card: SessionCard;
  now?: number;
}): React.JSX.Element {
  const t = useT();
  const timeline = useSessionTimeline(projectSlug, card.id);
  const items = rows(timeline.data);

  return (
    <div data-testid="activity-rail" className="flex min-h-0 flex-col">
      {/* 초점 머리 — 누구의 세션을 보고 있는가 */}
      <div className="flex items-center gap-2">
        <Avatar name={card.user_name} size="md" />
        <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{card.user_name}</span>
        <span className="font-mono text-xs text-text-faint">{card.hostname}</span>
        <Link
          to="/p/$proj/sessions/$session"
          params={{ proj: projectSlug, session: card.id }}
          className="ml-auto shrink-0 text-sm text-text-faint hover:text-link"
        >
          {t('sessions.detail_link')} ↗
        </Link>
      </div>
      <div className="mt-1.5 ml-8 text-xs text-text-faint">
        {relativeTime(t, card.started_at, now)} · {card.agent_type}
      </div>

      {/* 개입은 레일에 있다 — 보고 있는 세션에 지시하는 것이 자연스러운 동선이다 */}
      <div className="mt-4">
        <SteerPanel projectSlug={projectSlug} sessionId={card.id} state={card.state} />
      </div>

      <SectionLabel className="mt-6 mb-2.5">{t('sessions.rail.activity')}</SectionLabel>
      {timeline.isLoading && <Skeleton rows={4} />}
      <ol className="min-h-0 flex-1 overflow-y-auto pl-[3px]">
        {items.map((item, i) => {
          const mark = MARK[String(item['type'])] ?? MARK['thought']!;
          return (
            <li key={String(item['id'])} className="relative flex gap-[11px]">
              {/* 표식 + 이음선 — 마지막 줄은 선을 끊는다(시안) */}
              <div className="flex w-[18px] shrink-0 flex-col items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
                    mark.tone,
                  )}
                >
                  {mark.glyph}
                </span>
                {i < items.length - 1 && <span className="min-h-2 w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pb-[13px]">
                <div className="text-sm leading-normal text-text">
                  {String(item['title'] ?? item['type'])}
                </div>
                {item['tool_name'] !== null && item['tool_name'] !== undefined && (
                  <div className="mt-[3px] font-mono text-2xs text-text-faint">
                    {String(item['tool_name'])}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {!timeline.isLoading && items.length === 0 && (
          <li className="text-sm text-text-faint">{t('session.no_activity')}</li>
        )}
      </ol>
    </div>
  );
}
