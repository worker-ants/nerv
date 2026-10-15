// /p/:proj → S2 프로젝트 개요 (ui-wireframes §2.2 · screens.md §2.3)
//
// 진입 시 `project:{id}` 룸에 join 한다(§1.4 룸 2종). join 하지 않으면 이 화면은 조용히
// 낡은 데이터를 보여준다 — 폴백 폴링이 있지만 그건 끊겼을 때의 안전망이지 기본 경로가 아니다.

import { ACTIVE_SESSION_STATES, NERV_EVENT, NERV_EVENT_PHASE2 } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SessionCard } from '../../features/session-monitor/session-card.js';
import { ConnectAgentLinks } from '../../components/connect-agent-links.js';
import {
  useApprovalFlow,
  useCoverage,
  useNotificationScopes,
  useProject,
  useProjectInboxCount,
  useSessions,
} from '../../lib/queries.js';
import type { ApprovalFlow } from '../../lib/queries.js';
import { EventFeed } from '../../components/event-feed.js';
import { cn } from '../../lib/utils.js';
import {
  Card,
  EmptyState,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,
  SkeletonText,
} from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import type { SessionCard as SessionCardData } from '../../features/session-monitor/types.js';
import { asProjectId } from '../../lib/query-keys.js';
import { NO_AREA } from '../../features/coverage-drilldown/coverage-search.js';
import type { CoverageFilter } from '../../features/coverage-drilldown/coverage-search.js';

/**
 * **fail-open 기록으로 거른 활동**(2026-10-15 · 사람 결정 · REQ-WEB-319). S5 · S6 의 격상 배너가 [기록 보기]로 여기를 연다 —
 * 판정하지 못하고 통과시킨 일과 격상 · 풀림만 보인다. 주소에 남아 링크로 건넬 수 있다.
 */
const FAILOPEN_EVENTS: readonly string[] = [
  NERV_EVENT.GATE_FAILOPEN,
  NERV_EVENT_PHASE2.GATE_FAILOPEN_ESCALATED,
  NERV_EVENT_PHASE2.GATE_FAILOPEN_CLEARED,
];

export const Route = createFileRoute('/p/$proj/')({
  validateSearch: (search: Record<string, unknown>): { events?: 'failopen' } =>
    search['events'] === 'failopen' ? { events: 'failopen' } : {},
  component: ProjectOverview,
});

