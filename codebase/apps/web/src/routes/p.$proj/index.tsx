// /p/:proj → S2 프로젝트 개요 (ui-wireframes §2.2 · screens.md §2.3)
//
// 진입 시 `project:{id}` 룸에 join 한다(§1.4 룸 2종). join 하지 않으면 이 화면은 조용히
// 낡은 데이터를 보여준다 — 폴백 폴링이 있지만 그건 끊겼을 때의 안전망이지 기본 경로가 아니다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SessionCard } from '../../features/session-monitor/session-card.js';
import { ConnectAgentLinks } from '../../components/connect-agent-links.js';
import { useCoverage, useProject, useSessions } from '../../lib/queries.js';
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
  const coverage = useCoverage(proj, asProjectId(project.data?.['id']));
  const sessions = useSessions(proj, asProjectId(project.data?.['id']));
  const totals = (coverage.data?.['totals'] ?? {}) as Record<string, number | null>;
  const active = (sessions.data?.items ?? []) as unknown as SessionCardData[];

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
            {t('project.active_sessions', { count: active.length })}
          </SectionTitle>
          {/* 카드가 아니라 줄이다 — 2열로 쪼개면 한 칸이 줄 폭의 절반이라
              고정 폭 열들이 넘쳐 화면이 깨진다(실측 2026-08-23) */}
          <div className="flex flex-col">
            {active.slice(0, 4).map((card) => (
              <SessionCard key={card.id} card={card} projectSlug={proj} />
            ))}
          </div>
          {active.length === 0 && (
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
          )}
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
