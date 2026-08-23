// /p/:proj → S2 프로젝트 개요 (ui-wireframes §2.2 · screens.md §2.3)
//
// 진입 시 `project:{id}` 룸에 join 한다(§1.4 룸 2종). join 하지 않으면 이 화면은 조용히
// 낡은 데이터를 보여준다 — 폴백 폴링이 있지만 그건 끊겼을 때의 안전망이지 기본 경로가 아니다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SessionCard } from '../../features/session-monitor/session-card.js';
import { eventLabel } from '../../lib/event-label.js';
import { relativeTime } from '../../lib/format.js';
import { rows, useCoverage, useEvents, useProject, useSessions } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';
import {
  Card,
  EmptyState,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,
} from '../../components/ui/primitives.js';
import type { SessionCard as SessionCardData } from '../../features/session-monitor/types.js';

export const Route = createFileRoute('/p/$proj/')({ component: ProjectOverview });

function ProjectOverview(): React.JSX.Element {
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const coverage = useCoverage(proj, projectIdOf(project.data));
  const sessions = useSessions(proj, projectIdOf(project.data));
  const events = useEvents(proj, projectIdOf(project.data));
  const { joinProject } = useRealtime();

  const projectId = project.data?.['id'];
  useEffect(() => {
    if (typeof projectId !== 'string') return;
    return joinProject(projectId);
  }, [joinProject, projectId]);

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
          <SectionTitle>구현 현황</SectionTitle>
          {/* 막대 하나 — 요구사항이 어디까지 왔는지는 다섯 줄의 숫자보다 폭으로 먼저 읽힌다.
              폭만으로 구분하지 않도록 아래에 숫자를 그대로 남긴다(REQ-WEB-033) */}
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-bg-sunken"
            role="img"
            aria-label={`요구사항 ${total}건 중 검증 ${verified}건 · 구현 ${implemented}건`}
          >
            <span className="bg-status-ok" style={{ width: `${pct(verified, total)}%` }} />
            <span
              className="bg-status-done"
              style={{ width: `${pct(Math.max(0, implemented - verified), total)}%` }}
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <Metric label="요구사항" value={total} />
            <Metric label="구현" value={implemented} />
            <Metric label="검증" value={verified} tone={verified > 0 ? 'ok' : undefined} />
            {/* 두 숫자가 이 카드의 존재 이유다 — 관계 그래프가 아니면 셀 수 없다(§5.5) */}
            <Metric label="증적 결손" value={missing} tone={missing > 0 ? 'waiting' : undefined} />
            <Metric label="빈 약속" value={empty} tone={empty > 0 ? 'danger' : undefined} />
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
                전체 ▸
              </Link>
            }
          >
            활성 세션 {active.length}개
          </SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {active.slice(0, 4).map((card) => (
              <SessionCard key={card.id} card={card} />
            ))}
          </div>
          {active.length === 0 && (
            <EmptyState
              icon="◉"
              title="지금 도는 세션이 없습니다."
              hint={
                <>
                  에이전트가 <code className="font-mono text-text-mute">/nerv:next</code> 로 작업을
                  잡으면 여기에 나타납니다.
                </>
              }
            />
          )}
        </Card>
      </section>

      {/* 트리는 **셸 사이드바가 소유한다**(§1.3) — 와이어프레임 §2.2 의 좌측 열이 그것이다.
          여기서 또 그리면 같은 트리가 나란히 두 개 뜬다(문서 대조에서 발견). */}
      <section className="max-w-content">
        <SectionTitle>최근 이벤트</SectionTitle>
        {events.isLoading && <Skeleton rows={4} />}
        <ul className="flex flex-col">
          {rows(events.data).map((e) => (
            <li
              key={String(e['id'])}
              className="flex items-center gap-2 border-b border-border py-1.5 text-sm last:border-0"
            >
              {/* 사람/에이전트 구분은 감사의 첫 질문이다(FR-16 · D-08) */}
              <span
                aria-label={e['is_agent'] === true ? '에이전트' : '사람'}
                title={e['is_agent'] === true ? '에이전트' : '사람'}
                className="shrink-0 text-xs"
              >
                {e['is_agent'] === true ? '🤖' : '👤'}
              </span>
              <span className="min-w-0 flex-1 truncate">{eventLabel(String(e['type']))}</span>
              <span className="shrink-0 text-xs text-text-mute">
                {String(e['actor_name'] ?? '')}
              </span>
              <span className="w-16 shrink-0 text-right text-xs text-text-faint">
                {relativeTime(typeof e['occurred_at'] === 'string' ? e['occurred_at'] : null)}
              </span>
            </li>
          ))}
        </ul>
        {!events.isLoading && rows(events.data).length === 0 && (
          <EmptyState icon="·" title="아직 기록된 활동이 없습니다." />
        )}
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

/** 프로젝트 UUID — 쿼리 키가 이벤트 봉투의 project_id 와 같은 축이어야 갱신이 산다. */
function projectIdOf(project: Record<string, unknown> | undefined): string | undefined {
  const id = project?.['id'];
  return typeof id === 'string' ? id : undefined;
}
