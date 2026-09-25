// 최근 활동 — 홈과 프로젝트 개요가 **같은 피드**를 그린다 (screens.md §2.2·§2.3 · REQ-WEB-210)
//
// 명세는 두 화면 모두 `EventFeed` 를 적었는데 실물이 없었다. 홈은 아바타·라벨·행위자를, 개요는
// "최근 이벤트" 라는 다른 이름과 👤/🤖 이모지로 같은 데이터를 그렸고, 둘 다 **무엇에** 일어났는지
// 말하지 않았다 — "초안 수정 · 관리자 · 16일 전" 이 여덟 줄이었다(2026-09-24 실화면). 줄은 눌리지도
// 않았다: "숫자·줄을 누르면 그것을 만든 레코드로 간다" 는 IA 의 첫 규칙이 두 화면에서 깨져 있었다.
//
// 한 줄: [사람 아바타 | AI 표식] 라벨 · **대상 키(v n)** · 제목 · 행위자 · (×N) · 시각.
// 잇달아 같은 일(같은 종류 · 같은 대상 · 같은 행위자)은 한 줄로 접고 ×N 을 누르면 펼친다.

import { eventLabelKey } from '@nerv/schema';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { relativeTime } from '../lib/format.js';
import { rows, useEventFeed } from '../lib/queries.js';
import type { ProjectId } from '../lib/query-keys.js';
import { cn } from '../lib/utils.js';
import { collapseRepeats, eventSubject, eventTarget, hrefOf } from '../lib/event-subject.js';
import type { EventRow } from '../lib/event-subject.js';
import { ErrorState, failedWithoutData } from './query-state.js';
import { Avatar, Button, EmptyState, Skeleton } from './ui/primitives.js';

export interface EventFeedProps {
  projectSlug: string;
  projectId: ProjectId | undefined;
  /** 접은 뒤 몇 줄까지 — 홈은 흐름을 따라잡는 자리라 짧게 둔다. 없으면 전부 + [더 보기] */
  max?: number;
  /** 비었을 때의 한 줄 */
  emptyText: string;
  /** 홈은 여백 있는 줄, 개요는 선으로 가른 목록 */
  variant?: 'airy' | 'ruled';
}

/** 같은 일인가 — 행위자는 이름이 아니라 id 로 가른다(동명이인을 한 줄로 접지 않게) */
const repeatKey = (e: EventRow): string =>
  [e['type'], e['subject_id'], e['actor_user_id'], e['actor_session_id']]
    .map((v) => String(v ?? ''))
    .join('|');

export function EventFeed({
  projectSlug,
  projectId,
  max,
  emptyText,
  variant = 'ruled',
}: EventFeedProps): React.JSX.Element {
  const t = useT();
  const feed = useEventFeed(projectSlug, projectId);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const items = (feed.data?.pages ?? []).flatMap((page) => rows(page.items));
  const groups = collapseRepeats(items, repeatKey);
  const shown = max === undefined ? groups : groups.slice(0, max);

  if (feed.isLoading) return <Skeleton rows={4} />;
  if (failedWithoutData(feed)) {
    return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;
  }
  if (items.length === 0) {
    return variant === 'airy' ? (
      <p className="px-2 text-sm text-text-faint">{emptyText}</p>
    ) : (
      <EmptyState icon="·" title={emptyText} action={null} />
    );
  }

  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <ul data-testid="event-feed" className="flex flex-col">
        {shown.map((group) => {
          const id = String(group.head['id']);
          const expanded = open.has(id);
          return [
            <FeedRow
              key={id}
              event={group.head}
              projectSlug={projectSlug}
              variant={variant}
              count={group.rows.length}
              expanded={expanded}
              onToggle={() => toggle(id)}
            />,
            ...(expanded
              ? group.rows
                  .slice(1)
                  .map((e) => (
                    <FeedRow
                      key={String(e['id'])}
                      event={e}
                      projectSlug={projectSlug}
                      variant={variant}
                      count={1}
                      nested
                    />
                  ))
              : []),
          ];
        })}
      </ul>
      {/* 개요는 끝까지 볼 수 있다 — 30줄에서 끝나고 더 볼 길이 없었다(HUB-07) */}
      {max === undefined && feed.hasNextPage === true && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            data-testid="event-feed-more"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {t('tasks.more')}
          </Button>
        </div>
      )}
    </>
  );
}

