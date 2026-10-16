// /p/:proj/coverage — 구현 현황 드릴다운 (screens.md §2.3a · ui-wireframes §4.4 · REQ-WEB-315~317)
//
// 개요의 구현 현황 카드는 **몇 건인지**만 보여 준다. 어느 영역의 어느 문서의 어느 요구사항인지는 여기서 확인한다 — 영역 →
// 문서 → 요구사항으로 내려가고, 요구사항을 펼치면 파생 작업 · 증적 · 발견 · 최근 리뷰가 한자리에 있다. 숫자를 셀 때도
// 거를 때도 판정은 서버다(D-05): 영역 · 문서의 수는 커버리지(EP-COV-01)가, 요구사항의 표시는 목록(EP-REQ-01)이 준다.
//
// 뷰 상태(내려간 자리 · 거르기 · 펼친 요구사항)는 주소에 있다 — 숫자를 누른 그 자리를 링크로 건넨다(D-09). 그래서 단계를
// 오가는 것은 모두 링크다. 단추는 거르기 칸과 요구사항 펼치기 둘뿐이다.

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { rows, useCoverage, useProject, useRequirements } from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
import { asProjectId } from '../../lib/query-keys.js';
import { cn } from '../../lib/utils.js';
import {
  Disclosure,
  EmptyState,
  Mono,
  PageBody,
  PageHeader,
  Skeleton,
  SummaryStrip,
} from '../../components/ui/primitives.js';
import type { SummaryMetric } from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import { StatusBadge } from '../../components/status-badge.js';
import { REQUIREMENT_TOKEN } from '../../components/status-token.js';
import type { StatusToken } from '../../components/status-badge.js';
import { ImportSourceBadge } from '../../components/import-source-badge.js';
import {
  FILTER_COUNT_FIELD,
  NO_AREA,
  matchesFilter,
  validateCoverageSearch,
} from '../../features/coverage-drilldown/coverage-search.js';
import type {
  CoverageFilter,
  CoverageSearch,
} from '../../features/coverage-drilldown/coverage-search.js';
import { RequirementDetail } from '../../features/coverage-drilldown/requirement-detail.js';

export const Route = createFileRoute('/p/$proj/coverage')({
  validateSearch: validateCoverageSearch,
  component: CoverageDrilldown,
});

/** 거르기 칸의 이름 — 개요 카드와 **같은 말**이다(같은 수에 다른 이름을 붙이지 않는다) */
const FILTER_LABEL = {
  evidence_missing: 'project.metric.evidence_missing',
  empty_promises: 'project.metric.empty_promises',
  reverify: 'project.metric.reverify_required',
  import: 'coverage.source_import',
} as const satisfies Record<CoverageFilter, string>;

/** 단계를 오가는 링크의 모양 — 쉴 때도 링크색이다(REQ-WEB-274) */
const STEP_LINK = 'text-link hover:underline';

type SearchPatch = { [K in keyof CoverageSearch]?: CoverageSearch[K] | null };

