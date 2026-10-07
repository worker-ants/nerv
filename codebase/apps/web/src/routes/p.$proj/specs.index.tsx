// /p/:proj/specs — 스펙 목록(트리 전체 화면) + 검색 결과 뷰 (screens.md §2.4 · REQ-WEB-041~043)
//
// 검색 결과가 이 화면의 절반이다. `related[]`(관계 확장)를 **본 결과와 구분해서** 보여주는
// 것이 요점 — 관계는 관련성의 근거이지 질의 일치가 아니다. 섞으면 사람은 왜 이게 나왔는지
// 알 수 없고, 그러면 검색을 믿지 않게 된다.

import { BULK_DECISION_LIMIT, specType, specVersionStatus, statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';

// 그래프 라이브러리는 **탭을 누를 때** 받는다 — gzip 173KB 다. 대부분의 방문은 트리만 쓰는데
// 그 비용을 목록 화면 전체가 미리 치를 이유가 없다.
const SpecGraph = lazy(async () => ({
  default: (await import('../../features/spec-graph/graph.js')).SpecGraph,
}));
const SpecTable = lazy(async () => ({
  default: (await import('../../features/spec-graph/table.js')).SpecTable,
}));
import { useQuery } from '@tanstack/react-query';
import { SpecTree } from '../../components/spec-tree.js';
import { FreezeDialog, ViewBasisSelect } from '../../features/spec-editor/baseline-controls.js';

import { StatusBadge } from '../../components/status-badge.js';
import { SPEC_VERSION_TOKEN } from '../../components/status-token.js';
import { apiFetch } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { useMe, useProject, useSpecGraph } from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
import { rolesInProject } from '../../lib/session.js';
import { useRolesOnly, useScope } from '../../lib/scope.js';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Segmented,
  Skeleton,
} from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';
import { ArrangeBar } from '../../features/spec-editor/arrange-bar.js';
import { DecisionBar } from '../../features/spec-editor/decision-bar.js';
import { asProjectId, queryKeys } from '../../lib/query-keys.js';
import {
  NEWER_STATUS,
  hasNewerVersion,
  viewBasisKey,
  viewBasisQuery,
  viewBasisSearch,
  type ViewBasis,
} from '../../lib/view-basis.js';

export const Route = createFileRoute('/p/$proj/specs/')({
  // 보관 보기는 **뷰 상태**라 주소에 남는다(§2.4 (3)) — 링크로 건네면 상대도 같은 목록을 본다
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    archived?: true;
    attach?: true;
    baseline?: string;
    pending?: true;
    basis?: 'latest';
    focus?: string;
    layout?: number;
    q?: string;
    status?: string;
    type?: string;
    view?: SpecView;
  } => ({
    // 주소는 JSON 으로 읽힌다 — `?archived=1` 은 숫자 1 로 온다(board-search.ts 의 같은 결함)
    ...(search['archived'] === true || search['archived'] === 1 || search['archived'] === '1'
      ? { archived: true as const }
      : {}),
    // **첨부 있음**도 뷰 상태다(2026-10-04 · REQ-WEB-289) — 시안이 붙은 문서 목록을 링크로 건넨다
    ...(search['attach'] === true || search['attach'] === 1 || search['attach'] === '1'
      ? { attach: true as const }
      : {}),
    // **결재 대기**도 뷰 상태다(2026-10-04 · REQ-WEB-292) — "내가 결정할 문서" 목록을 링크로 다시 연다
    ...(search['pending'] === true || search['pending'] === 1 || search['pending'] === '1'
      ? { pending: true as const }
      : {}),
    // **검색어도 뷰 상태다**(§2.4 (3) · screens.md:583 — "검색·타입·상태 필터는 URL 쿼리로
    // 보존"). 컴포넌트 state 로 두면 "이 검색 결과를 봐 달라" 를 링크로 건넬 수 없고,
    // 새로고침 한 번에 사라진다 — 상태·타입은 이미 주소에 있는데 검색어만 빠져 있었다.
    ...(typeof search['q'] === 'string' && search['q'] !== '' ? { q: search['q'] } : {}),
    // 고른 기준선도 **뷰 상태**다 — 링크로 건네면 상대도 같은 세트를 본다(REQ-WEB-135)
    ...(typeof search['baseline'] === 'string' && search['baseline'] !== ''
      ? { baseline: search['baseline'] }
      : {}),
    // **최신으로 읽기**도 뷰 상태다(2026-09-27 · REQ-WEB-248). 기준선과 배타라 기준선이 있으면 버린다 —
    // 기본(승인본)은 적지 않는다(REQ-WEB-163)
    ...(search['basis'] === 'latest' &&
    !(typeof search['baseline'] === 'string' && search['baseline'] !== '')
      ? { basis: 'latest' as const }
      : {}),
    // 상태 필터도 마찬가지다(§2.4 (3) · REQ-WEB-138) — "초안만 모아 둔 목록" 을 링크로 건넨다.
    // 쉼표 목록인 것은 서버 질의(EP-SPEC-01 `?status=`)와 같은 모양이라 옮겨 적기 쉬워서다.
    ...(typeof search['status'] === 'string' && search['status'] !== ''
      ? { status: search['status'] }
      : {}),
    ...(typeof search['type'] === 'string' && search['type'] !== ''
      ? { type: search['type'] }
      : {}),
    // **보는 방식도 뷰 상태다**(2026-09-24 · SPEC-07 · REQ-WEB-211). 컴포넌트 state 라서 그래프에서
    // 노드를 골라 상세에 들어갔다가 뒤로 오면 트리로 돌아와 있었다 — 고른 중심도 함께 사라졌다.
    // 기본(tree)은 적지 않는다: 뜻 없는 인자를 주소에 남기지 않는 규칙이다(REQ-WEB-163)
    ...(search['view'] === 'table' || search['view'] === 'graph' ? { view: search['view'] } : {}),
    // 그래프의 **중심 문서**. 상세의 [그래프에서 보기]가 이것으로 온다
    ...(typeof search['focus'] === 'string' && search['focus'] !== ''
      ? { focus: search['focus'] }
      : {}),
    // 그래프의 **배치 번호**(REQ-WEB-245) — 같은 번호면 같은 그림이다. 기본(1)은 적지 않는다
    ...(layoutNumber(search['layout']) === undefined
      ? {}
      : { layout: layoutNumber(search['layout']) as number }),
  }),
  component: SpecListScreen,
});