function FeedRow({
  event: e,
  projectSlug,
  variant,
  count,
  expanded = false,
  onToggle,
  nested = false,
}: {
  event: EventRow;
  projectSlug: string;
  variant: 'airy' | 'ruled';
  count: number;
  expanded?: boolean;
  onToggle?: () => void;
  nested?: boolean;
}): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const subject = eventSubject(e);
  // 피드의 요청(결재·질문)은 **요청이 가리키는 것**으로 간다 — 결재할 사람이 아닌 사람이 받은
  // 요청으로 가면 "없는 카드" 에 선다(eventTarget 의 `subject`)
  const href = hrefOf(eventTarget({ ...e, project_slug: projectSlug }, 'subject'));
  const actor =
    typeof e['actor_name'] === 'string' && e['actor_name'] !== '' ? e['actor_name'] : null;
  const agent = e['is_agent'] === true;
  const machine = [e['hostname'], e['agent_type']]
    .filter((v) => typeof v === 'string' && v !== '')
    .join(' · ');
  return (
    <li
      data-testid="event-row"
      className={cn(
        'flex items-center gap-2.5 text-sm',
        variant === 'airy'
          ? 'rounded-nerv px-2 py-[9px]'
          : 'border-b border-border py-1.5 last:border-0',
        nested && 'pl-8',
      )}
    >
      {/* **사람과 에이전트를 가른다**(REQ-WEB-010 · FR-16 · D-08) — 에이전트는 어느 기계의 무엇인지까지 */}
      {agent ? (
        <span
          data-testid="event-actor-agent"
          title={[actor, machine].filter((v) => v !== null && v !== '').join(' — ')}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-status-agent-soft text-2xs font-medium text-status-agent"
        >
          AI<span className="sr-only"> {t('project.actor.agent')}</span>
        </span>
      ) : actor !== null ? (
        <Avatar name={actor} size="md" />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-bg-sunken text-2xs text-text-mute"
        >
          ·
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-text">
        {t(eventLabelKey(String(e['type'])))}
        {/* 키가 링크다. 키가 없는 대상(발견 · 작업에 붙지 않은 질문)은 **제목이** 링크가 된다 */}
        {(subject.key ?? subject.title) !== null && (
          <a
            href={href}
            data-testid="event-subject"
            onClick={(ev) => {
              // 새 탭·창으로 여는 손은 막지 않는다 — 앱 안 이동만 라우터가 받는다
              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
              ev.preventDefault();
              router.history.push(href);
            }}
            className={cn(
              'ml-2 text-link hover:underline',
              subject.key !== null && 'font-mono text-xs',
            )}
          >
            {subject.key ?? subject.title}
            {subject.version !== null && ` v${String(subject.version)}`}
          </a>
        )}
        {subject.key !== null && subject.title !== null && (
          <span data-testid="event-title" className="ml-2 text-text-mute">
            {subject.title}
          </span>
        )}
        {actor !== null && <span className="text-text-faint"> · {actor}</span>}
      </span>
      {count > 1 && onToggle !== undefined && (
        <button
          type="button"
          data-testid="event-repeat"
          aria-expanded={expanded}
          aria-label={t('feed.repeat_label', { count })}
          title={t('feed.repeat_label', { count })}
          onClick={onToggle}
          className="shrink-0 rounded-nerv-sm px-1 text-xs text-text-faint tabular-nums hover:bg-bg-active hover:text-text"
        >
          {t('feed.repeat', { count })}
        </button>
      )}
      <span className="w-16 shrink-0 text-right text-xs text-text-faint">
        {relativeTime(t, typeof e['occurred_at'] === 'string' ? e['occurred_at'] : null)}
      </span>
    </li>
  );
}
