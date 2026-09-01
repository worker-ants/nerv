// 활동 레일 — 세션 모니터의 오른쪽 절반(시안 Sessions · screens.md §2.6)
//
// **2026-09-01 — "Bash / Bash" 를 383번 반복하던 자리다**(사람 보고). 원인은 화면이 아니라
// 적재였다: `title = tool_name` 이라 도구 이름만 남았고 성패도 몰랐다. 서버가 이제 한 줄
// 요약과 원문을 함께 주므로(REQ-API-065 · REQ-WEB-123) 여기서 할 일은 셋이다 —
// **묶고**(같은 도구 연속), **실패를 튀게 하고**, **펼치면 원문**.
//
// **고른 세션의 지금을 보여 준다.** 목록에서 줄을 고르면 그 세션의 Activity 가 여기
// 흐른다 — 상세 페이지로 건너가지 않고도 "왜 멈췄나 · 무엇을 하고 있나"를 답하게 하는
// 것이 master-detail 로 바꾼 이유의 전부다. 전체 이력·클레임 이력은 상세 페이지의 몫이다.

import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { Link } from '@tanstack/react-router';
import { eventLabelKey } from '@nerv/schema';
import { rows, useSessionTimeline, useSessionTrajectory } from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
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
  const groups = groupRuns(items);
  const trajectory = useSessionTrajectory(projectSlug, card.id);
  const [open, setOpen] = useState<string | null>(null);

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

      {/* **위에는 한 일, 아래에 도구 로그**(2026-09-01 · REQ-WEB-124). 이 화면의 첫 물음은
          "무슨 도구를 썼나" 가 아니라 "무엇을 하는 중이고 막혀 있나" 다 — 도구 로그가
          첫 화면일 이유가 없다. 궤적은 새 저장 없이 이벤트를 세션 축으로 읽은 것이다. */}
      <SectionLabel className="mt-6 mb-2.5">{t('sessions.rail.trajectory')}</SectionLabel>
      <ol className="mb-2 flex flex-col gap-1.5">
        {rows(trajectory.data).map((step) => (
          <li key={String(step['id'])} className="flex items-baseline gap-2 text-sm">
            <span aria-hidden="true" className="shrink-0 text-2xs text-text-faint">
              ├
            </span>
            <span className="min-w-0 flex-1 text-text-mute">
              {t(eventLabelKey(String(step['type'])))}
              {typeof step['subject_key'] === 'string' && step['subject_key'] !== '' && (
                <span className="ml-1.5 font-mono text-2xs text-text">
                  {String(step['subject_key'])}
                </span>
              )}
            </span>
            <span className="shrink-0 text-2xs text-text-faint">
              {relativeTime(t, str(step['occurred_at']), now)}
            </span>
          </li>
        ))}
        {trajectory.data !== undefined && rows(trajectory.data).length === 0 && (
          <li className="text-sm text-text-faint">{t('session.no_trajectory')}</li>
        )}
      </ol>

      <SectionLabel className="mt-4 mb-2.5">{t('sessions.rail.activity')}</SectionLabel>
      {timeline.isLoading && <Skeleton rows={4} />}
      <ol className="min-h-0 flex-1 overflow-y-auto pl-[3px]">
        {groups.map((group, i) => (
          <ActivityRow
            key={group.key}
            group={group}
            last={i === groups.length - 1}
            expanded={open === group.key}
            onToggle={() => setOpen(open === group.key ? null : group.key)}
          />
        ))}
        {!timeline.isLoading && items.length === 0 && (
          <li className="text-sm text-text-faint">{t('session.no_activity')}</li>
        )}
      </ol>
    </div>
  );
}

/** 한 줄에 담기는 것 — 활동 하나이거나, 같은 도구가 연달아 난 묶음이다 */
export interface ActivityGroup {
  key: string;
  items: Row[];
  toolName: string | null;
}