/** `?layout=` — 2 이상의 정수만 받는다(1 은 기본이라 적지 않는다). 주소는 JSON 으로 읽혀 숫자로 온다 */
function layoutNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 2 && n <= 9999 ? n : undefined;
}

type SpecView = 'tree' | 'table' | 'graph';

/** 어휘의 정본은 `@nerv/schema` 의 enum 이다 — 목록을 화면이 새로 만들지 않는다 */
const SPEC_STATUSES = specVersionStatus.enumValues;
const SPEC_TYPES = specType.enumValues;

interface SearchResult {
  items: Record<string, unknown>[];
  related: Record<string, unknown>[];
  degraded: string | null;
  /** 어느 버전의 본문에서 찾았나(REQ-API-195) */
  basis?: 'approved' | 'latest' | 'baseline';
  baseline?: string;
}

function SpecListScreen(): React.JSX.Element {
  const t = useT();
  // 역할을 모르는 동안의 잠금 사유는 "불러오는 중…" 이다(REQ-WEB-295)
  const rolesOnly = useRolesOnly();
  const { proj } = Route.useParams();
  const navigate = useNavigate();
  const {
    archived = false,
    attach = false,
    pending = false,
    baseline,
    basis,
    focus,
    layout,
    q,
    status,
    type,
    view: rawView,
  } = Route.useSearch();
  // 부모 라우트는 검사하지 않은 인자를 흘려보낸다 — `validateSearch` 가 버린 값도 여기 온다
  const view: SpecView = rawView === 'table' || rawView === 'graph' ? rawView : 'tree';
  const statuses = status === undefined ? [] : status.split(',').filter((value) => value !== '');
  /** 정리 모드 — 화면의 일시 상태다(주소에 남기지 않는다: 링크로 건넬 일이 아니다) */
  const [arranging, setArranging] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [titleFiltered, setTitleFiltered] = useState(false);
  const toggleSelected = useCallback((key: string) => {
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const types = type === undefined ? [] : type.split(',').filter((value) => value !== '');
  /** 버전 기준 — 목록 · 표 · 그래프 · 검색 · 상세가 모두 이것으로 읽는다(REQ-WEB-248) */
  const viewBasis: ViewBasis =
    baseline !== undefined ? { baseline } : basis === 'latest' ? { latest: true } : {};
  /**
   * 뷰 상태는 **서로를 지우지 않는다** — 하나를 바꿀 때 나머지를 그대로 싣는다.
   *
   * 손으로 펼쳐 적던 동안 실제로 지워지고 있었다: 보관 토글이 고른 기준선을 날렸다.
   * 넷이 되면 손으로는 반드시 하나를 빠뜨린다. `null` 은 "지운다", 생략은 "그대로".
   */
  const searchWith = (patch: {
    archived?: boolean;
    attach?: boolean;
    pending?: boolean;
    baseline?: string | null;
    basis?: 'latest' | null;
    focus?: string | null;
    layout?: number | null;
    q?: string | null;
    status?: string | null;
    type?: string | null;
    view?: SpecView;
  }): {
    archived?: true;
    attach?: true;
    pending?: true;
    baseline?: string;
    basis?: 'latest';
    focus?: string;
    layout?: number;
    q?: string;
    status?: string;
    type?: string;
    view?: SpecView;
  } => {
    const pick = (next: string | null | undefined, now: string | undefined): string | undefined =>
      next === undefined ? now : (next ?? undefined);
    const nextBaseline = pick(patch.baseline, baseline);
    // 기준선과 최신은 배타다 — 기준선이 남으면 최신은 버린다
    const nextBasis =
      nextBaseline !== undefined && nextBaseline !== ''
        ? undefined
        : patch.basis === undefined
          ? basis
          : (patch.basis ?? undefined);
    const nextQuery = pick(patch.q, q);
    const nextStatus = pick(patch.status, status);
    const nextType = pick(patch.type, type);
    const nextView = patch.view ?? view;
    // 중심과 배치 번호는 그래프의 것이다 — 다른 보기로 옮기면 함께 내려놓는다
    const nextFocus = nextView === 'graph' ? pick(patch.focus, focus) : undefined;
    const nextLayout =
      nextView === 'graph'
        ? patch.layout === undefined
          ? layout
          : (patch.layout ?? undefined)
        : undefined;
    return {
      ...((patch.archived ?? archived) ? { archived: true as const } : {}),
      ...((patch.attach ?? attach) ? { attach: true as const } : {}),
      ...((patch.pending ?? pending) ? { pending: true as const } : {}),
      ...(nextBaseline === undefined || nextBaseline === '' ? {} : { baseline: nextBaseline }),
      ...(nextBasis === undefined ? {} : { basis: nextBasis }),
      ...(nextQuery === undefined || nextQuery === '' ? {} : { q: nextQuery }),
      ...(nextStatus === undefined || nextStatus === '' ? {} : { status: nextStatus }),
      ...(nextType === undefined || nextType === '' ? {} : { type: nextType }),
      ...(nextView === 'tree' ? {} : { view: nextView }),
      ...(nextFocus === undefined || nextFocus === '' ? {} : { focus: nextFocus }),
      ...(nextLayout === undefined || nextLayout < 2 ? {} : { layout: nextLayout }),
    };
  };
  /** 보기·중심은 **이력에 쌓지 않는다** — 레일 탭과 같은 규칙이다(누를 때마다 뒤로가기가 한 칸씩 늘지 않게) */
  const setView = (next: SpecView): void =>
    void navigate({
      to: '/p/$proj/specs',
      params: { proj },
      search: searchWith({ view: next }),
      replace: true,
    });
  /** 상세로 갈 때도 **고른 기준을 넘긴다**(REQ-WEB-135 · 248) */
  const detailSearch = viewBasisSearch(viewBasis);
  const project = useProject(proj);
  // 입력 중인 글자는 화면의 것이고, **보낸 검색어는 주소의 것**이다. 링크가 가리키는 것은
  // 누가 무엇을 타이핑하던 중인지가 아니라 어떤 결과를 보라는 것이다.
  const submitted = q ?? '';
  const [query, setQuery] = useState(submitted);
  // 트리와 그래프는 **같은 질문의 두 답**이다 — 계층으로 찾을 때와 관계로 찾을 때.
  // 다른 라우트로 가르면 둘을 오가며 비교할 수 없다. 어느 보기인지는 **주소가 말한다**(위 validateSearch).
  // 웹에서 문서를 **시작하는** 문(2026-09-03 신설). 이것이 없는 동안 목록은 읽기 전용이었다.
  // 동결은 사람의 거버넌스 행위다(EP-SPEC-12) — 서버가 역할을 최종 판정하므로 화면은
  // 문을 열어 두고, 권한이 없으면 서버가 거절한 사유를 그대로 보인다.
  const [freezing, setFreezing] = useState(false);

  const search = useQuery({
    // **검색도 고른 기준의 본문에서 찾는다**(2026-09-27 사람 결정 · REQ-WEB-250 · REQ-API-195)
    queryKey: ['project', proj, 'search', submitted, archived, viewBasisKey(viewBasis)],
    queryFn: () =>
      apiFetch<SearchResult>(
        `/projects/${proj}/specs/search?q=${encodeURIComponent(submitted)}&include_archived=${String(archived)}` +
          viewBasisQuery(viewBasis),
      ),
    enabled: submitted.trim() !== '',
  });

  const projectId = project.data?.['id'];
  const graph = useSpecGraph(proj, asProjectId(projectId), archived, viewBasis);
  const me = useMe();
  const { orgSlug } = useScope(proj);
  const canFreeze = rolesInProject(me.data, orgSlug, proj).some(
    (r) => r === 'planner' || r === 'admin',
  );
  /** 상태별 수 — 이미 받은 그래프 노드로 센다(따로 묻지 않는다). 어휘 순서는 정본(enum)을 따른다 */
  const statusCounts: [string, number][] = SPEC_STATUSES.map((value): [string, number] => [
    value,
    (graph.data?.nodes ?? []).filter((n) => n.doc_status === value).length,
  ]).filter(([, count]) => count > 0);
  /** 승인본 위에 새 버전이 진행 중인 문서 수(REQ-WEB-249) — 기준과 상관없이 같은 수다 */
  const newerCount = (graph.data?.nodes ?? []).filter(hasNewerVersion).length;
  /** 첨부가 있는 문서 수(REQ-WEB-289) — 첨부는 문서에 붙으므로 기준과 상관없이 같은 수다 */
  const attachedCount = (graph.data?.nodes ?? []).filter(
    (n) => (n.attachment_count ?? 0) > 0,
  ).length;
  /**
   * **결재 대기**(2026-10-04 · 사람 결정 A1 · A2 · REQ-WEB-292) — 칩을 켤 때만 묻는다. 판정은 받은 요청과
   * 한 벌이다(EP-SPEC-26). 트리를 그 문서들로 거르고, 고른 것을 받은 요청과 같은 일괄 결정으로 보낸다
   */
  const pendingApprovals = useQuery({
    queryKey: queryKeys.projectPendingApprovals(asProjectId(projectId) ?? (proj as never)),
    queryFn: () => apiFetch<{ items: Row[] }>(`/projects/${proj}/specs/pending-approvals`),
    enabled: pending && projectId !== undefined,
  });
  const pendingRows = pendingApprovals.data?.items ?? [];
  const pendingKeys = useMemo(
    () => new Set(pendingRows.map((row) => String(row['spec_key']))),
    [pendingRows],
  );
  const [decisionPicked, setDecisionPicked] = useState<ReadonlySet<string>>(new Set());
  const toggleDecision = useCallback((key: string) => {
    setDecisionPicked((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      // 받은 요청과 같은 상한이다(REQ-API-191) — 그 위로는 더 고르지 않는다
      else if (next.size < BULK_DECISION_LIMIT) next.add(key);
      return next;
    });
  }, []);

  // 그래프를 보는 동안에만 화면 높이를 **확정한다**. `min-h` 로 두면 `flex-1` 자식이
  // 내용만큼 자라는데, 이웃 93개짜리 문서를 고르는 순간 패널이 4,771px 이 되고 캔버스도
  // 같이 늘어나 문서 전체가 스크롤됐다(실측 2026-08-27 · 문서 5,016px). 높이가 확정되면
  // 패널은 자기 안에서 스크롤하고 캔버스는 화면 밖으로 나가지 않는다.
  //
  // 트리·표는 반대로 **문서가 스크롤한다** — 141줄짜리 목록을 화면에 가두면 스크롤이
  // 두 겹이 되고, 안쪽 스크롤은 바깥 스크롤에 가려 있다는 것 자체가 잘 안 보인다.
  const viewportLocked = submitted.trim() === '' && view === 'graph';

  /**
   * 트리에만 딸린 조작 — 트리의 필터 줄 맨 앞에 선다(REQ-WEB-140).
   *
   * **기준선을 고른 동안에는 그리지 않는다.** 그 세트의 항목은 전부 승인본이라(승인되지 않은
   * 버전은 기준선에 담기지 않는다 — REQ-API-015) 상태로 거를 것이 없고, 고를 수 있는 것처럼
   * 보였다가 빈 목록을 주는 것이 이 화면이 피해 온 모양이다.
   */
  const treeControls =
    baseline !== undefined ? null : (
      <>
        {/* **상태 필터**(§2.4 (3) · REQ-WEB-138). 와이어프레임이 처음부터 그리고 있었는데
          화면에는 없었다 — 141편짜리 프로젝트에서 "아직 초안인 것" 을 보려면 눈으로 배지를
          훑는 수밖에 없었다. 트리에만 듣는 조작이라 **트리의 조작 줄**에 산다(REQ-WEB-140):
          머리의 동작 줄에 두었더니 칸이 둘 더 붙어 트리 탭만 배치가 달라졌다. */}
        <label
          className="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-mute"
          title={t('specs.status_filter_hint')}
        >
          {t('specs.status_filter')}
          <select
            data-testid="status-filter"
            className="rounded-nerv border border-border bg-bg-elev px-1.5 py-1 text-xs"
            value={status ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/p/$proj/specs',
                params: { proj },
                search: searchWith({
                  status: e.target.value === '' ? null : e.target.value,
                }),
              })
            }
          >
            <option value="">{t('specs.status_filter_all')}</option>
            {/* 끝나지 않은 것 — 스킬이 새 스펙 전에 훑는 것과 같은 묶음이다(4.6 §new) */}
            <option value="draft,in_review">
              {`${t('status.spec.draft')} + ${t('status.spec.in_review')}`}
            </option>
            {/* 줄의 상태가 아니라 줄 위의 버전이다 — 승인본 위의 초안 · 검토 중(REQ-WEB-249) */}
            <option value={NEWER_STATUS}>{t('specs.status_newer')}</option>
            {SPEC_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(statusLabelKey('spec', value))}
              </option>
            ))}
          </select>
        </label>
        {/* **종류 필터** — `area` 는 본문 없이 자리만 잡는 종류라, `vision,area` 로 고르면
          트리의 **뼈대**가 남는다(실측 clemvion: 141편 → 17편). */}
        <label
          className="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-mute"
          title={t('specs.type_filter_hint')}
        >
          {t('specs.type_filter')}
          <select
            data-testid="type-filter"
            className="rounded-nerv border border-border bg-bg-elev px-1.5 py-1 text-xs"
            value={type ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/p/$proj/specs',
                params: { proj },
                search: searchWith({ type: e.target.value === '' ? null : e.target.value }),
              })
            }
          >
            <option value="">{t('specs.status_filter_all')}</option>
            <option value="vision,area">{t('specs.type_filter_skeleton')}</option>
            {SPEC_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`specs.type.${value}` as const)}
              </option>
            ))}
          </select>
        </label>
        {/* **정리 모드**(2026-10-04 · 사람 결정 M1 · M4 · REQ-WEB-291) — 전수 트리에만 둔다. 문서 정보와 같은
            권한(planner · admin)이라 다른 역할에는 잠긴 채 이유를 보인다 */}
        <Button
          size="sm"
          data-testid="arrange-toggle"
          aria-pressed={arranging}
          disabled={!canFreeze || pending}
          disabledReason={
            !canFreeze
              ? t('spec.meta.edit_role')
              : pending
                ? t('specs.arrange.pending_on')
                : undefined
          }
          onClick={() => {
            setArranging((on) => !on);
            setSelected(new Set());
          }}
        >
          {arranging ? t('specs.arrange.toggle_off') : t('specs.arrange.toggle')}
        </Button>
      </>
    );

  return (
    <PageBody
      wide
      className={cn('flex flex-col', viewportLocked ? 'h-below-header' : 'min-h-below-header')}
    >
      <PageHeader
        title={t('specs.title')}
        // 탭은 **제목 옆**이다(2026-08-27 정정). 검색 아래에 두었더니 세로 한 줄은 아꼈지만
        // 보기 방식을 바꾸는 물건이 검색과 한 덩어리로 묶여 화면 오른쪽 끝에 앉았다 —
        // "스펙을 무엇으로 보는가"는 제목 바로 다음 질문이라 제목을 따라다녀야 한다.
        meta={
          submitted.trim() === '' ? (
            <Segmented
              label={t('specs.view_label')}
              value={view}
              onChange={setView}
              testIdPrefix="view"
              options={[
                { value: 'tree', label: t('graph.tab.tree') },
                { value: 'table', label: t('specs.tab.table') },
                { value: 'graph', label: t('graph.tab.graph') },
              ]}
            />
          ) : undefined
        }
        actions={
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({
                to: '/p/$proj/specs',
                params: { proj },
                search: searchWith({ q: query === '' ? null : query }),
              });
            }}
          >
            {/* **만드는 문이 여기 없다**(2026-09-22 사람 결정 · REQ-WEB-173). 문서를 시작하는
                것도 본문을 쓰는 일이라 에이전트가 한다 — 웹은 읽고·결정하고·매단다.
                2026-09-03 에 이 자리에 문을 둔 이유(REQ-WEB-043 — "읽을 수는 있는데 시작할 수
                없는 화면")는 **그때 웹이 유일한 손이었기 때문**이고, 지금은 터미널 경로가
                그 손이다(§2.4 산문). */}
            {/* 버전 기준 — 승인본 · 최신 · 기준선(REQ-WEB-135 · 248). 목록 · 상세 · 검색이 그 버전을 읽는다.
             **기준선 자리가 없어서 실사용 기준선이 0개였다**(실측 2026-09-04) */}
            <ViewBasisSelect
              projectSlug={proj}
              value={viewBasis}
              onChange={(next) =>
                void navigate({
                  to: '/p/$proj/specs',
                  params: { proj },
                  search: searchWith({
                    baseline: next.baseline ?? null,
                    basis: next.latest === true ? 'latest' : null,
                    // 기준선으로 가면 상태 필터는 뜻이 없다(세트는 전부 승인본이다)
                    ...(next.baseline === undefined ? {} : { status: null, type: null }),
                  }),
                })
              }
            />
            {/* **동결은 planner·admin 의 거버넌스 행위다**(SPEC-13 · REQ-WEB-003). 모두에게 같게 서 있어서
                누르고 나서야 서버 거절로 알았다 — 할 수 없는 사람에게는 잠긴 채 이유를 보인다 */}
            <Button
              type="button"
              data-testid="freeze-baseline"
              disabled={!canFreeze}
              disabledReason={canFreeze ? undefined : rolesOnly(['planner', 'admin'])}
              onClick={() => setFreezing(true)}
            >
              {t('specs.freeze')}
            </Button>
            {/* **전수의 경계를 화면이 말한다**(REQ-WEB-105). 보관한 문서는 어느 목록에도
                없어서 키를 아는 사람만 주소로 닿을 수 있었다 — 복구 경로가 없는 것과 같다 */}
            <label
              className="flex cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap text-text-mute"
              title={t('specs.show_archived_hint')}
            >
              <input
                type="checkbox"
                data-testid="show-archived"
                checked={archived}
                onChange={(e) =>
                  void navigate({
                    to: '/p/$proj/specs',
                    params: { proj },
                    search: searchWith({ archived: e.target.checked }),
                  })
                }
              />
              {t('specs.show_archived')}
            </label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('specs.search_placeholder')}
              className="w-64"
            />
            <Button type="submit">{t('common.search')}</Button>
            {/* 검색하는 동안 [트리|표|그래프]가 사라진다 — 돌아가는 길은 이것뿐이다(REQ-WEB-271) */}
            {submitted !== '' && (
              <Button
                variant="subtle"
                data-testid="specs-back-to-tree"
                onClick={() => {
                  setQuery('');
                  void navigate({
                    to: '/p/$proj/specs',
                    params: { proj },
                    search: searchWith({ q: null }),
                  });
                }}
              >
                ← {t('specs.back_to_tree')}
              </Button>
            )}
          </form>
        }
      />

      {/* **지금 무엇이 몇 건인가**(2026-09-24 · SPEC-13 · REQ-WEB-216 · REQ-WEB-056). "초안이 몇 건, 검토 중이
          몇 건인가" 는 트리를 훑어야 답이 나왔다. 누르면 그 상태로 거른 트리다(상태 필터는 트리의 것이다 —
          REQ-WEB-140). 기준선으로 보는 동안은 전부 승인본이라 말할 것이 없다 */}
      {/* 받기 전에는 줄 자리를 잡는다 — 수가 온 뒤 칩 줄이 끼어들며 트리가 밀렸다(REQ-WEB-296) */}
      {submitted.trim() === '' && baseline === undefined && graph.isPending && (
        <Skeleton rows={1} className="mb-3 w-72 [&>div]:h-6" />
      )}
      {submitted.trim() === '' &&
        baseline === undefined &&
        (statusCounts.length > 0 || newerCount > 0 || attachedCount > 0) && (
          <div
            data-testid="spec-status-summary"
            role="group"
            aria-label={t('specs.status_summary')}
            className="mb-3 flex flex-wrap items-center gap-1.5 text-xs"
          >
            {statusCounts.map(([value, count]) => {
              const on = status === value;
              return (
                <button
                  key={value}
                  type="button"
                  data-testid={`spec-status-${value}`}
                  aria-pressed={on}
                  onClick={() =>
                    void navigate({
                      to: '/p/$proj/specs',
                      params: { proj },
                      search: searchWith({ status: on ? null : value, view: 'tree' }),
                    })
                  }
                  className={cn(
                    'rounded-nerv-sm border px-2 py-0.5 tabular-nums',
                    on
                      ? 'border-border-strong bg-bg-active font-medium text-text'
                      : 'border-border text-text-mute hover:text-text',
                  )}
                >
                  {t(statusLabelKey('spec', value))} {count}
                </button>
              );
            })}
            {/* **새 버전 진행 중**(2026-09-27 사람 결정 V3 · REQ-WEB-249). 승인본 위에 초안 · 검토 중이 있는
              문서다 — 누르면 최신으로 읽고 그 문서들만 남긴다. 상태별 수는 줄의 상태를 세므로 여기 들지 않았다 */}
            {newerCount > 0 && (
              <button
                type="button"
                data-testid="spec-status-newer"
                aria-pressed={status === NEWER_STATUS}
                onClick={() =>
                  void navigate({
                    to: '/p/$proj/specs',
                    params: { proj },
                    search:
                      status === NEWER_STATUS
                        ? searchWith({ status: null })
                        : searchWith({ basis: 'latest', status: NEWER_STATUS, view: 'tree' }),
                  })
                }
                className={cn(
                  'rounded-nerv-sm border border-dashed px-2 py-0.5 tabular-nums',
                  status === NEWER_STATUS
                    ? 'border-status-waiting bg-status-waiting-soft font-medium text-status-waiting'
                    : 'border-status-waiting text-status-waiting hover:bg-status-waiting-soft',
                )}
              >
                {t('specs.status_newer')} {newerCount}
              </button>
            )}
            {/* **첨부 있음**(2026-10-04 · 사람 결정 F2 · REQ-WEB-289) — 상태와 다른 축이라 상태 칩과 함께
                켤 수 있다(AND). 트리 탭에서 거른다 — 표는 "첨부" 열로 정렬한다 */}
            {attachedCount > 0 && (
              <button
                type="button"
                data-testid="spec-attached-only"
                aria-pressed={attach}
                onClick={() =>
                  void navigate({
                    to: '/p/$proj/specs',
                    params: { proj },
                    search: searchWith({ attach: !attach, view: 'tree' }),
                  })
                }
                className={cn(
                  'rounded-nerv-sm border px-2 py-0.5 tabular-nums',
                  attach
                    ? 'border-border-strong bg-bg-active font-medium text-text'
                    : 'border-border text-text-mute hover:text-text',
                )}
              >
                {t('specs.attached_only')} {attachedCount}
              </button>
            )}
            {/* **결재 대기**(2026-10-04 · 사람 결정 A1 · A2 · REQ-WEB-292) — 켜면 내가 결정할 수 있는 검토 중
                문서만 트리에 남고 줄마다 고르는 칸이 생긴다. 수는 켰을 때 묻는다(A2) */}
            <button
              type="button"
              data-testid="spec-pending-only"
              aria-pressed={pending}
              onClick={() => {
                setDecisionPicked(new Set());
                void navigate({
                  to: '/p/$proj/specs',
                  params: { proj },
                  search: searchWith({ pending: !pending, view: 'tree' }),
                });
              }}
              className={cn(
                'rounded-nerv-sm border px-2 py-0.5 tabular-nums',
                pending
                  ? 'border-status-action bg-status-action-soft font-medium text-status-action'
                  : 'border-status-action text-status-action hover:bg-status-action-soft',
              )}
            >
              {t('specs.pending_only')}
              {pending && pendingApprovals.data !== undefined ? ` ${pendingRows.length}` : ''}
            </button>
          </div>
        )}

      {search.data?.degraded !== null && search.data?.degraded !== undefined && (
        // degrade 를 숨기지 않는다 — 결과가 왜 얕은지 모르면 사람은 검색을 탓한다(REQ-API-026)
        <div
          data-testid="degraded-banner"
          className="mb-3 flex items-center gap-2 rounded-nerv border border-border bg-status-waiting-soft px-3 py-2 text-sm text-status-waiting"
        >
          <span aria-hidden="true">●</span>
          {t('specs.degraded')}
        </div>
      )}

      {submitted.trim() === '' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {view === 'tree' ? (
            <Card padded={false} className="p-3">
              {pending && (
                <DecisionBar
                  projectId={asProjectId(projectId)}
                  pending={pendingRows}
                  selected={decisionPicked}
                  onSelect={setDecisionPicked}
                />
              )}
              {arranging && !pending && (
                <ArrangeBar
                  projectSlug={proj}
                  projectId={asProjectId(projectId)}
                  nodes={graph.data?.nodes ?? []}
                  selected={selected}
                  onClear={() => setSelected(new Set())}
                  // 일부만 보이면 순서를 바꾸지 않는다 — 보이지 않는 형제 사이로 들어간다(M4)
                  filtered={
                    statuses.length > 0 ||
                    types.length > 0 ||
                    titleFiltered ||
                    baseline !== undefined
                  }
                />
              )}
              <SpecTree
                projectSlug={proj}
                projectId={asProjectId(projectId)}
                variant="full"
                includeArchived={archived}
                statuses={statuses}
                types={types}
                attachedOnly={attach}
                controls={treeControls}
                view={viewBasis}
                {...(pending
                  ? {
                      onlyKeys: pendingKeys,
                      selection: {
                        selected: decisionPicked,
                        onToggle: toggleDecision,
                        selectable: (key: string) => pendingKeys.has(key),
                      },
                    }
                  : arranging
                    ? { selection: { selected, onToggle: toggleSelected } }
                    : {})}
                onTitleFilter={setTitleFiltered}
              />
            </Card>
          ) : graph.data === undefined ? (
            <Skeleton rows={6} />
          ) : view === 'table' ? (
            <Suspense fallback={<Skeleton rows={6} />}>
              <SpecTable
                nodes={graph.data.nodes}
                edges={graph.data.edges}
                projectSlug={proj}
                view={viewBasis}
              />
            </Suspense>
          ) : graph.data.edges.length === 0 ? (
            <EmptyState
              icon="◎"
              action={null}
              title={t('graph.empty')}
              hint={t('graph.empty_hint')}
            />
          ) : (
            <Suspense fallback={<Skeleton rows={6} />}>
              <SpecGraph
                nodes={graph.data.nodes}
                edges={graph.data.edges}
                focusKey={focus}
                layout={layout}
                onLayoutChange={(next) =>
                  void navigate({
                    to: '/p/$proj/specs',
                    params: { proj },
                    search: searchWith({ layout: next }),
                    replace: true,
                  })
                }
                onFocusChange={(key) =>
                  void navigate({
                    to: '/p/$proj/specs',
                    params: { proj },
                    search: searchWith({ focus: key }),
                    replace: true,
                  })
                }
                onOpen={(key) =>
                  void navigate({
                    to: '/p/$proj/specs/$spec',
                    params: { proj, spec: key },
                    search: detailSearch,
                  })
                }
              />
            </Suspense>
          )}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <section>
            <SectionTitle>
              {/* 받기 전에는 "결과 0건" 이 아니다(REQ-WEB-294) */}
              {search.data === undefined
                ? t('common.loading')
                : t('specs.results', { count: search.data.items.length })}
            </SectionTitle>
            {/* **어느 버전의 본문에서 찾았는지 적는다**(REQ-WEB-250). 결과만 보고는 승인본에서 찾았는지
                초안까지 찾았는지 알 수 없다. 바꾸려면 위의 [버전 기준]을 고른다 */}
            {search.data?.basis !== undefined && (
              <p data-testid="search-basis" className="mb-2 text-2xs text-text-faint">
                {search.data.basis === 'baseline'
                  ? t('specs.search_basis_baseline', { name: search.data.baseline ?? '' })
                  : search.data.basis === 'latest'
                    ? t('specs.search_basis_latest')
                    : t('specs.search_basis_approved')}
              </p>
            )}
            {search.isFetching && <Skeleton rows={3} />}
            <ul className="flex flex-col gap-2">
              {(search.data?.items ?? []).map((hit) => {
                // **결과는 그 종류의 화면으로 간다**(2026-10-04 · REQ-WEB-288). 예전에는 종류와 상관없이
                // 스펙 상세로 보내서, 작업 번호로 찾은 결과를 누르면 "없는 문서" 가 열렸고 요구사항
                // 결과는 요구사항 탭을 열지 않았다. ⌘K 팔레트(`hrefOfHit`)와 같은 규칙이다.
                const card = (
                  <Card interactive padded={false} className="px-3 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Mono>{String(hit['key'])}</Mono>
                      {/* 결과 카드는 여는 곳이다 — 제목을 쉴 때 링크색으로 둔다(REQ-WEB-273) */}
                      <span className="min-w-0 flex-1 truncate font-medium text-link">
                        {String(hit['title'])}
                      </span>
                      {/* 번호로 찾으면 보관된 문서도 나온다 — 열 수는 있되 보관됐다는 것을 함께 보인다 */}
                      {hit['archived_at'] != null && (
                        <StatusBadge token="idle" label={t('specs.archived_badge')} />
                      )}
                      {hit['doc_status'] !== null && (
                        <StatusBadge
                          token={
                            (SPEC_VERSION_TOKEN[
                              String(hit['doc_status']) as keyof typeof SPEC_VERSION_TOKEN
                            ] ?? 'idle') as StatusToken
                          }
                          label={t(statusLabelKey('spec', String(hit['doc_status'])))}
                        />
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-text-mute">
                      {String(hit['snippet'] ?? '')}
                    </p>
                    {/* 어느 경로로 들어왔는지 — 신뢰의 문제다 */}
                    <p className="mt-1.5 flex gap-1 text-2xs text-text-faint">
                      {((hit['matched_by'] as string[] | undefined) ?? []).map((by) => (
                        <span key={by} className="rounded-nerv-sm bg-bg-sunken px-1.5 py-0.5">
                          {by}
                        </span>
                      ))}
                    </p>
                  </Card>
                );
                const key = String(hit['key']);
                return (
                  <li key={`${String(hit['spec_id'])}-${String(hit['anchor'] ?? '')}`}>
                    {hit['kind'] === 'task' ? (
                      <Link
                        to="/p/$proj/tasks/$task"
                        params={{ proj, task: key }}
                        className="block"
                        data-testid="search-hit"
                      >
                        {card}
                      </Link>
                    ) : (
                      <Link
                        to="/p/$proj/specs/$spec"
                        params={{ proj, spec: key }}
                        search={
                          hit['kind'] === 'requirement'
                            ? { ...detailSearch, rail: 'requirements' as const }
                            : detailSearch
                        }
                        className="block"
                        data-testid="search-hit"
                      >
                        {card}
                      </Link>
                    )}
                  </li>
                );
              })}
              {search.isFetched && (search.data?.items.length ?? 0) === 0 && (
                <li>
                  <EmptyState
                    icon="○"
                    title={t('specs.no_results')}
                    hint={t('specs.no_results_hint')}
                    action={
                      <Button
                        size="sm"
                        variant="subtle"
                        data-testid="specs-search-clear"
                        onClick={() => {
                          setQuery('');
                          void navigate({
                            to: '/p/$proj/specs',
                            params: { proj },
                            search: searchWith({ q: null }),
                          });
                        }}
                      >
                        {t('specs.clear_search')}
                      </Button>
                    }
                  />
                </li>
              )}
            </ul>
          </section>

          <section>
            <SectionTitle>{t('specs.related')}</SectionTitle>
            <p className="mb-2 text-2xs text-text-faint">{t('specs.related_hint')}</p>
            <ul className="flex flex-col">
              {(search.data?.related ?? []).map((r) => (
                <li
                  key={String(r['spec_id'])}
                  className="border-b border-border py-1.5 last:border-0"
                >
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj, spec: String(r['key']) }}
                    search={detailSearch}
                    className="text-sm text-link hover:underline"
                  >
                    {String(r['title'])}
                  </Link>
                  <span className="ml-1.5 text-2xs text-text-faint">{String(r['via_kind'])}</span>
                </li>
              ))}
              {search.data !== undefined && search.data.related.length === 0 && (
                <li className="py-1.5 text-sm text-text-faint">{t('common.none')}</li>
              )}
            </ul>
          </section>
        </div>
      )}
      {freezing && <FreezeDialog projectSlug={proj} onClose={() => setFreezing(false)} />}
    </PageBody>
  );
}
