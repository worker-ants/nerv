// 범위 칸 — 모든 조직의 목록을 조직 · 프로젝트 하나로 좁힌다 (screens.md §2.9 · REQ-WEB-253)
//
// 알림과 받은 요청은 내가 속한 모든 조직의 항목을 한 목록에 모은다(FR-14 · REQ-WEB-193). 사람의
// 하루가 프로젝트로 나뉘어 있지 않아서다. 그래도 한 프로젝트의 일만 보고 처리하고 싶은 때가 있다
// (2026-09-27 사람 요청). 목록을 프로젝트마다 따로 두지 않고, 같은 목록을 좁히는 칸을 둔다 —
// 두 번째 받은 요청을 만들면 둘이 갈라진다(REQ-API-167 의 교훈 · 사람 결정 N1).
//
// 칸은 주소를 바꾸는 링크다. 좁힌 목록을 링크로 보낼 수 있어야 하고(REQ-WEB-218 과 같은 규칙),
// 가운데 클릭으로 새 탭에 열 수 있어야 한다.

import { Fragment } from 'react';
import { cn } from '../../lib/utils.js';

/** 칸의 한 줄 — 내가 속한 프로젝트 하나 */
export interface ScopeRailRow {
  org_slug: string;
  org_name: string;
  project_slug: string;
  project_name: string;
  /** 붉은 수 — 알림은 안 읽은 중요 알림. 0 이면 그리지 않는다 */
  urgent: number;
  /** 회색 수 — 알림은 안 읽은 전체 */
  count: number;
  /** 이름 옆의 작은 표시 — 알림은 기본이 아닌 받는 수준("중요만" · "알리지 않음" · REQ-WEB-259) */
  tag?: string;
}

/** 고른 범위 — 조직 slug 와 프로젝트 slug. 둘 다 없으면 모든 조직이다 */
export interface ScopeSelection {
  org?: string;
  project?: string;
}

export function sameScope(a: ScopeSelection, b: ScopeSelection): boolean {
  return (a.org ?? '') === (b.org ?? '') && (a.project ?? '') === (b.project ?? '');
}

/** 범위의 이름 — 조직이 둘 이상이면 프로젝트 앞에 조직을 붙인다(ScopeBadge 와 같은 규칙 · REQ-WEB-192) */
export function scopeName(rows: readonly ScopeRailRow[], selection: ScopeSelection): string | null {
  if (selection.project !== undefined) {
    const row = rows.find(
      (r) =>
        r.project_slug === selection.project &&
        (selection.org === undefined || r.org_slug === selection.org),
    );
    const name = row?.project_name ?? selection.project;
    const orgs = new Set(rows.map((r) => r.org_slug));
    return orgs.size > 1 && row !== undefined ? `${row.org_name} / ${name}` : name;
  }
  if (selection.org !== undefined) {
    return rows.find((r) => r.org_slug === selection.org)?.org_name ?? selection.org;
  }
  return null;
}

/** 고른 범위 안의 수 — 칸의 줄을 더한다(모든 조직이면 전부) */
export function scopeTotals(
  rows: readonly ScopeRailRow[],
  selection: ScopeSelection,
): { urgent: number; count: number } {
  const inside = rows.filter(
    (r) =>
      (selection.org === undefined || r.org_slug === selection.org) &&
      (selection.project === undefined || r.project_slug === selection.project),
  );
  return {
    urgent: inside.reduce((sum, r) => sum + r.urgent, 0),
    count: inside.reduce((sum, r) => sum + r.count, 0),
  };
}