/**
 * 같은 도구가 연달아 나면 묶는다 — 383건 중 대부분이 연속 Bash 였다.
 *
 * **시간이 아니라 연속으로 묶는다**: 사이에 다른 도구가 끼면 그건 다른 국면이고, 묶어
 * 버리면 "무엇을 하다가 무엇으로 넘어갔나" 가 사라진다.
 */
export function groupRuns(items: readonly Row[]): ActivityGroup[] {
  const out: ActivityGroup[] = [];
  for (const item of items) {
    const tool = typeof item['tool_name'] === 'string' ? item['tool_name'] : null;
    const last = out[out.length - 1];
    // 실패는 묶지 않는다 — 묶음 안에 숨으면 눈에 띄라고 만든 표시가 뜻을 잃는다
    const failed = payloadOf(item)['ok'] === false;
    if (
      last !== undefined &&
      tool !== null &&
      last.toolName === tool &&
      !failed &&
      !hasFailure(last)
    ) {
      last.items.push(item);
      continue;
    }
    out.push({ key: String(item['id']), items: [item], toolName: tool });
  }
  return out;
}

function hasFailure(group: ActivityGroup): boolean {
  return group.items.some((item) => payloadOf(item)['ok'] === false);
}

function payloadOf(item: Row): Record<string, unknown> {
  const payload = item['payload'];
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

/** 원문 — 서버가 권한을 보고 내려준 것만 있다(REQ-API-066). 없으면 그 사실을 적는다 */
function rawOf(item: Row): string | null {
  const payload = payloadOf(item);
  if (payload['tool_input'] === undefined && payload['tool_response'] === undefined) return null;
  return JSON.stringify(
    { tool_input: payload['tool_input'], tool_response: payload['tool_response'] },
    null,
    2,
  );
}

function ActivityRow({
  group,
  last,
  expanded,
  onToggle,
}: {
  group: ActivityGroup;
  last: boolean;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const t = useT();
  const head = group.items[0]!;
  const mark = MARK[String(head['type'])] ?? MARK['thought']!;
  const payload = payloadOf(head);
  const failed = payload['ok'] === false;
  const raw = rawOf(head);
  const runs = group.items.length;

  return (
    <li className="relative flex gap-[11px]" data-testid="activity-row">
      <div className="flex w-[18px] shrink-0 flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
            failed ? MARK['error']!.tone : mark.tone,
          )}
        >
          {failed ? '!' : mark.glyph}
        </span>
        {!last && <span className="min-h-2 w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-[13px]">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 text-sm leading-normal',
              failed ? 'text-status-danger' : 'text-text',
            )}
          >
            {String(head['title'] ?? head['type'])}
            {/* 묶음은 **몇 번인지** 적는다 — 수를 감추면 "한 번 했다" 로 읽힌다 */}
            {runs > 1 && (
              <span data-testid="run-count" className="ml-1.5 text-2xs text-text-faint">
                × {runs}
              </span>
            )}
          </span>
          {typeof payload['outcome'] === 'string' && (
            <span data-testid="activity-outcome" className="shrink-0 text-2xs text-status-danger">
              {String(payload['outcome'])}
            </span>
          )}
          {raw !== null && (
            <button
              type="button"
              data-testid="activity-toggle"
              aria-expanded={expanded}
              onClick={onToggle}
              className="shrink-0 text-2xs text-text-faint hover:text-text"
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
        </div>
        {/* 원문 — 접힘이 기본이다. 383건이 다 펼쳐지면 지금보다 나쁘다 */}
        {expanded && raw !== null && (
          <pre
            data-testid="activity-raw"
            className="mt-1.5 max-h-72 overflow-auto rounded-nerv-sm bg-code-bg p-2 font-mono text-2xs whitespace-pre-wrap text-code-text"
          >
            {raw}
          </pre>
        )}
        {expanded && raw === null && (
          <p className="mt-1.5 text-2xs text-text-faint">{t('session.raw_hidden')}</p>
        )}
      </div>
    </li>
  );
}

/** 문자열만 — 시각 필드는 없을 수 있다 */
function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