function CoverageDrilldown(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const project = useProject(proj);
  const coverage = useCoverage(proj, asProjectId(project.data?.['id']));
  const totals = (coverage.data?.['totals'] ?? {}) as Record<string, number | null>;
  const areas = rows(coverage.data?.['areas']);
  const specs = rows(coverage.data?.['specs']);
  const filter = search.filter;
  const covered = coverage.data !== undefined;
  const total = Number(totals['total'] ?? 0);

  /** 뷰 상태 한 축을 바꾸고 나머지는 물고 간다 — `null` 은 그 축을 푼다 */
  const searchWith = (patch: SearchPatch): CoverageSearch => {
    const next: Record<string, string> = {};
    for (const key of ['area', 'spec', 'filter', 'req'] as const) {
      const value = key in patch ? patch[key] : search[key];
      if (typeof value === 'string' && value !== '') next[key] = value;
    }
    return next as CoverageSearch;
  };
  const go = (patch: SearchPatch): void =>
    void navigate({ to: '/p/$proj/coverage', params: { proj }, search: searchWith(patch) });

  // 지금 자리 — 문서가 정해지면 그 문서의 영역도 정해진다(문서 키만 있는 주소로 들어와도 위 단계가 채워진다)
  const specRow =
    search.spec === undefined ? undefined : specs.find((s) => s['key'] === search.spec);
  const areaKey =
    search.area ??
    (specRow === undefined
      ? undefined
      : typeof specRow['area_key'] === 'string'
        ? specRow['area_key']
        : NO_AREA);
  const areaRow =
    areaKey === undefined
      ? undefined
      : areas.find(
          (a) => (typeof a['area_key'] === 'string' ? a['area_key'] : NO_AREA) === areaKey,
        );
  const areaTitle =
    areaKey === NO_AREA
      ? t('project.coverage.no_area')
      : String(areaRow?.['area_title'] ?? areaKey ?? '');
  const toRoot = searchWith({ area: null, spec: null, req: null });
  const withoutFilter = searchWith({ filter: null, req: null });

  const count = (field: string): number | null => (covered ? Number(totals[field] ?? 0) : null);
  /** 거르기 칸 — 누르면 켜고, 켠 칸을 다시 누르면 푼다. 셀 것이 없는 칸은 켤 수 없다 */
  const toggle = (value: CoverageFilter): SummaryMetric => {
    const n = count(FILTER_COUNT_FIELD[value]);
    const pressed = filter === value;
    return {
      label: t(FILTER_LABEL[value]),
      value: n,
      tone: value === 'empty_promises' ? 'danger' : value === 'import' ? 'default' : 'waiting',
      testId: `coverage-filter-${value}`,
      dimmed: filter !== undefined && !pressed,
      toggle: {
        pressed,
        onToggle: () => go({ filter: pressed ? null : value, req: null }),
        disabled: !pressed && (n ?? 0) === 0,
      },
    };
  };
  const derivedRatio = totals['derived_ratio'];

  return (
    <PageBody>
      <PageHeader title={t('coverage.title')} description={t('coverage.description')} />

      {failedWithoutData(coverage) ? (
        <ErrorState error={coverage.error} onRetry={() => void coverage.refetch()} />
      ) : (
        <>
          <SummaryStrip
            data-testid="coverage-summary"
            aria-label={t('coverage.filter.label')}
            metrics={[
              { label: t('project.metric.total'), value: count('total') },
              { label: t('project.metric.implemented'), value: count('implemented') },
              { label: t('project.metric.verified'), value: count('verified'), tone: 'done' },
              toggle('evidence_missing'),
              toggle('empty_promises'),
              toggle('reverify'),
              toggle('import'),
            ]}
          />
          {/* **성공 기준 2-8 은 두 수다**(2026-10-15 · 사람 결정 · REQ-API-312) — 파생한 비율만 적으면 임포트 값으로 남은
              줄이 결함으로 읽힌다 */}
          {covered && total > 0 && typeof derivedRatio === 'number' && (
            <p data-testid="coverage-derived" className="mt-2 text-xs text-text-mute">
              {t('coverage.derived_line', {
                percent: Math.round(derivedRatio * 100),
                count: Number(totals['imported_values'] ?? 0),
              })}
            </p>
          )}

          <nav
            aria-label={t('coverage.title')}
            data-testid="coverage-crumbs"
            className="mt-5 mb-3 flex flex-wrap items-center gap-1.5 text-sm"
          >
            {areaKey === undefined ? (
              <span aria-current="page" className="font-medium">
                {t('coverage.crumb.root')}
              </span>
            ) : (
              <Link to="/p/$proj/coverage" params={{ proj }} search={toRoot} className={STEP_LINK}>
                {t('coverage.crumb.root')}
              </Link>
            )}
            {areaKey !== undefined && (
              <>
                <span aria-hidden="true" className="text-text-ghost">
                  /
                </span>
                {search.spec === undefined ? (
                  <span aria-current="page" className="font-medium">
                    {areaTitle}
                  </span>
                ) : (
                  <Link
                    to="/p/$proj/coverage"
                    params={{ proj }}
                    search={searchWith({ area: areaKey, spec: null, req: null })}
                    className={STEP_LINK}
                  >
                    {areaTitle}
                  </Link>
                )}
              </>
            )}
            {search.spec !== undefined && (
              <>
                <span aria-hidden="true" className="text-text-ghost">
                  /
                </span>
                <span aria-current="page" className="font-medium">
                  {String(specRow?.['title'] ?? search.spec)}
                </span>
              </>
            )}
          </nav>

          {!covered ? (
            <Skeleton rows={4} className="[&>div]:h-12" />
          ) : total === 0 ? (
            // 빈 상태에도 다음 행동이 있다 — 요구사항이 생기는 스펙 목록으로 보낸다(§1.5)
            <EmptyState
              icon="▤"
              title={t('coverage.empty')}
              hint={t('coverage.empty_hint')}
              action={
                <Link to="/p/$proj/specs" params={{ proj }} className={cn('text-sm', STEP_LINK)}>
                  {t('coverage.empty_action')} ▸
                </Link>
              }
            />
          ) : search.spec !== undefined ? (
            specRow === undefined ? (
              <EmptyState
                icon="?"
                title={t('coverage.spec_missing')}
                action={
                  <Link
                    to="/p/$proj/coverage"
                    params={{ proj }}
                    search={toRoot}
                    className={cn('text-sm', STEP_LINK)}
                  >
                    {t('coverage.crumb.root')} ▸
                  </Link>
                }
              />
            ) : (
              <RequirementLevel
                proj={proj}
                specKey={search.spec}
                filter={filter}
                open={search.req}
                onToggle={(ref) => go({ req: search.req === ref ? null : ref })}
                clearFilter={withoutFilter}
              />
            )
          ) : areaKey !== undefined ? (
            <CountList
              testId="coverage-spec-row"
              title={t('coverage.specs')}
              items={specs.filter(
                (s) =>
                  (typeof s['area_key'] === 'string' ? s['area_key'] : NO_AREA) === areaKey &&
                  Number(s['total'] ?? 0) > 0,
              )}
              filter={filter}
              proj={proj}
              keyOf={(s) => String(s['key'])}
              titleOf={(s) => String(s['title'] ?? s['key'])}
              docOf={(s) => String(s['key'])}
              openSearch={(s) => searchWith({ area: areaKey, spec: String(s['key']), req: null })}
              clearFilter={withoutFilter}
            />
          ) : (
            <CountList
              testId="coverage-area-row"
              title={t('coverage.areas')}
              items={areas}
              filter={filter}
              proj={proj}
              keyOf={(a) => (typeof a['area_key'] === 'string' ? a['area_key'] : NO_AREA)}
              titleOf={(a) =>
                typeof a['area_key'] === 'string'
                  ? String(a['area_title'] ?? a['area_key'])
                  : t('project.coverage.no_area')
              }
              docOf={(a) => (typeof a['area_key'] === 'string' ? a['area_key'] : null)}
              openSearch={(a) =>
                searchWith({
                  area: typeof a['area_key'] === 'string' ? a['area_key'] : NO_AREA,
                  spec: null,
                  req: null,
                })
              }
              clearFilter={withoutFilter}
            />
          )}
        </>
      )}
    </PageBody>
  );
}

