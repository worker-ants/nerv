// /p/:proj/reviews → S6 리뷰 센터 (ui-wireframes §2.6 · screens.md §2.6a)
//
// **필터가 왼쪽 첫 칸에 오는 이유.** QA 의 하루는 "AI 가 찾은 것을 다시 읽는" 것이 아니라
// 무엇이 위험한지 **고르는** 것이다(와이어프레임 §2.6 ①). 그래서 첫 화면이 원시 diff 가
// 아니라 정리된 finding 큐이고, 고르는 도구가 목록보다 먼저 놓인다.
//
// 이 화면이 대체하는 것은 clemvion 의 `review/**` md 13,777개(131MB)다.

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { FindingCard } from '../../features/review-center/finding-card.js';
import { GateCoverage } from '../../features/review-center/gate-coverage.js';
import { ResolveDialog } from '../../features/review-center/resolve-dialog.js';
import type { ResolveAction } from '../../features/review-center/resolve-dialog.js';
import { useT } from '../../lib/i18n.js';
import { rows, useFindings, useGateCoverage, useMe, useProject } from '../../lib/queries.js';
import { primaryMembership } from '../../lib/session.js';
import { cn } from '../../lib/utils.js';
import {
  Card,
  EmptyState,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,
  SummaryStrip,
} from '../../components/ui/primitives.js';
import type { SummaryMetric } from '../../components/ui/primitives.js';

export const Route = createFileRoute('/p/$proj/reviews/')({ component: ReviewCenter });

const SEVERITIES = ['critical', 'warning', 'info'] as const;
const STATUSES = ['open', 'fixed', 'dismissed', 'wont_fix'] as const;

/** 처분할 수 있는 역할 — 정본은 서버의 `ROLE_SCOPES` 다. 화면은 버튼을 **비활성 + 사유**로 둔다(REQ-WEB-003) */
const RESOLVER_ROLES = ['admin', 'planner', 'qa'];

