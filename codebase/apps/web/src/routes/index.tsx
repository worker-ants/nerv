// / → S1 홈 대시보드 (ui-wireframes §2.1 · screens.md §2.2 · 시안 Home)
//
// **사람이 결정해야 하는 것만.** 인사말이 밀린 결정 수를 바로 말하고(시안 — "결정 N건이
// 밀려 있어요"), 오늘 할 일은 카드 격자가 아니라 **한 줄기 목록**이다. 카드 상자를 쌓으면
// 셋 다 같은 무게로 읽히고, 정작 "지금 나를 기다리는 게 몇 건인가"는 상자를 다 본 뒤에야
// 답이 나온다. 그 아래는 최근 활동과 프로젝트 상태 — 결정이 끝난 사람이 훑는 것들이다.

import { eventLabelKey } from '@nerv/schema';
import { useLocale, useT } from '../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { relativeTime } from '../lib/format.js';
import { rows, useCoverage, useEvents, useInbox, useMe } from '../lib/queries.js';
import { useScope } from '../lib/scope.js';
import { cn } from '../lib/utils.js';
import { Avatar, EmptyState, SectionLabel, Skeleton } from '../components/ui/primitives.js';

export const Route = createFileRoute('/')({ component: HomeScreen });

function HomeScreen(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const me = useMe();
  const inbox = useInbox();
  // 홈은 조직 전역이지만 활동·커버리지는 프로젝트의 것이다. **헤더가 고른 그 프로젝트**를
  // 보여 준다(scope.ts) — 홈이 첫 프로젝트를, 헤더가 마지막으로 본 프로젝트를 가리키면
  // 같은 화면의 두 자리가 서로 다른 프로젝트를 말하게 된다.
  const scope = useScope();
  const primary = scope.project;
  const primarySlug = scope.projectSlug ?? '';
  const primaryId = typeof primary?.['id'] === 'string' ? primary['id'] : undefined;
  const events = useEvents(primarySlug, primaryId);
  const coverage = useCoverage(primarySlug, primaryId);

  const cards = rows(inbox.data);
  const today = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'full',
  }).format(new Date());
  const name = me.data?.display_name ?? '';
  const totals = (coverage.data?.['totals'] ?? {}) as Record<string, number | null>;
  const reqTotal = Number(totals['total'] ?? 0);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-10 pt-11 pb-10">
      {/* 날짜 → 인사말. 인사말이 곧 요약이다 — 결정이 없으면 그렇게 말한다 */}
      <div className="text-sm text-text-faint">{today}</div>
      <h1 className="mt-2 text-[1.9375rem] leading-[1.18] font-bold tracking-[-0.026em]">
        {me.data === undefined
          ? t('home.title_anon')
          : cards.length === 0
            ? t('home.greeting_clear', { name })
            : t('home.greeting_pending', { name, count: cards.length })}
      </h1>

      <section className="mt-8" data-testid="today-strip">
        <div className="mb-1 flex items-baseline gap-[9px]">
          <span className="text-lg font-[650] tracking-[-0.012em]">{t('home.waiting_on_you')}</span>
          {cards.length > 0 && (
            <span className="text-sm text-text-faint">
              {t('home.waiting_count', { count: cards.length })}
            </span>
          )}
        </div>

        {inbox.isLoading && <Skeleton rows={2} />}
        {!inbox.isLoading && cards.length === 0 && (
          <EmptyState
            icon="✓"
            title={t('home.nothing_waiting')}
            hint={
              <Link to="/inbox" search={{ state: 'decided' }} className="text-link hover:underline">
                {t('home.see_decided')}
              </Link>
            }
          />
        )}
        <ul>
          {cards.slice(0, 5).map((card) => (
            <TodoRow key={String(card['id'])} card={card} />
          ))}
        </ul>
        {cards.length > 5 && (
          <Link to="/inbox" className="mt-2 inline-block text-sm text-text-faint hover:text-link">
            {t('home.inbox_all', { count: cards.length })}
          </Link>
        )}
      </section>

      <div className="mt-[38px] flex flex-col gap-10 md:flex-row md:gap-11">
        {/* 최근 활동 — 결정을 끝낸 사람이 흐름을 따라잡는 곳 */}
        <section className="min-w-0 flex-1">
          <div className="mb-2.5 text-lg font-[650] tracking-[-0.012em]">
            {t('home.recent_activity')}
          </div>
          {events.isLoading && <Skeleton rows={4} />}
          <ul>
            {rows(events.data)
              .slice(0, 8)
              .map((e) => (
                <li
                  key={String(e['id'])}
                  className="flex items-start gap-2.5 rounded-nerv px-2 py-[9px]"
                >
                  {typeof e['actor_name'] === 'string' && e['actor_name'] !== '' ? (
                    <Avatar name={e['actor_name']} size="md" className="mt-px" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-bg-sunken text-2xs text-text-mute"
                    >
                      ·
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-sm leading-normal text-text">
                    {t(eventLabelKey(String(e['type'])))}
                    {typeof e['actor_name'] === 'string' && e['actor_name'] !== '' && (
                      <span className="text-text-faint"> · {String(e['actor_name'])}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-text-ghost">
                    {relativeTime(
                      t,
                      typeof e['occurred_at'] === 'string' ? e['occurred_at'] : null,
                    )}
                  </span>
                </li>
              ))}
          </ul>
          {!events.isLoading && rows(events.data).length === 0 && (
            <p className="px-2 text-sm text-text-faint">{t('home.no_notifications')}</p>
          )}
        </section>

        {/* 프로젝트 상태 — 시안의 오른쪽 292px 열 */}
        {primary !== undefined && (
          <section className="w-full shrink-0 md:w-[292px]">
            <Link
              to="/p/$proj"
              params={{ proj: primarySlug }}
              className="mb-2.5 block text-lg font-[650] tracking-[-0.012em] hover:text-link"
            >
              {String(primary['name'])}
            </Link>

            <div className="overflow-hidden rounded-[9px] border border-border">
              <StatRow label={t('home.stat.requirements')} value={reqTotal} />
              <StatRow
                label={t('home.active_sessions')}
                value={Number(primary['active_sessions'] ?? 0)}
                tone={Number(primary['active_sessions'] ?? 0) > 0 ? 'progress' : undefined}
              />
              <StatRow
                label={t('home.pending_approvals')}
                value={Number(primary['pending_approvals'] ?? 0)}
                tone={Number(primary['pending_approvals'] ?? 0) > 0 ? 'waiting' : undefined}
                last
              />
            </div>

            {/* 커버리지 — 원자료가 있을 때만 그린다(EP-COV-01 은 MVP 에서 원자료다).
                0/0 짜리 막대는 "0%" 라는 거짓 신호를 만든다 */}
            {reqTotal > 0 && (
              <>
                <SectionLabel className="mt-6 mb-2.5">{t('home.coverage')}</SectionLabel>
                <div className="flex flex-col gap-[11px]">
                  <CoverageBar
                    label={t('home.coverage.implemented')}
                    part={Number(totals['implemented'] ?? 0)}
                    whole={reqTotal}
                    barClass="bg-status-done"
                  />
                  <CoverageBar
                    label={t('home.coverage.verified')}
                    part={Number(totals['verified'] ?? 0)}
                    whole={reqTotal}
                    barClass="bg-status-ok"
                  />
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * 오늘 할 일 한 줄 — 시안의 행 구조: 표식(26px 사각) · 제목/메타 · 긴급 칩 · 경과.
 * 유형이 표식의 색과 왼쪽 룰을 정한다: 승인은 남색, 질문은 호박색(세션이 멈춰 있다).
 */
function TodoRow({ card }: { card: Record<string, unknown> }): React.JSX.Element {
  const t = useT();
  const isQuestion = card['subject_type'] === 'question';
  const blocking = isQuestion && card['urgency'] === 'blocking';
  return (
    <li>
      <Link
        to="/inbox"
        className={cn(
          'flex items-center gap-[13px] border-b border-l-2 border-b-border py-3.5 pr-3 pl-2.5 transition-colors hover:bg-bg-sunken',
          blocking
            ? 'border-l-status-waiting'
            : isQuestion
              ? 'border-l-transparent'
              : 'border-l-status-action',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-[26px] shrink-0 items-center justify-center rounded-[7px] text-sm',
            isQuestion
              ? 'bg-status-waiting-soft text-status-waiting'
              : 'bg-status-action-soft text-status-action',
          )}
        >
          {isQuestion ? '?' : '✓'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-[1.45] font-medium tracking-[-0.008em]">
            {String(card['body_md'] ?? card['subject_key'] ?? card['subject_type'])}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-faint">
            {String(card['requested_by'] ?? '')}
            {card['subject_key'] !== null && card['subject_key'] !== undefined && (
              <> · {String(card['subject_key'])}</>
            )}
          </span>
        </span>
        {blocking && (
          <span className="shrink-0 rounded-[5px] bg-status-waiting-soft px-2 py-[2.5px] text-[11px] font-medium text-status-waiting">
            {t('home.todo.blocking')}
          </span>
        )}
        <span className="w-[54px] shrink-0 text-right text-xs text-text-ghost">
          {relativeTime(t, typeof card['requested_at'] === 'string' ? card['requested_at'] : null)}
        </span>
      </Link>
    </li>
  );
}

/** 상태 표의 한 줄 — 시안의 라벨 12.5 / 값 13.5·600 */
function StatRow({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: number;
  tone?: 'progress' | 'waiting' | undefined;
  last?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-3.5 py-[11px]',
        last !== true && 'border-b border-border',
      )}
    >
      <span className="text-sm text-text-mute">{label}</span>
      <span
        className={cn(
          'text-base font-semibold tracking-[-0.01em] tabular-nums',
          tone === 'progress' && 'text-status-progress',
          tone === 'waiting' && 'text-status-waiting',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** 진행 막대 — 시안 5px. 수치는 막대 위에 텍스트로도 적는다(색만으로 말하지 않는다) */
function CoverageBar({
  label,
  part,
  whole,
  barClass,
}: {
  label: string;
  part: number;
  whole: number;
  barClass: string;
}): React.JSX.Element {
  const pct = whole <= 0 ? 0 : Math.round((part / whole) * 100);
  return (
    <div>
      <div className="mb-[5px] flex items-baseline justify-between">
        <span className="text-sm text-text">{label}</span>
        <span className="text-xs text-text-faint tabular-nums">
          {part} / {whole}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-[3px] bg-status-idle">
        <div className={cn('h-full rounded-[3px]', barClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