function ProjectOverview(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const { events: eventFilter } = Route.useSearch();
  const project = useProject(proj);
  const projectId = asProjectId(project.data?.['id']);
  const coverage = useCoverage(proj, projectId);
  /**
   * **활성 세션은 끝나지 않은 셋이다**(2026-09-25 — UI/UX 검토 HUB-10 · REQ-WEB-219). 상태 없이
   * 부르던 동안 모든 세션이 끝난 프로젝트가 "활성 세션 40개" 를 달고 끝난 세션 넷을 늘어놓았다 —
   * 같은 순간 홈과 사이드바는 0 이라 말했다. 정의는 `ACTIVE_SESSION_STATES` 하나다.
   */
  const sessions = useSessions(proj, projectId, ACTIVE_SESSION_STATES.join(','));
  const inboxCount = useProjectInboxCount(proj, projectId);
  /**
   * **결재 흐름**(2026-10-15 · 사람 결정 · REQ-WEB-311) — 이 프로젝트에서 2일을 넘긴 결재 수와 역할 큐 재검토 지표.
   * 기본 큐 결재는 2일이 지나도 알림을 더 보내지 않는다 — 그 자리를 이 수가 맡는다. 받지 못했으면 그리지 않는다
   */
  const flow = useApprovalFlow(proj, projectId);
  /**
   * **이 프로젝트의 중요 알림**(2026-09-27 · 사람 결정 N1 · REQ-WEB-258). 받은 요청 · 알림은 조직 전체의
   * 화면이지만, 개요에서 그 프로젝트로 좁힌 목록을 바로 연다. 수는 알림 칸과 같은 값이다(EP-NTF-05).
   */
  const notificationScopes = useNotificationScopes();
  const orgSlug =
    typeof project.data?.['org_slug'] === 'string' ? project.data['org_slug'] : undefined;
  const importantHere =
    notificationScopes.data?.items.find(
      (r) => r.project_slug === proj && (orgSlug === undefined || r.org_slug === orgSlug),
    )?.immediate ?? 0;
  const totals = (coverage.data?.['totals'] ?? {}) as Record<string, number | null>;
  // 요약은 필터와 무관한 **프로젝트 전체**의 상태별 수다 — 머리의 수는 받아 온 쪽이 아니라 이것이다
  const summary = sessions.data?.summary ?? {};
  const activeCount = ACTIVE_SESSION_STATES.reduce((n, state) => n + (summary[state] ?? 0), 0);
  const everCount = Object.values(summary).reduce((n, v) => n + v, 0);
  const waitingSessions = summary['awaiting_input'] ?? 0;
  // 사람을 기다리며 멈춘 세션이 **먼저**다 — 하트비트 순으로 두면 아래로 밀려 네 칸에서 잘린다
  const active = [...((sessions.data?.items ?? []) as unknown as SessionCardData[])].sort(
    (a, b) => Number(b.state === 'awaiting_input') - Number(a.state === 'awaiting_input'),
  );

  // **받기 전에는 수를 말하지 않는다**(REQ-WEB-294) — 여섯 칸이 응답 전에 전부 0 이었다
  const covered = coverage.data !== undefined;
  const total = Number(totals['total'] ?? 0);
  const implemented = Number(totals['implemented'] ?? 0);
  const verified = Number(totals['verified'] ?? 0);
  const missing = Number(totals['evidence_missing'] ?? 0);
  const empty = Number(totals['empty_promises'] ?? 0);
  const reverify = Number(totals['reverify_required'] ?? 0);
  // **임포트 값으로 남은 요구사항**(2026-10-15 · 사람 결정 · REQ-WEB-317 · 서버 REQ-API-312) — 성공 기준 2-8 의 두 수
  const imported = Number(totals['imported_values'] ?? 0);
  const derivedRatio = typeof totals['derived_ratio'] === 'number' ? totals['derived_ratio'] : null;
  /**
   * **영역별 분해**(2026-10-11 · REQ-WEB-309 · 서버 REQ-API-297). 프로젝트 전체의 여섯 칸만으로는 "어느 영역이 비었나"
   * 에 답하지 못했다 — 스펙 트리의 `area` 문서마다 같은 지표를 묶는다. 영역에 들지 않은 스펙은 마지막 한 줄이다
   */
  const areas = (
    Array.isArray(coverage.data?.['areas']) ? coverage.data['areas'] : []
  ) as AreaCoverage[];

  return (
    <PageBody wide>
      <PageHeader
        // 받기 전에는 이름을 모른다 — slug 를 먼저 보였다가 이름으로 바꾸지 않는다(REQ-WEB-294)
        title={
          project.isPending ? (
            <SkeletonText className="w-48" />
          ) : (
            String(project.data?.['name'] ?? proj)
          )
        }
        description={String(project.data?.['description'] ?? '')}
      />

      {/* **여기서 나를 기다리는 것**(2026-09-25 — UI/UX 검토 HUB-06 · REQ-WEB-220). 개요는 이 프로젝트의
          상태를 말했지만 "내가 할 것" 은 말하지 않았다 — 셋 다 받아 온 뒤에만 말한다(REQ-WEB-198) */}
      {project.data !== undefined &&
        inboxCount.data !== undefined &&
        sessions.data !== undefined && (
          <WaitingLine
            proj={proj}
            {...(orgSlug === undefined ? {} : { orgSlug })}
            approvals={inboxCount.data}
            importantNotifications={importantHere}
            waitingSessions={waitingSessions}
            critical={Number(project.data['open_critical_findings'] ?? 0)}
            overdue={typeof flow.data?.overdue === 'number' ? flow.data.overdue : 0}
          />
        )}
      {/* 모양이 다른 응답(옛 서버)은 그리지 않는다 — 한 줄이 개요 전체를 죽이지 않게 */}
      {typeof flow.data?.lag?.total === 'number' && flow.data.lag.total > 0 && (
        <ApprovalLagLine lag={flow.data.lag} />
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <Card className="self-start lg:col-span-1">
          {/* **수를 누르면 그 줄들로 내려간다**(2026-10-15 · REQ-WEB-315 · FR-13 양방향 드릴다운) — 카드는 건수만
              보여 주고, 어느 요구사항인지는 드릴다운에서 확인한다 */}
          <SectionTitle
            action={
              <Link
                to="/p/$proj/coverage"
                params={{ proj }}
                data-testid="coverage-drilldown"
                className="text-xs text-link hover:underline"
              >
                {t('project.coverage.drilldown')} ▸
              </Link>
            }
          >
            {t('project.coverage')}
          </SectionTitle>
          {/* 받지 못했으면 수 대신 이유와 [다시 시도] — 골격을 남겨 두면 끝나지 않는 "불러오는 중" 이다(REQ-WEB-198) */}
          {failedWithoutData(coverage) ? (
            <ErrorState error={coverage.error} onRetry={() => void coverage.refetch()} />
          ) : (
            <>
              {/* 막대 하나 — 요구사항이 어디까지 왔는지는 다섯 줄의 숫자보다 폭으로 먼저 읽힌다.
                  폭만으로 구분하지 않도록 아래에 숫자를 그대로 남긴다(REQ-WEB-033) */}
              <div
                className="flex h-1.5 overflow-hidden rounded-full bg-bg-sunken"
                role="img"
                aria-label={
                  covered
                    ? t('project.coverage.alt', { total, verified, implemented })
                    : t('common.loading')
                }
              >
                <span className="bg-status-ok" style={{ width: `${pct(verified, total)}%` }} />
                <span
                  className="bg-status-done"
                  style={{ width: `${pct(Math.max(0, implemented - verified), total)}%` }}
                />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <Metric
                  proj={proj}
                  label={t('project.metric.total')}
                  value={covered ? total : null}
                />
                <Metric
                  proj={proj}
                  label={t('project.metric.implemented')}
                  value={covered ? implemented : null}
                />
                <Metric
                  proj={proj}
                  label={t('project.metric.verified')}
                  value={covered ? verified : null}
                  tone={verified > 0 ? 'ok' : undefined}
                />
                {/* 두 숫자가 이 카드의 존재 이유다 — 관계 그래프가 아니면 셀 수 없다(§5.5) */}
                <Metric
                  proj={proj}
                  filter="evidence_missing"
                  label={t('project.metric.evidence_missing')}
                  value={covered ? missing : null}
                  tone={missing > 0 ? 'waiting' : undefined}
                />
                <Metric
                  proj={proj}
                  filter="empty_promises"
                  label={t('project.metric.empty_promises')}
                  value={covered ? empty : null}
                  tone={empty > 0 ? 'danger' : undefined}
                />
                {/* 문장이 바뀌어 검증이 풀린 것 — 검증률에서 빠진 까닭을 여기서 말한다(REQ-WEB-241) */}
                <Metric
                  proj={proj}
                  filter="reverify"
                  label={t('project.metric.reverify_required')}
                  value={covered ? reverify : null}
                  tone={reverify > 0 ? 'waiting' : undefined}
                />
              </dl>
              {/* **임포트 값은 따로 센다**(2026-10-15 · 사람 결정 · REQ-WEB-317) — 작업이 없어 파생하지 않은 값이다. 숫자를
                  그대로 보이되 파생한 값과 섞여 읽히지 않게 한 줄로 보여 주고, 누르면 그 요구사항들로 간다 */}
              {imported > 0 && derivedRatio !== null && (
                <Link
                  to="/p/$proj/coverage"
                  params={{ proj }}
                  search={{ filter: 'import' }}
                  data-testid="coverage-imported"
                  className="mt-2 block text-xs text-link hover:underline"
                >
                  {t('coverage.derived_line', {
                    percent: Math.round(derivedRatio * 100),
                    count: imported,
                  })}
                  <span aria-hidden="true"> ▸</span>
                </Link>
              )}
              {areas.length > 0 && <AreaBreakdown proj={proj} areas={areas} />}
            </>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle
            action={
              <Link
                to="/p/$proj/sessions"
                params={{ proj }}
                className="text-xs text-link hover:underline"
              >
                {t('common.all')}
              </Link>
            }
          >
            {/* 받기 전에는 수를 말하지 않는다 — "0개" 는 모르는 것이 아니라 없다는 말이다(REQ-WEB-198) */}
            {sessions.data === undefined
              ? t('home.project.sessions')
              : t('project.active_sessions', { count: activeCount })}
          </SectionTitle>
          {/* 카드가 아니라 줄이다 — 2열로 쪼개면 한 칸이 줄 폭의 절반이라
              고정 폭 열들이 넘쳐 화면이 깨진다(실측 2026-08-23) */}
          <div className="flex flex-col">
            {active.slice(0, 4).map((card) => (
              <SessionCard key={card.id} card={card} projectSlug={proj} />
            ))}
          </div>
          {sessions.isPending && <Skeleton rows={2} className="[&>div]:h-12" />}
          {failedWithoutData(sessions) && (
            <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
          )}
          {sessions.data !== undefined &&
            active.length === 0 &&
            (everCount > 0 ? (
              // 세션이 있었던 프로젝트 — 붙이는 길 대신 끝난 것을 보는 길을 준다
              <EmptyState
                icon="◉"
                title={t('project.no_sessions')}
                hint={t('project.no_sessions_ended_hint')}
                action={
                  <Link
                    to="/p/$proj/sessions"
                    params={{ proj }}
                    className="text-sm text-link hover:underline"
                  >
                    {t('project.see_all_sessions')} ▸
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon="◉"
                title={t('project.no_sessions')}
                hint={
                  <>
                    {t('project.no_sessions_hint_pre')}{' '}
                    <code className="font-mono text-text-mute">/nerv:next</code>
                    {t('project.no_sessions_hint_post')}
                  </>
                }
                action={<ConnectAgentLinks />}
              />
            ))}
        </Card>
      </section>

      {/* 트리는 **셸 사이드바가 소유한다**(§1.3) — 와이어프레임 §2.2 의 좌측 열이 그것이다.
          여기서 또 그리면 같은 트리가 나란히 두 개 뜬다(문서 대조에서 발견). */}
      <section className="max-w-content" data-testid="project-events">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            {eventFilter === 'failopen' ? t('project.events_failopen') : t('project.recent_events')}
          </SectionTitle>
          {eventFilter === 'failopen' && (
            <Link
              to="/p/$proj"
              params={{ proj }}
              data-testid="project-events-all"
              className="text-xs text-link hover:underline"
            >
              {t('project.events_all')}
            </Link>
          )}
        </div>
        {/* 홈과 **같은 피드**다(REQ-WEB-210) — 이름도 모양도 달랐고, 30줄에서 끝났다 */}
        <EventFeed
          projectSlug={proj}
          projectId={asProjectId(project.data?.['id'])}
          emptyText={t('project.no_events')}
          {...(eventFilter === 'failopen' ? { types: FAILOPEN_EVENTS } : {})}
        />
      </section>
    </PageBody>
  );
}

/**
 * 개요 머리의 "기다리는 것" 한 줄 — 내 결정 · 사람을 기다리는 세션 · 열린 critical. 수는 그 레코드가
 * 있는 화면으로 가는 링크다(ui-wireframes §1). 0 인 것은 그리지 않고, 셋 다 0 이면 그렇다고 말한다.
 */
function WaitingLine({
  proj,
  orgSlug,
  approvals,
  importantNotifications,
  waitingSessions,
  critical,
  overdue,
}: {
  proj: string;
  /** 이 프로젝트의 조직 — slug 는 조직 안에서만 유일하다 */
  orgSlug?: string;
  approvals: number;
  importantNotifications: number;
  waitingSessions: number;
  critical: number;
  /** 요청 뒤 2일을 넘긴 결재 — 프로젝트 전체의 수다(EP-APR-08) */
  overdue: number;
}): React.JSX.Element {
  const t = useT();
  // 상태 배지와 같은 옅은 알약이라 표시로 읽혔다 — 이동하는 칩에는 ▸ 를 붙인다(REQ-WEB-274)
  const chip = 'rounded-full px-2.5 py-0.5 text-xs font-medium hover:underline';
  return (
    <div
      data-testid="project-waiting"
      className="-mt-2 mb-6 flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="text-xs text-text-faint">{t('project.waiting.label')}</span>
      {approvals === 0 &&
        importantNotifications === 0 &&
        waitingSessions === 0 &&
        critical === 0 &&
        overdue === 0 && (
          <span className="text-xs text-text-mute">{t('project.waiting.none')}</span>
        )}
      {/* **그 프로젝트로 좁힌 받은 요청을 연다**(2026-09-27 · REQ-WEB-258). 거르지 않은 목록으로 가면
          다른 프로젝트의 카드 사이에서 방금 본 "2건" 을 다시 찾아야 했다 */}
      {approvals > 0 && (
        <Link
          to="/inbox"
          search={{ ...(orgSlug === undefined ? {} : { org: orgSlug }), project: proj }}
          data-testid="project-waiting-approvals"
          className={cn(chip, 'bg-status-action-soft text-status-action')}
        >
          {t('project.waiting.approvals', { count: approvals })}
          <span aria-hidden="true"> ▸</span>
        </Link>
      )}
      {/* **지연 결재**(2026-10-15 · 사람 결정 · REQ-WEB-311 · spec-workflow §2.6 의 "지연 승인" 배지). 내 결정이 아니어도
          이 프로젝트의 결재가 2일을 넘겼다는 사실은 모두가 본다 — 받은 요청은 그 프로젝트로 좁혀 열린다 */}
      {overdue > 0 && (
        <Link
          to="/inbox"
          search={{ ...(orgSlug === undefined ? {} : { org: orgSlug }), project: proj }}
          data-testid="project-waiting-overdue"
          title={t('project.waiting.overdue_hint')}
          className={cn(chip, 'bg-status-danger-soft text-status-danger')}
        >
          {t('project.waiting.overdue', { count: overdue })}
          <span aria-hidden="true"> ▸</span>
        </Link>
      )}
      {importantNotifications > 0 && (
        <Link
          to="/notifications"
          search={{
            ...(orgSlug === undefined ? {} : { org: orgSlug }),
            project: proj,
            filter: 'important',
          }}
          data-testid="project-waiting-notifications"
          className={cn(chip, 'bg-bg-sunken text-text')}
        >
          {t('project.waiting.notifications', { count: importantNotifications })}
          <span aria-hidden="true"> ▸</span>
        </Link>
      )}
      {waitingSessions > 0 && (
        <Link
          to="/p/$proj/sessions"
          params={{ proj }}
          search={{ state: 'awaiting_input' }}
          data-testid="project-waiting-sessions"
          className={cn(chip, 'bg-status-waiting-soft text-status-waiting')}
        >
          {t('project.waiting.sessions', { count: waitingSessions })}
          <span aria-hidden="true"> ▸</span>
        </Link>
      )}
      {critical > 0 && (
        <Link
          to="/p/$proj/reviews"
          params={{ proj }}
          search={{ severity: 'critical' }}
          data-testid="project-waiting-critical"
          className={cn(chip, 'bg-status-danger-soft text-status-danger')}
        >
          {t('project.waiting.critical', { count: critical })}
          <span aria-hidden="true"> ▸</span>
        </Link>
      )}
    </div>
  );
}

/**
 * **결재 흐름 한 줄 — 역할 큐 재검토 지표**(2026-10-15 · 사람 결정 · REQ-WEB-311 · spec-workflow §2.2). 결재는 특정인이
 * 아니라 역할 큐로 간다. 같은 역할의 사람이 서로 미루면 그 결정을 다시 본다 — 그 신호를 숫자로 보인다: 최근 30일
 * 결재 가운데 하루를 넘긴(2회째 리마인더까지 간) 비율. 기준(30%)을 넘으면 재검토 안내를 덧붙인다. 판정은 서버의
 * `review_due` 다 — 화면은 비율을 다시 견주지 않는다.
 */
function ApprovalLagLine({ lag }: { lag: ApprovalFlow['lag'] }): React.JSX.Element {
  const t = useT();
  const percent = (ratio: number | null): number => Math.round((ratio ?? 0) * 100);
  return (
    <div
      data-testid="approval-lag"
      data-review-due={lag.review_due || undefined}
      className="-mt-4 mb-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"
    >
      <span className="text-text-faint">{t('project.approval_lag.label')}</span>
      <span className={lag.review_due ? 'text-status-waiting' : 'text-text-mute'}>
        {t('project.approval_lag.summary', {
          days: lag.window_days,
          total: lag.total,
          late: lag.late,
          percent: percent(lag.ratio),
        })}
      </span>
      {lag.review_due && (
        <span data-testid="approval-lag-review" className="font-medium text-status-waiting">
          {t('project.approval_lag.review', { threshold: percent(lag.threshold) })}
        </span>
      )}
    </div>
  );
}

/** 영역 한 줄 — 서버의 `areas[]`(REQ-API-297) */
interface AreaCoverage {
  area_key: string | null;
  area_title: string | null;
  total: number;
  implemented: number;
  verified: number;
  evidence_missing: number;
  empty_promises: number;
  reverify_required: number;
}

/**
 * 영역마다 막대 하나와 수 — 전체 카드와 **같은 지표**를 같은 색으로 쓴다(REQ-WEB-309). 경고 셋은 0 이면 적지 않는다:
 * 영역이 열이면 0 이 서른 번 서고, 그러면 0 이 아닌 하나가 묻힌다.
 *
 * **영역 이름은 그 영역의 드릴다운으로 간다**(2026-10-15 · REQ-WEB-315). 예전에는 영역 문서를 열었다 — 숫자를 보고 누른
 * 사람이 찾는 것은 그 영역의 어느 요구사항이 비었는지다. 영역 문서는 드릴다운의 줄에서 연다.
 */
function AreaBreakdown({
  proj,
  areas,
}: {
  proj: string;
  areas: AreaCoverage[];
}): React.JSX.Element {
  const t = useT();
  return (
    <div data-testid="coverage-areas" className="mt-4 border-t border-border pt-3">
      <h3 className="mb-2 text-xs font-medium text-text-mute">{t('project.coverage.areas')}</h3>
      <ul className="flex flex-col gap-2.5">
        {areas.map((area) => {
          const warnings = [
            [area.evidence_missing, 'project.metric.evidence_missing'],
            [area.empty_promises, 'project.metric.empty_promises'],
            [area.reverify_required, 'project.metric.reverify_required'],
          ] as const;
          return (
            <li key={area.area_key ?? ''} data-testid="coverage-area" className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to="/p/$proj/coverage"
                  params={{ proj }}
                  search={{ area: area.area_key ?? NO_AREA }}
                  className={cn(
                    'truncate hover:underline',
                    area.area_key === null ? 'text-text-mute' : 'text-text',
                  )}
                >
                  {area.area_key === null
                    ? t('project.coverage.no_area')
                    : (area.area_title ?? area.area_key)}
                </Link>
                <span className="shrink-0 text-text-mute tabular-nums">
                  {t('project.coverage.area_counts', {
                    implemented: area.implemented,
                    verified: area.verified,
                    total: area.total,
                  })}
                </span>
              </div>
              <div
                className="mt-1 flex h-1 overflow-hidden rounded-full bg-bg-sunken"
                role="img"
                aria-label={t('project.coverage.alt', {
                  total: area.total,
                  verified: area.verified,
                  implemented: area.implemented,
                })}
              >
                <span
                  className="bg-status-ok"
                  style={{ width: `${pct(area.verified, area.total)}%` }}
                />
                <span
                  className="bg-status-done"
                  style={{
                    width: `${pct(Math.max(0, area.implemented - area.verified), area.total)}%`,
                  }}
                />
              </div>
              {warnings.some(([n]) => n > 0) && (
                <p className="mt-0.5 text-text-faint">
                  {warnings
                    .filter(([n]) => n > 0)
                    .map(([n, label]) => `${t(label)} ${n}`)
                    .join(' · ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

/**
 * 숫자 하나 — 0 은 흐리게 둔다. 0 이 눈에 띄면 매번 "뭐가 문제지"를 확인하게 된다.
 *
 * **숫자는 그 줄들로 가는 링크다**(2026-10-15 · REQ-WEB-315). 경고 셋은 그 거르기를 켠 드릴다운으로, 나머지는 드릴다운의
 * 처음으로 간다. 받기 전(`null`)에는 링크가 아니다 — 모르는 수를 누르게 하지 않는다.
 */
function Metric({
  proj,
  filter,
  label,
  value,
  tone,
}: {
  proj: string;
  filter?: CoverageFilter;
  label: string;
  /** `null` 은 아직 받지 않았다 — 0 이 아니다(REQ-WEB-294) */
  value: number | null;
  tone?: 'ok' | 'waiting' | 'danger' | undefined;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-text-mute">{label}</dt>
      <dd
        className={cn(
          'font-medium tabular-nums',
          value === 0 && tone === undefined ? 'text-text-faint' : undefined,
          tone === 'ok' ? 'text-status-ok' : undefined,
          tone === 'waiting' ? 'text-status-waiting' : undefined,
          tone === 'danger' ? 'text-status-danger' : undefined,
        )}
      >
        {value === null ? (
          <SkeletonText />
        ) : (
          <Link
            to="/p/$proj/coverage"
            params={{ proj }}
            {...(filter === undefined || value === 0 ? {} : { search: { filter } })}
            data-testid="coverage-metric-link"
            className="group hover:underline"
          >
            {value}
            {/* 갈 데가 있다는 표지 — 숫자만으로는 표시와 링크를 구별할 수 없다(REQ-WEB-274) */}
            <span
              aria-hidden="true"
              className="ml-0.5 text-2xs text-text-faint group-hover:text-link"
            >
              ▸
            </span>
          </Link>
        )}
      </dd>
    </div>
  );
}
