// /p/:proj → S2 프로젝트 개요 (ui-wireframes §2.2 · screens.md §2.3)
//
// 진입 시 `project:{id}` 룸에 join 한다(§1.4 룸 2종). join 하지 않으면 이 화면은 조용히
// 낡은 데이터를 보여준다 — 폴백 폴링이 있지만 그건 끊겼을 때의 안전망이지 기본 경로가 아니다.

import { ACTIVE_SESSION_STATES } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SessionCard } from '../../features/session-monitor/session-card.js';
import { ConnectAgentLinks } from '../../components/connect-agent-links.js';
import { useCoverage, useProject, useProjectInboxCount, useSessions } from '../../lib/queries.js';
import { EventFeed } from '../../components/event-feed.js';
import { cn } from '../../lib/utils.js';
import {
  Card,
  EmptyState,
  PageBody,
  PageHeader,
  SectionTitle,
} from '../../components/ui/primitives.js';
import type { SessionCard as SessionCardData } from '../../features/session-monitor/types.js';
import { asProjectId } from '../../lib/query-keys.js';

export const Route = createFileRoute('/p/$proj/')({ component: ProjectOverview });

function ProjectOverview(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
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

  const total = Number(totals['total'] ?? 0);
  const implemented = Number(totals['implemented'] ?? 0);
  const verified = Number(totals['verified'] ?? 0);
  const missing = Number(totals['evidence_missing'] ?? 0);
  const empty = Number(totals['empty_promises'] ?? 0);

  return (
    <PageBody wide>
      <PageHeader
        title={String(project.data?.['name'] ?? proj)}
        description={String(project.data?.['description'] ?? '')}
      />

      {/* **여기서 나를 기다리는 것**(2026-09-25 — UI/UX 검토 HUB-06 · REQ-WEB-220). 개요는 이 프로젝트의
          상태를 말했지만 "내가 할 것" 은 말하지 않았다 — 셋 다 받아 온 뒤에만 말한다(REQ-WEB-198) */}
      {project.data !== undefined &&
        inboxCount.data !== undefined &&
        sessions.data !== undefined && (
          <WaitingLine
            proj={proj}
            approvals={inboxCount.data}
            waitingSessions={waitingSessions}
            critical={Number(project.data['open_critical_findings'] ?? 0)}
          />
        )}

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <Card className="self-start lg:col-span-1">
          <SectionTitle>{t('project.coverage')}</SectionTitle>
          {/* 막대 하나 — 요구사항이 어디까지 왔는지는 다섯 줄의 숫자보다 폭으로 먼저 읽힌다.
              폭만으로 구분하지 않도록 아래에 숫자를 그대로 남긴다(REQ-WEB-033) */}
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-bg-sunken"
            role="img"
            aria-label={t('project.coverage.alt', { total, verified, implemented })}
          >
            <span className="bg-status-ok" style={{ width: `${pct(verified, total)}%` }} />
            <span
              className="bg-status-done"
              style={{ width: `${pct(Math.max(0, implemented - verified), total)}%` }}
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <Metric label={t('project.metric.total')} value={total} />
            <Metric label={t('project.metric.implemented')} value={implemented} />
            <Metric
              label={t('project.metric.verified')}
              value={verified}
              tone={verified > 0 ? 'ok' : undefined}
            />
            {/* 두 숫자가 이 카드의 존재 이유다 — 관계 그래프가 아니면 셀 수 없다(§5.5) */}
            <Metric
              label={t('project.metric.evidence_missing')}
              value={missing}
              tone={missing > 0 ? 'waiting' : undefined}
            />
            <Metric
              label={t('project.metric.empty_promises')}
              value={empty}
              tone={empty > 0 ? 'danger' : undefined}
            />
          </dl>
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
      <section className="max-w-content">
        <SectionTitle>{t('project.recent_events')}</SectionTitle>
        {/* 홈과 **같은 피드**다(REQ-WEB-210) — 이름도 모양도 달랐고, 30줄에서 끝났다 */}
        <EventFeed
          projectSlug={proj}
          projectId={asProjectId(project.data?.['id'])}
          emptyText={t('project.no_events')}
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
  approvals,
  waitingSessions,
  critical,
}: {
  proj: string;
  approvals: number;
  waitingSessions: number;
  critical: number;
}): React.JSX.Element {
  const t = useT();
  const chip = 'rounded-full px-2.5 py-0.5 text-xs font-medium hover:underline';
  return (
    <div
      data-testid="project-waiting"
      className="-mt-2 mb-6 flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="text-xs text-text-faint">{t('project.waiting.label')}</span>
      {approvals === 0 && waitingSessions === 0 && critical === 0 && (
        <span className="text-xs text-text-mute">{t('project.waiting.none')}</span>
      )}
      {approvals > 0 && (
        <Link
          to="/inbox"
          data-testid="project-waiting-approvals"
          className={cn(chip, 'bg-status-action-soft text-status-action')}
        >
          {t('project.waiting.approvals', { count: approvals })}
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
        </Link>
      )}
    </div>
  );
}

function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

/** 숫자 하나 — 0 은 흐리게 둔다. 0 이 눈에 띄면 매번 "뭐가 문제지"를 확인하게 된다 */
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
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
        {value}
      </dd>
    </div>
  );
}
