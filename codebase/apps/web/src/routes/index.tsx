// / → S1 홈 대시보드 (ui-wireframes §2.1 · screens.md §2.2 · 시안 Home)
//
// **사람이 결정해야 하는 것만.** 인사말이 밀린 결정 수를 바로 말하고(시안 — "결정 N건이
// 밀려 있어요"), 오늘 할 일은 카드 격자가 아니라 **한 줄기 목록**이다. 카드 상자를 쌓으면
// 셋 다 같은 무게로 읽히고, 정작 "지금 나를 기다리는 게 몇 건인가"는 상자를 다 본 뒤에야
// 답이 나온다. 그 아래는 최근 활동과 프로젝트 상태 — 결정이 끝난 사람이 훑는 것들이다.

import { useLocale, useT } from '../lib/i18n.js';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
import {
  inboxActionable,
  inboxCards,
  inboxTotal,
  lockedCard,
  rows,
  useCoverage,
  useInbox,
  useMe,
  useMembers,
} from '../lib/queries.js';
import { useScope } from '../lib/scope.js';
import { cn } from '../lib/utils.js';
import { EmptyState, SectionLabel, Skeleton } from '../components/ui/primitives.js';
import { InvitationCards } from '../components/invitation-cards.js';
import { EventFeed } from '../components/event-feed.js';
import { ErrorState, failedWithoutData } from '../components/query-state.js';
import { subjectFallback, waitedLabel } from '../features/inbox/approval-card.js';
import { asProjectId } from '../lib/query-keys.js';
import { ScopeBadge } from '../components/scope-badge.js';
import { StartChecklist } from '../components/start-checklist.js';
import { ReadOnlyNotice, scopeAdmins } from '../components/read-only-notice.js';
import { canManageScope } from '../lib/session.js';

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
  const primaryId = asProjectId(primary?.['id']);
  const coverage = useCoverage(primarySlug, primaryId);

  // **내가 누를 수 있는 것만**(2026-09-24 사람 결정 D2 · REQ-WEB-217). 인사말의 "결정 N건" 과
  // 오늘 할 일에 내가 요청했거나 쓴 카드가 섞이면, 그 줄을 눌러도 승인 단추는 잠겨 있고
  // 할 수 있는 것을 다 해도 수가 0 이 되지 않는다. 그런 카드는 수와 줄에서 빼고 아래에 따로 센다
  const cards = inboxCards(inbox.data).filter((card) => !lockedCard(card));
  // 홈은 **다섯 줄만** 그리고 나머지는 받은 요청으로 보낸다 — 그 "나머지" 의 수는
  // 받아 온 쪽이 아니라 서버가 센 수다(REQ-API-166)
  const waiting = inboxActionable(inbox.data);
  const othersWaiting = Math.max(0, inboxTotal(inbox.data) - waiting);
  const today = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'full',
  }).format(new Date());
  const name = me.data?.display_name ?? '';
  // **"없다" 는 받아 온 뒤에만 말한다**(REQ-WEB-198). 예전에는 받은 요청을 불러오지 못하거나
  // 아직 불러오는 중에도 수가 0 으로 읽혀 "밀린 결정이 없어요" 가 떴다 — 결재가 쌓인 채로.
  const inboxFailed = failedWithoutData(inbox);
  // **프로젝트가 0개인 조직**(REQ-WEB-205). 조직을 막 만든 사람은 여기 서서 다음 걸음을 찾지 못했다 —
  // 조직 admin 에게는 시작 체크리스트가, 아닌 사람에게는 누구에게 부탁할지가 선다. 목록을 받은 뒤에만
  const isOrgAdmin = canManageScope(me.data, scope.orgSlug, null);
  const noProjects = scope.projectsLoaded && scope.projects.length === 0;
  const members = useMembers(noProjects && !isOrgAdmin ? scope.orgSlug : null);
  const totals = (coverage.data?.['totals'] ?? {}) as Record<string, number | null>;
  const reqTotal = Number(totals['total'] ?? 0);

  /**
   * **소속이 없으면 여기는 빈 방이다** — 온보딩으로 보낸다(REQ-WEB-006 · REQ-WEB-188).
   *
   * 이 판정은 로그인 폼만 하고 있었다(`login.tsx` 의 착지 규칙). 그런데 로그인 폼을 거치지
   * 않고 들어오는 길이 있다 — **확인 메일의 링크**가 세션을 세우고 곧장 화면으로 돌려보낸다
   * (`autoSignInAfterVerification`). 가입한 사람은 그 길로 홈에 섰고, 소속이 없으니 헤더에
   * 조직도 프로젝트도 없어 **조직을 만들 자리가 어디에도 없었다**(2026-09-24 사람 보고 —
   * 로그아웃하고 다시 로그인하면 그때서야 온보딩이 떴다). 즐겨찾기·로고로 들어와도 같다.
   * 착지 규칙을 입구마다 두지 않고 **도착지에** 둔다: 입구는 늘어나도 도착지는 여기다.
   *
   * 받은 초대는 잃지 않는다 — 온보딩도 같은 초대 카드를 조직 만들기보다 위에 세운다(REQ-WEB-088).
   */
  if (me.data !== undefined && me.data.memberships.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-10 pt-11 pb-10">
      {/* 날짜 → 인사말. 인사말이 곧 요약이다 — 결정이 없으면 그렇게 말한다 */}
      <div className="text-sm text-text-faint">{today}</div>
      <h1 className="mt-2 text-[1.9375rem] leading-[1.18] font-bold tracking-[-0.026em]">
        {me.data === undefined ? (
          t('home.title_anon')
        ) : inboxFailed ? (
          t('home.greeting_failed', { name })
        ) : inbox.data === undefined ? (
          // 모르는 동안은 아무 말도 하지 않는다 — 골격이 자리를 지킨다
          <span
            data-testid="greeting-skeleton"
            aria-label={t('common.loading')}
            className="inline-block h-[1em] w-2/3 max-w-[28rem] animate-pulse rounded-nerv bg-bg-sunken align-middle"
          />
        ) : waiting === 0 ? (
          t('home.greeting_clear', { name })
        ) : (
          t('home.greeting_pending', { name, count: waiting })
        )}
      </h1>

      {/* **받은 초대가 먼저다.** 아직 들어가지도 않은 조직의 일이라 '오늘 할 일'보다
          앞에 선다 — 수락하기 전에는 그 조직의 어떤 것도 보이지 않는다 */}
      <div className="mt-8 flex flex-col gap-4">
        <InvitationCards />
        <StartChecklist orgSlug={scope.orgSlug} />
        {noProjects && !isOrgAdmin && (
          <ReadOnlyNotice
            admins={members.data === undefined ? undefined : scopeAdmins(rows(members.data), null)}
          >
            {t('home.no_projects')}
          </ReadOnlyNotice>
        )}
      </div>

      <section className="mt-8" data-testid="today-strip">
        <div className="mb-1 flex items-baseline gap-[9px]">
          <span className="text-lg font-[650] tracking-[-0.012em]">{t('home.waiting_on_you')}</span>
          {waiting > 0 && (
            <span className="text-sm text-text-faint">
              {t('home.waiting_count', { count: waiting })}
            </span>
          )}
        </div>

        {inbox.isLoading && <Skeleton rows={2} />}
        {inboxFailed && <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />}
        {inbox.data !== undefined && cards.length === 0 && (
          <EmptyState
            icon="✓"
            title={t('home.nothing_waiting')}
            action={
              <Link
                to="/inbox"
                search={{ state: 'decided' }}
                className="text-sm text-link hover:underline"
              >
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
        {(waiting > 5 || othersWaiting > 0) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-faint">
            {waiting > 5 && (
              <Link to="/inbox" className="hover:text-link">
                {t('home.inbox_all', { count: waiting })}
              </Link>
            )}
            {/* 내가 올린 것이 남의 결정을 기다린다 — 수에서는 뺐지만 사라지지는 않는다 */}
            {othersWaiting > 0 && (
              <Link to="/inbox" data-testid="home-others-waiting" className="hover:text-link">
                {t('home.others_waiting', { count: othersWaiting })}
              </Link>
            )}
          </div>
        )}
      </section>

      {/* **프로젝트가 없으면 활동도 상태도 없다** — 예전에는 빈 자리에 "알림이 없습니다." 가 떴다
          (활동은 알림이 아니다). 첫 걸음은 위의 체크리스트·안내가 말한다(REQ-WEB-205) */}
      {primary !== undefined && (
        <div className="mt-[38px] flex flex-col gap-10 md:flex-row md:gap-11">
          {/* 최근 활동 — 결정을 끝낸 사람이 흐름을 따라잡는 곳 */}
          <section className="min-w-0 flex-1">
            {/* **어느 프로젝트의 활동인지** 말한다(REQ-WEB-193) — 한 프로젝트의 흐름인데 제목만 보면
              조직 전체의 것처럼 읽혔다 */}
            <div className="mb-2.5 text-lg font-[650] tracking-[-0.012em]">
              {primary === undefined
                ? t('home.recent_activity')
                : t('home.recent_activity_in', { project: String(primary['name']) })}
            </div>
            {/* 무엇에 일어났는지 적고 그리로 간다 · 잇달아 같은 일은 접는다 — 개요와 같은 피드다(REQ-WEB-210) */}
            <EventFeed
              projectSlug={primarySlug}
              projectId={primaryId}
              max={8}
              emptyText={t('home.no_activity')}
              variant="airy"
            />
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
                {/* **숫자를 누르면 그 숫자를 만든 레코드로 간다**(ui-wireframes §1 · REQ-WEB-210) —
                    셋 다 눌리지 않는 글자였다 */}
                <StatRow
                  label={t('home.stat.requirements')}
                  value={reqTotal}
                  link={{ to: '/p/$proj/specs', params: { proj: primarySlug } }}
                  testId="stat-requirements"
                />
                <StatRow
                  label={t('home.active_sessions')}
                  value={Number(primary['active_sessions'] ?? 0)}
                  tone={Number(primary['active_sessions'] ?? 0) > 0 ? 'progress' : undefined}
                  link={{ to: '/p/$proj/sessions', params: { proj: primarySlug } }}
                  testId="stat-sessions"
                />
                <StatRow
                  label={t('home.pending_approvals')}
                  value={Number(primary['pending_approvals'] ?? 0)}
                  tone={Number(primary['pending_approvals'] ?? 0) > 0 ? 'waiting' : undefined}
                  link={{ to: '/inbox' }}
                  testId="stat-approvals"
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
      )}
    </div>
  );
}

/**
 * 이 줄이 가리키는 문서의 표시 키 — 목록 질의는 스펙 승인에만 키를 JOIN 한다.
 *
 * `subject_key` 는 이 응답에 없는 필드다(카드 상세 쪽 이름이다). 남겨 두는 이유는 하나 —
 * 없는 이름을 지우는 것과 **키가 없는 카드**(플랜·발견·면제)를 가르는 것은 다른 일이고,
 * 여기서 필요한 것은 후자다: 키가 없으면 그 칸은 비운다.
 */
function subjectKeyOf(card: Record<string, unknown>): string | null {
  for (const field of ['spec_key', 'task_key', 'subject_key']) {
    const value = card[field];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/**
 * 오늘 할 일 한 줄 — 시안의 행 구조: 표식(26px 사각) · 제목/메타 · 긴급 칩 · 경과.
 * 유형이 표식의 색과 왼쪽 룰을 정한다: 승인은 남색, 질문은 호박색(세션이 멈춰 있다).
 */
function TodoRow({ card }: { card: Record<string, unknown> }): React.JSX.Element {
  const t = useT();
  const isQuestion = card['subject_type'] === 'question';
  const blocking = isQuestion && card['urgency'] === 'blocking';
  const subjectKey = subjectKeyOf(card);
  return (
    <li>
      {/* **그 카드로 간다**(REQ-WEB-204) — 어느 줄을 눌러도 같은 `/inbox` 첫 카드에 섰다 */}
      <Link
        to="/inbox"
        search={{ focus: String(card['id']) }}
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
          {/* **어휘를 그대로 찍지 않는다**(2026-09-24). 폴백이 `subject_type` 이라 승인 카드는
              이 줄에 **`spec_version` 이라고** 떴다 — DB 의 enum 값이다. 받은 요청 카드는 이미
              `subjectFallback` 로 같은 자리를 메우고 있었다 — 판정이 아니라 **표기**라 그 함수를
              여기서도 쓴다. **순서도 카드와 같다**(REQ-WEB-204): 예전에는 질문의 본문을 제목 자리에
              두어, 누르고 도착한 카드가 같은 요청을 다른 말(제목)로 불렀다 */}
          <span className="block truncate text-base leading-[1.45] font-medium tracking-[-0.008em]">
            {String(
              card['title'] ??
                card['spec_title'] ??
                card['task_title'] ??
                card['finding_title'] ??
                subjectFallback(t, card['subject_type']),
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-faint">
            {/* 오늘 할 일은 조직을 가로지른다 — 범위가 없으면 어느 프로젝트의 일인지 열어 봐야 안다(REQ-WEB-192) */}
            <ScopeBadge
              className="shrink-0"
              orgSlug={card['org_slug']}
              orgName={card['org_name']}
              projectSlug={card['project_slug']}
              projectName={card['project_name']}
            />
            <span className="truncate">
              · {String(card['requested_by'] ?? '')}
              {subjectKey !== null && <> · {subjectKey}</>}
            </span>
          </span>
        </span>
        {blocking && (
          <span className="shrink-0 rounded-[5px] bg-status-waiting-soft px-2 py-[2.5px] text-[11px] font-medium text-status-waiting">
            {t('home.todo.blocking')}
          </span>
        )}
        {/* 기다린 시간은 **카드와 같은 말과 같은 색**이다 — 한 시간 넘으면 호박색(REQ-WEB-204) */}
        <span
          className={cn(
            'w-[64px] shrink-0 text-right text-xs',
            Number(card['waiting_seconds'] ?? 0) >= 3600
              ? 'font-medium text-status-waiting'
              : 'text-text-ghost',
          )}
        >
          {waitedLabel(t, Number(card['waiting_seconds'] ?? 0))}
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
  link,
  testId,
}: {
  label: string;
  value: number;
  tone?: 'progress' | 'waiting' | undefined;
  last?: boolean;
  /** 이 숫자를 만든 레코드가 있는 곳 */
  link: { to: '/p/$proj/specs' | '/p/$proj/sessions'; params: { proj: string } } | { to: '/inbox' };
  testId: string;
}): React.JSX.Element {
  return (
    <Link
      {...link}
      data-testid={testId}
      className={cn(
        'flex items-center justify-between px-3.5 py-[11px] hover:bg-bg-hover',
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
    </Link>
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