/**
 * 영역 · 문서 한 단계의 줄들 — 개요 카드의 영역별 분해와 **같은 수 · 같은 막대**다(REQ-WEB-309). 거르기를 켜면 그 수가
 * 0 인 줄은 빠진다 — 내려갈 곳이 없는 줄을 남기면 누르고 나서야 비었다는 것을 안다.
 */
function CountList({
  testId,
  title,
  items,
  filter,
  proj,
  keyOf,
  titleOf,
  docOf,
  openSearch,
  clearFilter,
}: {
  testId: string;
  title: string;
  items: Row[];
  filter: CoverageFilter | undefined;
  proj: string;
  keyOf: (row: Row) => string;
  titleOf: (row: Row) => string;
  /** 그 줄의 문서 키 — 영역 밖 무리에는 문서가 없다 */
  docOf: (row: Row) => string | null;
  /** 그 줄로 내려가는 주소의 뷰 상태 */
  openSearch: (row: Row) => CoverageSearch;
  clearFilter: CoverageSearch;
}): React.JSX.Element {
  const t = useT();
  const shown =
    filter === undefined
      ? items
      : items.filter((row) => Number(row[FILTER_COUNT_FIELD[filter]] ?? 0) > 0);
  if (shown.length === 0) {
    return <FilteredEmpty proj={proj} clearFilter={clearFilter} />;
  }
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-text-mute">{title}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-nerv border border-border">
        {shown.map((row) => {
          const n = (field: string): number => Number(row[field] ?? 0);
          const total = n('total');
          const warnings = (
            [
              ['evidence_missing', 'project.metric.evidence_missing'],
              ['empty_promises', 'project.metric.empty_promises'],
              ['reverify_required', 'project.metric.reverify_required'],
              ['imported_values', 'coverage.source_import'],
            ] as const
          ).filter(([field]) => n(field) > 0);
          const doc = docOf(row);
          return (
            <li key={keyOf(row)} data-testid={testId} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  to="/p/$proj/coverage"
                  params={{ proj }}
                  search={openSearch(row)}
                  data-testid={`${testId}-open`}
                  className={cn('min-w-0 truncate text-sm font-medium', STEP_LINK)}
                >
                  {titleOf(row)} <span aria-hidden="true">▸</span>
                </Link>
                <span className="shrink-0 text-xs text-text-mute tabular-nums">
                  {t('project.coverage.area_counts', {
                    implemented: n('implemented'),
                    verified: n('verified'),
                    total,
                  })}
                </span>
              </div>
              <div
                className="flex h-1 overflow-hidden rounded-full bg-bg-sunken"
                role="img"
                aria-label={t('project.coverage.alt', {
                  total,
                  verified: n('verified'),
                  implemented: n('implemented'),
                })}
              >
                <span className="bg-status-ok" style={{ width: `${pct(n('verified'), total)}%` }} />
                <span
                  className="bg-status-done"
                  style={{
                    width: `${pct(Math.max(0, n('implemented') - n('verified')), total)}%`,
                  }}
                />
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-text-faint">
                  {warnings.map(([field, label]) => `${t(label)} ${n(field)}`).join(' · ')}
                </span>
                {doc !== null && (
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj, spec: doc }}
                    className={cn('shrink-0', STEP_LINK)}
                  >
                    {t('coverage.open_doc')} ▸
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 요구사항 단계 — 문서 하나의 요구사항 줄. 줄의 펼치기를 누르면 그 자리에서 펼친다(REQ-WEB-316) */
function RequirementLevel({
  proj,
  specKey,
  filter,
  open,
  onToggle,
  clearFilter,
}: {
  proj: string;
  specKey: string;
  filter: CoverageFilter | undefined;
  open: string | undefined;
  onToggle: (ref: string) => void;
  clearFilter: CoverageSearch;
}): React.JSX.Element {
  const t = useT();
  const query = useRequirements(proj, specKey);
  if (query.isPending) return <Skeleton rows={3} className="[&>div]:h-14" />;
  if (failedWithoutData(query)) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  const items = rows(query.data).filter((r) => filter === undefined || matchesFilter(r, filter));
  if (items.length === 0) return <FilteredEmpty proj={proj} clearFilter={clearFilter} />;
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-mute">{t('coverage.requirements')}</h2>
        <Link
          to="/p/$proj/specs/$spec"
          params={{ proj, spec: specKey }}
          search={{ rail: 'requirements' }}
          className={cn('text-xs', STEP_LINK)}
        >
          {t('coverage.open_doc')} ▸
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-nerv border border-border">
        {items.map((r) => {
          const ref = String(r['ref']);
          const expanded = open === ref;
          const status = String(r['impl_status']);
          return (
            <li
              key={String(r['id'])}
              data-testid="coverage-req"
              data-ref={ref}
              className={cn('flex flex-col gap-1 px-3 py-2.5', expanded && 'bg-bg-elev')}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Disclosure
                  expanded={expanded}
                  onToggle={() => onToggle(ref)}
                  testId="coverage-req-toggle"
                >
                  <Mono>{ref}</Mono>
                </Disclosure>
                <StatusBadge
                  token={
                    (REQUIREMENT_TOKEN[status as keyof typeof REQUIREMENT_TOKEN] ??
                      'idle') as StatusToken
                  }
                  label={t(statusLabelKey('requirement', status))}
                />
                <ImportSourceBadge source={r['impl_status_source']} />
                {r['evidence_missing'] === true && (
                  <StatusBadge
                    token="waiting"
                    mark={null}
                    size="sm"
                    label={t('project.metric.evidence_missing')}
                  />
                )}
                {r['empty_promise'] === true && (
                  <StatusBadge
                    token="danger"
                    mark={null}
                    size="sm"
                    label={t('project.metric.empty_promises')}
                  />
                )}
                {r['reverify_required'] === true && (
                  <StatusBadge
                    token="waiting"
                    mark={null}
                    size="sm"
                    label={t('project.metric.reverify_required')}
                  />
                )}
              </div>
              <p className="line-clamp-2 text-xs text-text-mute">
                {String(r['statement_md'] ?? '')}
              </p>
              <p className="text-2xs text-text-faint">
                {t('spec.requirements.counts', {
                  tasks: Number(r['task_count'] ?? 0),
                  evidence: Number(r['evidence_count'] ?? 0),
                })}
              </p>
              {expanded && (
                <RequirementDetail projectSlug={proj} specKey={specKey} requirementRef={ref} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 거른 결과가 비었다 — 거르기를 푸는 링크를 둔다(빈 상태에도 다음 행동이 있어야 한다 · §1.5) */
function FilteredEmpty({
  proj,
  clearFilter,
}: {
  proj: string;
  clearFilter: CoverageSearch;
}): React.JSX.Element {
  const t = useT();
  return (
    <EmptyState
      icon="·"
      title={t('coverage.empty_filtered')}
      action={
        <Link
          to="/p/$proj/coverage"
          params={{ proj }}
          search={clearFilter}
          data-testid="coverage-clear-filter"
          className={cn('text-sm', STEP_LINK)}
        >
          {t('coverage.clear_filter')}
        </Link>
      }
    />
  );
}

function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}
