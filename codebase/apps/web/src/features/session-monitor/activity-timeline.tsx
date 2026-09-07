// 세션의 활동 — **레일과 상세가 같은 것을 그린다**(2026-09-07 · REQ-WEB-141·142)
//
// 이 파일이 생긴 이유는 하나다: 같은 화면 요소가 두 벌이었다. 세션 모니터의 레일에는
// **묶기 · 실패 강조 · 원문 펼침 · 잘림 표시**가 있었는데, 세션 상세(`/p/:proj/sessions/:sid`)는
// 자기만의 단순 목록을 그려 그 넷이 전부 없었다. 화면이 좁을 때 레일은 접히고 사람은
// 상세로 들어가라는 안내를 받는데(매뉴얼 "세션" 장), **거기 도착하면 더 못 보는 화면**이
// 있었다는 뜻이다. 명세는 처음부터 이것을 `ActivityTimeline` 하나로 불렀다(§2.6).
//
// **여기 담는 것은 목록뿐이다.** 소제목은 부르는 쪽이 그린다 — 레일은 `SectionLabel`,
// 상세는 `SectionTitle` 이고 그 차이는 화면의 성질이지 이 목록의 성질이 아니다.

import { useState } from 'react';
import { eventLabelKey } from '@nerv/schema';
import {
  flatTimeline,
  rows,
  useSessionTimelinePages,
  useSessionTrajectory,
} from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
import { useT } from '../../lib/i18n.js';
import { Button, Skeleton } from '../../components/ui/primitives.js';
import { relativeTime } from './format.js';
import { cn } from '../../lib/utils.js';

/** 활동 5종 → 표식·색(시안). 어휘는 D-10 의 typed Activity 그대로다 */
const MARK: Record<string, { glyph: string; tone: string }> = {
  thought: { glyph: '·', tone: 'bg-status-idle text-status-idle-text' },
  action: { glyph: '⚙', tone: 'bg-status-action-soft text-status-action' },
  elicitation: { glyph: '?', tone: 'bg-status-waiting-soft text-status-waiting' },
  response: { glyph: '↩', tone: 'bg-status-agent-soft text-status-agent' },
  error: { glyph: '!', tone: 'bg-status-danger-soft text-status-danger' },
};

/**
 * 활동 목록 — 커서로 이어 받는다.
 *
 * **[더 보기]는 목록 맨 위다.** 이어 받는 쪽이 과거이기 때문이다 — 아래에 두면 누른
 * 결과가 화면 밖 위쪽에 나타나 "아무 일도 없었다" 로 보인다.
 */
export function ActivityTimeline({
  projectSlug,
  sessionId,
  className,
}: {
  projectSlug: string;
  sessionId: string;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const timeline = useSessionTimelinePages(projectSlug, sessionId);
  const items = flatTimeline(timeline.data);
  const groups = groupRuns(items);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      {timeline.isLoading && <Skeleton rows={4} />}
      <ol className={cn('min-h-0 pl-[3px]', className)}>
        {/* **잘렸다고 말만 하지 않는다**(2026-09-07). 예전에는 "앞쪽 활동이 더 있습니다"
            한 줄이었고, 그 줄을 읽은 사람에게 갈 길이 없었다 — 443건 세션의 초반은
            표시가 생긴 뒤에도 여전히 닿지 않는 곳이었다. */}
        {timeline.hasNextPage === true && (
          <li className="pb-2">
            <Button
              size="sm"
              variant="ghost"
              data-testid="timeline-load-more"
              disabled={timeline.isFetchingNextPage}
              onClick={() => void timeline.fetchNextPage()}
            >
              {t('session.timeline_more')}
            </Button>
          </li>
        )}
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
    </>
  );
}

/**
 * 작업 궤적 — 도구 로그가 아니라 **한 일**이다(REQ-API-068 · REQ-WEB-124).
 *
 * 레일이 이것을 활동 위에 세운 이유가 상세에서도 그대로다: 이 화면의 첫 물음은
 * "무슨 도구를 썼나" 가 아니라 "무엇을 하는 중이고 막혀 있나" 다.
 */
export function SessionTrajectory({
  projectSlug,
  sessionId,
  now = Date.now(),
  className,
}: {
  projectSlug: string;
  sessionId: string;
  now?: number;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const trajectory = useSessionTrajectory(projectSlug, sessionId);

  return (
    <ol className={cn('flex flex-col gap-1.5', className)} data-testid="session-trajectory">
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