export function ScopeRail({
  rows,
  selected,
  heading,
  allLabel,
  urgentTitle,
  countTitle,
  hrefFor,
  onSelect,
}: {
  rows: readonly ScopeRailRow[];
  selected: ScopeSelection;
  heading: string;
  /** 맨 윗줄 — "모든 조직" */
  allLabel: string;
  /** 붉은 수 · 회색 수의 뜻 — 수만으로는 무엇을 셌는지 모른다(REQ-WEB-033) */
  urgentTitle: (count: number) => string;
  countTitle: (count: number) => string;
  hrefFor: (selection: ScopeSelection) => string;
  onSelect: (selection: ScopeSelection) => void;
}): React.JSX.Element {
  const orgs = [...new Map(rows.map((r) => [r.org_slug, r.org_name])).entries()];
  const multiOrg = orgs.length > 1;
  const total = scopeTotals(rows, {});

  const item = (
    label: React.ReactNode,
    selection: ScopeSelection,
    sums: { urgent: number; count: number },
    testId: string,
    tone: 'all' | 'org' | 'project',
  ): React.JSX.Element => {
    const on = sameScope(selected, selection);
    return (
      <a
        href={hrefFor(selection)}
        data-testid={testId}
        aria-current={on ? 'true' : undefined}
        onClick={(e) => {
          // 가운데 클릭 · 수정 키는 브라우저에 맡긴다 — 새 탭으로 좁힌 목록을 연다
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onSelect(selection);
        }}
        className={cn(
          'flex items-center justify-between gap-2 rounded-nerv-sm px-1.5 py-0.5 text-xs transition-colors',
          on ? 'bg-bg-sunken font-medium text-text' : 'text-text-mute hover:text-text',
          // 좁은 폭에서는 칩 줄이다 — 테두리가 없으면 이름과 숫자가 한 문장처럼 이어졌다(REQ-WEB-274)
          'max-lg:rounded-full max-lg:border max-lg:border-border-strong max-lg:px-2.5',
          tone === 'org' && 'font-semibold',
          tone === 'project' && multiOrg && 'lg:pl-4',
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs tabular-nums">
          {sums.urgent > 0 && (
            <span className="text-status-danger" title={urgentTitle(sums.urgent)}>
              {sums.urgent}
            </span>
          )}
          <span className="text-text-faint" title={countTitle(sums.count)}>
            {sums.count}
          </span>
        </span>
      </a>
    );
  };

  return (
    <nav aria-label={heading} data-testid="scope-rail" className="w-full shrink-0 lg:w-52">
      <p className="mb-1 hidden text-2xs font-semibold tracking-wide text-text-faint uppercase lg:block">
        {heading}
      </p>
      {/* 좁은 폭에서는 칩 줄, 넓은 폭에서는 세로 목록이다 — 리뷰 센터의 거르는 칸과 같은 모양 */}
      <ul className="flex flex-wrap gap-1 lg:flex-col lg:gap-0.5">
        <li>{item(allLabel, {}, total, 'scope-all', 'all')}</li>
        {orgs.map(([orgSlug, orgName]) => (
          <Fragment key={orgSlug}>
            {/* 조직이 하나뿐이면 조직 줄은 "모든 조직" 과 같다 — 두 번 적지 않는다 */}
            {multiOrg && (
              <li>
                {item(
                  orgName,
                  { org: orgSlug },
                  scopeTotals(rows, { org: orgSlug }),
                  `scope-org-${orgSlug}`,
                  'org',
                )}
              </li>
            )}
            {rows
              .filter((r) => r.org_slug === orgSlug)
              .map((r) => (
                <li key={`${r.org_slug}/${r.project_slug}`}>
                  {item(
                    <>
                      {/* 넓은 폭은 조직 아래에 들여 쓰므로 조직 이름이 필요 없다 */}
                      {multiOrg && <span className="lg:hidden">{r.org_name} / </span>}
                      {r.project_name}
                      {r.tag !== undefined && (
                        <span
                          data-testid={`scope-tag-${r.org_slug}-${r.project_slug}`}
                          className="ml-1.5 text-2xs text-text-faint"
                        >
                          {r.tag}
                        </span>
                      )}
                    </>,
                    { org: r.org_slug, project: r.project_slug },
                    { urgent: r.urgent, count: r.count },
                    `scope-project-${r.org_slug}-${r.project_slug}`,
                    'project',
                  )}
                </li>
              ))}
          </Fragment>
        ))}
      </ul>
    </nav>
  );
}
