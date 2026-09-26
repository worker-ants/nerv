// /p/:proj/reviews → S6 리뷰 센터 (ui-wireframes §2.6 · screens.md §2.6a)
//
// **필터가 왼쪽 첫 칸에 오는 이유.** QA 의 하루는 "AI 가 찾은 것을 다시 읽는" 것이 아니라
// 무엇이 위험한지 **고르는** 것이다(와이어프레임 §2.6 ①). 그래서 첫 화면이 원시 diff 가
// 아니라 정리된 finding 큐이고, 고르는 도구가 목록보다 먼저 놓인다.
//
// 이 화면이 대체하는 것은 clemvion 의 `review/**` md 13,777개(131MB)다.

import { scopesForRoles } from '@nerv/schema';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ErrorState } from '../../components/query-state.js';
import { useEffect, useRef, useState } from 'react';
import { FindingCard } from '../../features/review-center/finding-card.js';
import { FindingRail } from '../../features/review-center/finding-rail.js';
import { GateCoverage } from '../../features/review-center/gate-coverage.js';
import type { ResolveAction } from '../../features/review-center/resolve-dialog.js';
import { useT } from '../../lib/i18n.js';
import { rows, useFindings, useGateCoverage, useMe, useProject } from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
import { rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { useMediaQuery } from '../../lib/use-media-query.js';
import { cn } from '../../lib/utils.js';
import {
  Button,
  Card,
  EmptyState,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,
  SummaryStrip,
} from '../../components/ui/primitives.js';
import type { SummaryMetric } from '../../components/ui/primitives.js';
import { asProjectId } from '../../lib/query-keys.js';
import { useScrollTopOn } from '../../lib/scroll-top.js';

/** 주소의 필터 — 쉼표 목록이다(서버 질의 `?severity=critical,warning` 과 같은 모양) */
export interface ReviewSearch {
  finding?: string;
  branch?: string;
  severity?: string;
  /** 없으면 `open`(기본은 적지 않는다) · `all` 이면 거르지 않는다 */
  status?: string;
  area?: string;
  tag?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export const Route = createFileRoute('/p/$proj/reviews/')({
  // **발견 하나를 가리킬 주소가 필요하다**(2026-08-31 — 사람 요청). 받은 요청의 질문 카드가
  // finding 을 짧은 id 로만 적고 있어서, 그 지적을 보려면 큐에서 손으로 찾아야 했다.
  //
  // **필터도 주소다**(2026-09-24 — UI/UX 검토 WORK-11 · REQ-WEB-212). "spec 영역 critical 열린
  // 것" 으로 좁혀 링크를 건네면 받은 사람은 기본 큐를 봤고, 새로고침·뒤로가기에도 필터가 풀렸다.
  // 보드는 같은 문제를 2026-09-06 에 주소로 고쳤다 — 시안의 규약도 "뷰 상태는 쿼리로" 다.
  validateSearch: (search: Record<string, unknown>): ReviewSearch => {
    const out: ReviewSearch = {};
    for (const key of ['finding', 'branch', 'severity', 'status', 'area', 'tag'] as const) {
      const value = text(search[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  },
  component: ReviewCenter,
});

/** 쉼표 목록을 어휘 안의 값으로 — 모르는 값은 버린다(부모 라우트는 검사하지 않은 인자를 흘린다) */
function listOf(value: unknown, vocab?: readonly string[]): string[] {
  if (typeof value !== 'string' || value === '') return [];
  const items = value.split(',').filter((v) => v !== '');
  return vocab === undefined ? items : items.filter((v) => vocab.includes(v));
}

const SEVERITIES = ['critical', 'warning', 'info'] as const;
const STATUSES = ['open', 'fixed', 'dismissed', 'wont_fix'] as const;
/**
 * **어디에 대한 지적인가**(2026-09-01 · REQ-WEB-128). severity 가 "얼마나 급한가" 이고
 * category 가 "무슨 종류인가" 라면, 이 축은 **"무엇을 고쳐야 하는가"** 다 — 사람이 발견을
 * 보고 다음에 할 행동이 이 넷으로 갈린다.
 */
const AREAS = ['codebase', 'spec', 'task', 'process'] as const;

/** 처분할 수 있는 역할 — 정본은 서버의 `ROLE_SCOPES` 다. 화면은 버튼을 **비활성 + 사유**로 둔다(REQ-WEB-003) */
const RESOLVER_ROLES = ['admin', 'planner', 'qa'];

function ReviewCenter(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const me = useMe();
  const projectId = project.data?.['id'];
  const id = asProjectId(projectId);

  const search = Route.useSearch();
  const navigate = useNavigate();
  // 큐는 **열린 것으로 시작한다** — 처분한 것까지 함께 보이면 큐가 큐이기를 그만둔다.
  // 필터는 **주소가 든다**(REQ-WEB-212) — 기본(`open`)은 적지 않고, 다 풀면 `status=all` 이다
  const severity = listOf(search.severity, SEVERITIES);
  const status =
    search.status === 'all'
      ? []
      : search.status === undefined
        ? ['open']
        : listOf(search.status, STATUSES);
  const tag = listOf(search.tag);
  const area = listOf(search.area, AREAS);
  const branch = text(search.branch);
  const [resolving, setResolving] = useState<{ id: string; action: ResolveAction } | null>(null);
  // 레일이 펴는 하나 — 고르지 않았으면 레일을 세우지 않는다(빈 패널을 만들지 않는다).
  // **고른 것도 주소다**(WORK-11) — 발견을 고르면 `?finding=` 이 바뀌어, 지금 보는 그 지적을
  // 주소창에서 그대로 건넬 수 있다. 예전에는 링크로 들어온 첫 값으로만 읽었다
  const selectedId = text(search.finding) ?? null;
  /** 필터를 바꾼다 — 이력에 쌓는다(뒤로가기가 앞 필터로 돌아간다 · 보드와 같은 규칙) */
  const setFilter = (key: 'severity' | 'status' | 'area' | 'tag', next: string[]): void =>
    void navigate({
      to: '/p/$proj/reviews',
      params: { proj },
      // 필터를 바꾸면 **고른 것을 푼다** — 걸러진 뒤에도 앞서 고른 발견이 레일에 남으면 화면 둘이
      // 다른 말을 한다(세션 모니터와 같은 규칙)
      search: (prev: ReviewSearch) => {
        const { [key]: _drop, finding: _finding, ...rest } = prev;
        if (key === 'status') {
          // 기본(open 하나)은 적지 않는다 — 뜻 없는 인자를 주소에 남기지 않는다
          if (next.length === 1 && next[0] === 'open') return rest;
          return { ...rest, status: next.length === 0 ? 'all' : next.join(',') };
        }
        return next.length === 0 ? rest : { ...rest, [key]: next.join(',') };
      },
    });
  /** 고르기는 이력에 쌓지 않는다 — 카드를 훑을 때마다 뒤로가기가 한 칸씩 늘면 그 단추를 쓸 수 없다 */
  const select = (findingId: string): void =>
    void navigate({
      to: '/p/$proj/reviews',
      params: { proj },
      search: (prev: ReviewSearch) => ({ ...prev, finding: findingId }),
      replace: true,
    });
  // **더 보기는 배수로 늘린다.** clemvion 실측 18,650건 — 전량을 한 번에 그리면
  // 화면이 3만 픽셀이 된다(실측 2026-08-24). 답은 무한 스크롤이 아니라 **필터**이고,
  // 그래서 "몇 건 중 몇 건인지"를 먼저 말한다(REQ-WEB-067).
  const queue = useFindings(proj, { severity, status, tag, area, branch }, id);
  const gate = useGateCoverage(proj, id);
  // 멤버십 한 행이 아니라 이 프로젝트에서의 역할 **전부**다 — 조직 단위 멤버십만 가진
  // 사람은 한 행 판정에서 아무 역할도 없는 사람이 된다(2026-08-24).
  const { orgSlug } = useScope(proj);
  const roles = rolesInProject(me.data, orgSlug, proj);
  const canResolve = roles.some((r) => RESOLVER_ROLES.includes(r));
  // **승격은 처분이 아니라 작업을 만드는 일이다.** 서버가 요구하는 것도 `task:update` 인데
  // 화면만 `review:resolve` 로 잠가서, developer 는 권한이 있는데 누를 수 없었다 —
  // 지적을 받은 사람이 그것을 자기 백로그로 넘기지 못하던 자리다(2026-09-05 감사).
  const canPromote = scopesForRoles(roles).has('task:update');
  // **레일은 넓은 화면의 향상이지 유일한 경로가 아니다**(2026-09-10 — 사람 보고 · REQ-WEB-161).
  // 곁레일은 `xl`(1280px) 부터만 서는데, 그 아래에서는 발견을 눌러도 **카드 배경만** 옅게
  // 바뀌고 레일이 펴는 것(갈래·심볼·전체 경로·코멘트·Task 승격)에 닿을 길이 아예 없었다 —
  // 1024~1279px 는 노트북의 흔한 폭이다. §2.6 이 세션에서 이미 정한 규칙이고(REQ-WEB-132·142),
  // 거기서 쓴 처방도 같다: **같은 컴포넌트를 다른 자리에** 그린다.
  //
  // `hidden`/`block` 두 벌이 아니라 **하나를 옮긴다** — 두 벌을 그리면 DOM 에 둘이 남아
  // 코멘트 입력 같은 내부 상태가 갈리고, 읽는 도구(접근성 트리·테스트)는 둘 다 본다.
  // 폭의 기준은 `xl` 과 같은 값이다(80rem) — 두 곳에 적은 값이 갈리지 않게 한 곳만 본다.
  const wideRail = useMediaQuery('(min-width: 80rem)');

  // facet 은 필터에만 달렸으므로 첫 쪽의 것이 전체를 말한다 — 쪽마다 다시 세지 않는다
  const facets = queue.data?.pages[0]?.facets;
  // 받아 온 쪽들을 이어 붙인다 — 커서가 있으므로 200 에서 끝나지 않는다(REQ-API-083)
  const items = (queue.data?.pages ?? []).flatMap((page) => page.items);
  const selected = items.find((f) => String(f['id']) === selectedId) ?? null;
  // **고른 것이 바뀌면 레일은 처음부터, 거르는 조건이 바뀌면 큐는 처음부터**(REQ-WEB-244).
  // 큐의 열쇠에 고른 발견을 넣지 않는다 — 목록에서 하나를 누를 때마다 목록이 튀면 안 된다
  const queueRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  useScrollTopOn(
    queueRef,
    [search.branch, search.severity, search.status, search.area, search.tag].join('|'),
  );
  useScrollTopOn(railRef, selectedId);
  /** 레일의 처분 폼 — 고른 발견의 것만 연다(다른 발견을 고르면 닫힌다) */
  const railResolve = (
    finding: Row,
  ): {
    resolveAction: ResolveAction | null;
    onResolve: (action: ResolveAction) => void;
    onResolveDone: () => void;
  } => ({
    resolveAction: resolving?.id === String(finding['id']) ? resolving.action : null,
    onResolve: (action) => setResolving({ id: String(finding['id']), action }),
    onResolveDone: () => setResolving(null),
  });
  /**
   * **j/k 로 큐를 훑는다**(2026-09-25 — UI/UX 검토 WORK-12 · REQ-WEB-222). 받은 요청·보드 시트와 같은
   * 키다. 입력 칸 안에서는 듣지 않는다 — 코멘트에 `j` 를 쓰다가 다른 발견으로 넘어가면 안 된다.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'j' && e.key !== 'k') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      )
        return;
      if (items.length === 0) return;
      const at = items.findIndex((f) => String(f['id']) === selectedId);
      const next =
        at < 0 ? 0 : Math.min(items.length - 1, Math.max(0, at + (e.key === 'j' ? 1 : -1)));
      const nextId = String(items[next]!['id']);
      if (nextId === selectedId) return;
      e.preventDefault();
      select(nextId);
      // 고른 카드로 눈과 포커스가 간다 — 다음 Enter·Tab 이 그 카드에서 시작한다
      const card = document.querySelector(`[data-finding-id="${CSS.escape(nextId)}"]`);
      if (card instanceof HTMLElement) {
        card.scrollIntoView?.({ block: 'nearest' });
        card.querySelector<HTMLElement>('[data-testid="finding-select"]')?.focus({
          preventScroll: true,
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selectedId]);
  // **주소가 가리키는데 큐에 없을 수 있다** — 이미 처분돼서 기본 필터(열림)에서 빠진
  // 경우다. 그때 빈 화면을 주지 않고 상태 필터를 푼다(한 번만).
  const [widened, setWidened] = useState(false);
  useEffect(() => {
    if (selectedId === null || widened) return;
    if (queue.isPending) return;
    // **한 번만 본다** — 주소로 들어온 그 발견을 처음 찾을 때다. 고른 뒤 필터를 바꿔 큐에서
    // 빠진 것까지 필터를 풀어 찾으면, 사람이 방금 건 필터가 제멋대로 풀린다
    setWidened(true);
    if (items.some((f) => String(f['id']) === selectedId)) return;
    if (status.length > 0) {
      void navigate({
        to: '/p/$proj/reviews',
        params: { proj },
        search: (prev: ReviewSearch) => ({ ...prev, status: 'all' }),
        replace: true,
      });
    }
  }, [items, selectedId, queue.isPending, widened, status.length, navigate, proj]);
  const gateRows = rows(gate.data?.items);
  // 지금 필터로 잡히는 전체 — facet 은 "이것을 켜면 몇 건인가"라 status facet 의 합이다
  const matched = status.reduce((sum, key) => sum + (facets?.status[key] ?? 0), 0);
  // 잘렸다는 사실은 이제 **다음 쪽이 있는가**로 안다 — 상한이 아니라 커서가 답한다
  const truncated = queue.hasNextPage === true || matched > items.length;
  const summary: SummaryMetric[] = [
    {
      label: t('reviews.summary.critical'),
      value: facets?.severity['critical'] ?? 0,
      tone: 'danger',
    },
    { label: t('reviews.summary.open'), value: facets?.status['open'] ?? 0 },
    { label: t('reviews.summary.branches'), value: gate.data?.total ?? 0 },
  ];

  const toggle = (
    key: 'severity' | 'status' | 'area' | 'tag',
    list: string[],
    value: string,
  ): void =>
    setFilter(key, list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    // **세 칸이 각자 자기 안에서 흐른다**(2026-09-10 — 사람 지시 · REQ-WEB-158). 여태
    // 스크롤 상자는 문서 전체였다: 발견 큐는 50건이면 이미 화면보다 길고(실측 clemvion
    // 18,650건), 그래서 바퀴를 **레일 위에서 굴려도 움직이는 것은 큐**였다 — 레일이 더
    // 흘릴 것이 없으면 스크롤은 페이지로 넘어간다. 고른 발견을 펴 놓고 목록을 훑는 것이
    // 이 화면의 손놀림인데, 그때 옆의 것이 함께 밀리면 나란히 놓은 두 칸이 아니다.
    // §2.4 가 S3 에서 먼저 쓴 그 규약이다(REQ-WEB-156).
    //
    // 머리(제목·요약 스트립)는 스크롤에서 빠지고, 남은 높이를 세 칸이 나눠 갖는다 —
    // 가운데 칸이 `flex-1`(basis 0)이라 머리가 줄어들 압력을 받지 않는다. 묶는 것은
    // **2열이 되는 폭(`lg`)부터**다: 1열에서 칸을 각각 가두면 스크롤이 두 겹이 되고,
    // 안쪽 스크롤은 바깥 스크롤에 가려 있다는 것 자체가 보이지 않는다.
    <PageBody wide className="lg:flex lg:h-below-header lg:flex-col lg:overflow-hidden">
      <PageHeader title={t('reviews.title')} />
      <SummaryStrip className="mb-5 lg:shrink-0" metrics={summary} />

      {/* 필터 | 큐 — **가로로 나란히**다(2026-08-23 사람 판단, §2.5 와 같은 규칙).
          아래에 두면 목록을 다 지나 스크롤해야 닿는다 */}
      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:overflow-hidden">
        {/* 필터도 자기 안에서 흐른다 — 태그 facet 이 길면 여기부터 넘친다.
            가로는 **명시로** 잠근다: 한 축이 `visible` 이 아니면 다른 축도 `auto` 가 되므로
            세로만 열려던 설정이 이 칸을 가로 스크롤 상자로 만든다(REQ-WEB-151 의 그 모양) */}
        <aside
          data-testid="review-filters"
          className="w-full shrink-0 lg:h-full lg:w-52 lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1"
        >
          <FacetGroup
            label={t('reviews.filter.severity')}
            values={SEVERITIES}
            selected={severity}
            counts={facets?.severity ?? {}}
            labelOf={(v) => t(`severity.${v}` as 'severity.info')}
            onToggle={(v) => toggle('severity', severity, v)}
          />
          <FacetGroup
            label={t('reviews.filter.area')}
            values={AREAS}
            selected={area}
            counts={facets?.area ?? {}}
            labelOf={(v) => t(`area.${v}` as 'area.codebase')}
            onToggle={(v) => toggle('area', area, v)}
          />
          <FacetGroup
            label={t('reviews.filter.status')}
            values={STATUSES}
            selected={status}
            counts={facets?.status ?? {}}
            labelOf={(v) => t(`status.finding.${v}` as 'status.finding.open')}
            onToggle={(v) => toggle('status', status, v)}
          />
          {Object.keys(facets?.tag ?? {}).length > 0 && (
            <FacetGroup
              label={t('reviews.filter.tag')}
              values={Object.keys(facets?.tag ?? {})}
              selected={tag}
              counts={facets?.tag ?? {}}
              labelOf={(v) => v}
              onToggle={(v) => toggle('tag', tag, v)}
            />
          )}
          {(severity.length > 0 ||
            tag.length > 0 ||
            area.length > 0 ||
            status.join() !== 'open') && (
            <button
              type="button"
              data-testid="filter-reset"
              className="mt-2 text-2xs text-text-faint hover:text-text"
              // 필터만 푼다 — 들어온 브랜치와 고른 발견은 필터가 아니다
              onClick={() =>
                void navigate({
                  to: '/p/$proj/reviews',
                  params: { proj },
                  search: ({
                    severity: _s,
                    status: _st,
                    area: _a,
                    tag: _t,
                    ...rest
                  }: ReviewSearch) => rest,
                })
              }
            >
              {t('reviews.filter.reset')}
            </button>
          )}
        </aside>

        {/* **게이트 현황도 여기 산다**(2026-09-10 — 사람 지시 · REQ-WEB-158). 예전에는 세
            칸을 다 지난 뒤 페이지 바닥에 따로 누웠는데, 그러면 그 표에 닿는 유일한 길이
            **페이지 스크롤**이라 칸을 각자 가두는 순간 아무도 닿지 못한다. 큐와 같은 물음의
            다른 축이므로(무엇이 위험한가 ↔ 어디까지 덮였나) 같은 칸에서 이어 읽는다. */}
        <div
          ref={queueRef}
          data-testid="review-content"
          className="min-w-0 flex-1 lg:h-full lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1"
        >
          <SectionTitle>
            {t('reviews.queue.title')}
            {truncated && (
              <span className="ml-2 text-2xs font-normal text-text-faint">
                {t('reviews.queue.shown', { shown: items.length, total: matched })}
              </span>
            )}
          </SectionTitle>
          {/* **어느 브랜치로 좁혔는지 말하고, 푸는 길을 둔다** — 주소로 들어온 필터가 보이지 않으면
              사람은 큐가 왜 이것뿐인지 모른다(REQ-WEB-209) */}
          {branch !== undefined && (
            <p
              data-testid="branch-filter"
              className="mb-2 flex items-center gap-2 text-xs text-text-mute"
            >
              {t('reviews.branch_filter', { branch })}
              <button
                type="button"
                data-testid="branch-filter-clear"
                className="text-link hover:underline"
                // 브랜치만 푼다 — 걸어 둔 다른 필터와 고른 발견은 그대로다
                onClick={() =>
                  void navigate({
                    to: '/p/$proj/reviews',
                    params: { proj },
                    search: ({ branch: _branch, ...rest }: ReviewSearch) => rest,
                  })
                }
              >
                {t('reviews.branch_clear')}
              </button>
            </p>
          )}
          {queue.isPending ? (
            <div data-testid="finding-queue-skeleton" className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : queue.isError ? (
            // 실패는 비어 있음과 다른 모양이다 — 공용 실패 카드(REQ-WEB-198 · SYS-14)
            <ErrorState
              error={queue.error}
              title={t('reviews.queue.error')}
              onRetry={() => void queue.refetch()}
            />
          ) : items.length === 0 ? (
            // 막다른 길을 두지 않는다(§1.5) — 발견이 없으면 **어디서 들어오는지**를 말한다
            <EmptyState
              icon="◈"
              title={t('reviews.queue.empty')}
              hint={t('reviews.queue.empty_hint')}
              action={
                <Link
                  to="/help/$chapter"
                  params={{ chapter: 'reviews' }}
                  className="text-sm text-link hover:underline"
                >
                  {t('reviews.queue.empty_action')} ▸
                </Link>
              }
            />
          ) : (
            <Card className="@container p-0">
              {items.map((finding) => (
                <div key={String(finding['id'])}>
                  <FindingCard
                    finding={finding}
                    projectSlug={proj}
                    canResolve={canResolve}
                    selected={selectedId === String(finding['id'])}
                    onSelect={(f) => select(String(f['id']))}
                    // **카드의 단추는 레일을 연다**(REQ-WEB-222) — 폼은 전문과 코멘트가 있는 레일에 선다
                    onResolve={(f, action) => {
                      select(String(f['id']));
                      setResolving({ id: String(f['id']), action });
                    }}
                  />
                  {/* 곁레일이 서지 않는 폭에서는 고른 하나를 **그 카드 아래에서** 편다 —
                      좁은 화면으로 옮겨 갔다는 이유로 볼 수 있는 것이 줄면 그 접힘은
                      향상이 아니라 손실이다(§2.6 REQ-WEB-142 가 세션에서 적은 그 문장이다) */}
                  {!wideRail && selectedId === String(finding['id']) && (
                    <div
                      data-testid="finding-rail-inline"
                      className="border-t border-border bg-bg-sunken/40 px-4 py-3"
                    >
                      <FindingRail
                        finding={finding}
                        projectSlug={proj}
                        projectId={id}
                        canResolve={canResolve}
                        canPromote={canPromote}
                        {...railResolve(finding)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
          {truncated && (
            <Button
              size="sm"
              variant="subtle"
              data-testid="queue-more"
              disabled={queue.isFetchingNextPage}
              onClick={() => void queue.fetchNextPage()}
              className="mt-2 w-full text-2xs"
            >
              {t('reviews.queue.more')}
            </Button>
          )}

          <div className="mt-6">
            <GateCoverage
              rows={gateRows}
              total={gate.data?.total ?? gateRows.length}
              projectSlug={proj}
            />
          </div>
        </div>

        {/* 고른 하나를 펴는 레일 — 카드가 자르는 것(경로·심볼·갈래·처분 근거)이 여기 있다.
            고르지 않았으면 세우지 않는다: 빈 패널은 화면 폭을 버리는 것이다(§2.5 와 같은 규칙) */}
        {selected !== null && wideRail && (
          // **레일의 틀은 서 있고 내용이 그 안에서 흐른다**(REQ-WEB-158). `sticky top-4` 는
          // 페이지가 흐른다는 전제 위의 임시 방편이었다 — 붙일 것이 없는 자리의 `sticky` 는
          // 아무 일도 하지 않는다. 스크롤을 바깥 `aside` 가 아니라 **카드에** 두는 이유는
          // 테두리까지 함께 흘러 올라가지 않게 하기 위해서다.
          <aside data-testid="review-rail" className="hidden w-85 shrink-0 xl:block xl:h-full">
            <div
              ref={railRef}
              className="rounded-nerv border border-border bg-bg-elev px-4 py-3.5 xl:h-full xl:overflow-x-hidden xl:overflow-y-auto"
            >
              <FindingRail
                finding={selected}
                projectSlug={proj}
                projectId={id}
                canResolve={canResolve}
                canPromote={canPromote}
                {...railResolve(selected)}
              />
            </div>
          </aside>
        )}
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