function ReviewCenter(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const me = useMe();
  const projectId = project.data?.['id'];
  const id = typeof projectId === 'string' ? projectId : undefined;

  // 큐는 **열린 것으로 시작한다** — 처분한 것까지 함께 보이면 큐가 큐이기를 그만둔다
  const [severity, setSeverity] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(['open']);
  const [tag, setTag] = useState<string[]>([]);
  const [resolving, setResolving] = useState<{ id: string; action: ResolveAction } | null>(null);

  const queue = useFindings(proj, { severity, status, tag }, id);
  const gate = useGateCoverage(proj, id);
  const roles = me.data === undefined ? [] : (primaryMembership(me.data)?.roles ?? []);
  const canResolve = roles.some((r) => RESOLVER_ROLES.includes(r));

  const facets = queue.data?.facets;
  const items = queue.data?.items ?? [];
  const summary: SummaryMetric[] = [
    {
      label: t('reviews.summary.critical'),
      value: facets?.severity['critical'] ?? 0,
      tone: 'danger',
    },
    { label: t('reviews.summary.open'), value: facets?.status['open'] ?? 0 },
    { label: t('reviews.summary.branches'), value: rows(gate.data).length },
  ];

  const toggle = (list: string[], set: (v: string[]) => void, value: string): void =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <PageBody wide>
      <PageHeader title={t('reviews.title')} description={t('reviews.lead')} />
      <SummaryStrip className="mb-5" metrics={summary} />

      {/* 필터 | 큐 — **가로로 나란히**다(2026-08-23 사람 판단, §2.5 와 같은 규칙).
          아래에 두면 목록을 다 지나 스크롤해야 닿는다 */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-52">
          <FacetGroup
            label={t('reviews.filter.severity')}
            values={SEVERITIES}
            selected={severity}
            counts={facets?.severity ?? {}}
            labelOf={(v) => t(`severity.${v}` as 'severity.info')}
            onToggle={(v) => toggle(severity, setSeverity, v)}
          />
          <FacetGroup
            label={t('reviews.filter.status')}
            values={STATUSES}
            selected={status}
            counts={facets?.status ?? {}}
            labelOf={(v) => t(`status.finding.${v}` as 'status.finding.open')}
            onToggle={(v) => toggle(status, setStatus, v)}
          />
          {Object.keys(facets?.tag ?? {}).length > 0 && (
            <FacetGroup
              label={t('reviews.filter.tag')}
              values={Object.keys(facets?.tag ?? {})}
              selected={tag}
              counts={facets?.tag ?? {}}
              labelOf={(v) => v}
              onToggle={(v) => toggle(tag, setTag, v)}
            />
          )}
          {(severity.length > 0 || tag.length > 0 || status.join() !== 'open') && (
            <button
              type="button"
              data-testid="filter-reset"
              className="mt-2 text-2xs text-text-faint hover:text-text"
              onClick={() => {
                setSeverity([]);
                setStatus(['open']);
                setTag([]);
              }}
            >
              {t('reviews.filter.reset')}
            </button>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          <SectionTitle>{t('reviews.queue.title')}</SectionTitle>
          {queue.isPending ? (
            <div data-testid="finding-queue-skeleton" className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : queue.isError ? (
            <EmptyState icon="⚠" title={t('reviews.queue.error')} />
          ) : items.length === 0 ? (
            // 막다른 길을 두지 않는다(§1.5) — 발견이 없으면 **어디서 들어오는지**를 말한다
            <EmptyState
              icon="◈"
              title={t('reviews.queue.empty')}
              hint={t('reviews.queue.empty_hint')}
            />
          ) : (
            <Card className="@container p-0">
              {items.map((finding) => (
                <div key={String(finding['id'])}>
                  <FindingCard
                    finding={finding}
                    projectSlug={proj}
                    canResolve={canResolve}
                    onResolve={(f, action) => setResolving({ id: String(f['id']), action })}
                  />
                  {resolving?.id === String(finding['id']) && (
                    <div className="px-4 pb-3">
                      <ResolveDialog
                        projectSlug={proj}
                        projectId={id}
                        finding={finding}
                        action={resolving.action}
                        onDone={() => setResolving(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      <div className="mt-6">
        <GateCoverage rows={rows(gate.data)} />
      </div>
    </PageBody>
  );
}

/**
 * facet 칸 — **숫자가 같은 응답에서 온다**(REQ-WEB-061). 따로 받으면 목록과 숫자가
 * 어긋나는 순간이 생기고, QA 는 "3건이라더니 4건"을 보게 된다.
 */
function FacetGroup({
  label,
  values,
  selected,
  counts,
  labelOf,
  onToggle,
}: {
  label: string;
  values: readonly string[];
  selected: readonly string[];
  counts: Record<string, number>;
  labelOf: (value: string) => string;
  onToggle: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="mb-3">
      <p className="mb-1 text-2xs font-semibold tracking-wide text-text-faint uppercase">{label}</p>
      <div className="flex flex-wrap gap-1 lg:flex-col lg:gap-0.5">
        {values.map((value) => {
          const on = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              data-testid={`facet-${value}`}
              aria-pressed={on}
              onClick={() => onToggle(value)}
              className={cn(
                'flex items-center justify-between gap-2 rounded-nerv-sm px-1.5 py-0.5 text-xs transition-colors',
                on ? 'bg-bg-sunken font-medium text-text' : 'text-text-mute hover:text-text',
              )}
            >
              <span>
                {/* 켜짐을 색만으로 알리지 않는다(REQ-WEB-033) */}
                <span aria-hidden="true" className="mr-1 font-mono text-2xs">
                  {on ? '☑' : '☐'}
                </span>
                {labelOf(value)}
              </span>
              <span className="font-mono text-2xs text-text-faint">{counts[value] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
