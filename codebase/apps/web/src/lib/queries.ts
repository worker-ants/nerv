// 화면이 쓰는 조회 훅 모음 — 키 규약은 query-keys.ts, 무효화는 event-invalidation.ts 가 쥔다.
//
// 훅을 한 곳에 모으는 이유는 **폴백 폴링**(REQ-WEB-002) 때문이다. WS 가 끊긴 동안에는 화면이
// 스스로 갱신해야 하는데, 그 판단이 화면마다 흩어지면 어떤 화면은 조용히 멈춘 채로 남는다.

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type { UseQueryResult, UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import { apiFetch } from './api.js';
import type { GraphEdge, GraphNode } from '../features/spec-graph/graph.js';
import { PENDING_PROJECT, queryKeys } from './query-keys.js';
import type { ProjectId } from './query-keys.js';
import { FALLBACK_POLL_MS, useRealtime } from './realtime.js';
import { fetchMe } from './session.js';
import type { Me } from './session.js';

export type Row = Record<string, unknown>;

/**
 * 목록 응답을 배열로 좁힌다. 서버가 배열을 주는 계약이지만, 화면이 그 계약을 **믿고 크래시하는**
 * 것과 빈 목록으로 버티는 것은 다르다 — 목록 하나 때문에 흰 화면이 되면 사용자는 무엇이
 * 잘못됐는지조차 볼 수 없다(§1.5 에러는 인라인 카드로).
 */
export function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

/** WS 가 끊겨 있으면 폴링으로 갱신한다 — 붙어 있으면 이벤트가 무효화를 대신한다. */
function useLivePolling(): number | false {
  const { state, offline } = useRealtime();
  return state === 'connected' && !offline ? false : FALLBACK_POLL_MS;
}

export function useMe(): UseQueryResult<Me> {
  return useQuery({ queryKey: queryKeys.me(), queryFn: fetchMe, retry: false });
}

/**
 * 조직의 프로젝트 목록.
 *
 * `includeArchived` 는 **관리 화면만** 켠다. 헤더 select 나 홈이 보관한 것까지 보이면
 * 치운 것이 치워지지 않은 셈이 되고, 그러면 보관에 뜻이 없다.
 */
export function useProjects(
  orgSlug: string | null,
  includeArchived = false,
): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['org', orgSlug, 'projects', includeArchived],
    queryFn: () =>
      apiFetch<Row[]>(
        `/orgs/${orgSlug ?? ''}/projects${includeArchived ? '?include_archived=true' : ''}`,
      ),
    enabled: orgSlug !== null,
  });
}

export function useProject(slug: string): UseQueryResult<Row> {
  return useQuery({
    // **slug 축**이다 — 이 쿼리가 slug 를 id 로 바꿔 준다(query-keys.ts `projectBySlug`)
    queryKey: queryKeys.projectBySlug(slug),
    queryFn: () => apiFetch<Row>(`/projects/${slug}`),
    // **프로젝트가 없으면 묻지 않는다.** 셸은 전역 화면(홈·받은 요청·설정)에서도 이 훅을
    // 부르는데 그때 slug 가 빈 문자열이라 `/projects/` 로 나갔고, 서버는 그것을
    // `:proj = ''` 로 받아 uuid 캐스트에서 터졌다 — **화면마다 조용한 500 두 개**가
    // 깔려 있었다(실측 2026-08-24. 원인 사슬을 로그에 펴 놓은 덕에 바로 보였다).
    enabled: slug !== '',
  });
}

/** 받은 요청 한 쪽 — 봉투는 §1.6 그대로고 `total` 이 하나 더 있다(REQ-API-166) */
export interface InboxPage {
  items: Row[];
  next_cursor: string | null;
  /**
   * **쪽이 아니라 전체 수**다. 쪽을 나누는 순간 "목록 길이 = 전체 수" 가 깨지는데, 받은
   * 요청은 그 수를 세 자리에서 쓴다(헤더 배지 · 홈의 인사 · "받은 요청 전체 N건").
   */
  total: number;
  /**
   * 그중 **내가 누를 수 있는 것**(질문 + 승인할 수 있는 결재 · REQ-API-184). 대기 탭에만 온다.
   * 세 자리는 이제 이 수를 쓴다(2026-09-24 사람 결정 D2 · REQ-WEB-217) — `total` 에는 내가
   * 요청했거나 쓴 것처럼 **승인할 수 없는 카드**가 섞여, 할 일을 다 해도 배지가 0 이 되지 않았다.
   */
  actionable_total?: number;
}

/**
 * 받은 요청 — **커서로 이어 받는다**(2026-09-24 · REQ-API-166).
 *
 * 예전에는 한 번 부르고 끝이라 서버 상한 100건에서 목록이 벽이 됐고, 그 벽이 **오래
 * 기다린 쪽**을 잘랐다(서버가 최근 100건을 집고 화면이 다시 오래된 순으로 세웠다 —
 * 실측 2026-09-24: 120건 중 가장 오래 기다린 20건이 통째로 빠졌다). 알림 목록이 2026-09-03
 * 에 겪은 것과 같은 자리이고, 거기서 배운 대로 **배지와 목록이 같은 수를 보게** 한다.
 */
export function useInbox(
  state: 'pending' | 'decided' = 'pending',
): UseInfiniteQueryResult<InfiniteData<InboxPage>> {
  const refetchInterval = useLivePolling();
  return useInfiniteQuery({
    queryKey: [...queryKeys.inbox(), state],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ state });
      if (pageParam !== null) params.set('cursor', String(pageParam));
      return apiFetch<InboxPage>(`/approvals?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval,
  });
}

/**
 * 쪽들을 한 목록으로 편다 — 화면은 커서를 모르고 카드만 안다.
 *
 * `rows()` 와 나란히 두는 이유는 같다: 서버가 봉투를 주는 계약이지만 화면이 그 계약을
 * **믿고 크래시하는** 것과 빈 목록으로 버티는 것은 다르다(§1.5).
 */
export function inboxCards(data: InfiniteData<InboxPage> | undefined): Row[] {
  return (data?.pages ?? []).flatMap((page) => rows(page.items));
}

/** 전체 수 — 첫 쪽이 실어 준다. 아직 안 왔으면 0 이다(숫자를 지어내지 않는다) */
export function inboxTotal(data: InfiniteData<InboxPage> | undefined): number {
  const total = data?.pages[0]?.total;
  return typeof total === 'number' ? total : 0;
}

/**
 * 이 프로젝트에서 **내가 누를 수 있는 받은 요청의 수**(EP-APR-05 · REQ-WEB-220). 개요 머리의
 * "기다리는 것" 한 줄이 쓴다 — 전역 목록은 쪽으로 나뉘어 받아 온 카드로는 셀 수 없고, 서버가
 * 같은 판정으로 센 `actionable_total` 이 정본이다. 카드는 한 장만 받는다(수만 필요하다).
 */
export function useProjectInboxCount(slug: string, projectId?: ProjectId): UseQueryResult<number> {
  const refetchInterval = useLivePolling();
  return useQuery({
    // `['inbox', …]` 접두 — 결재·질문 이벤트가 받은 요청을 되읽을 때 이것도 함께 간다
    queryKey: [...queryKeys.inbox(), 'project', projectId ?? PENDING_PROJECT],
    queryFn: async () => {
      const page = await apiFetch<InboxPage>(`/projects/${slug}/inbox?limit=1`);
      return typeof page.actionable_total === 'number' ? page.actionable_total : page.total;
    },
    refetchInterval,
    enabled: projectId !== undefined,
  });
}

/**
 * **내가 누를 수 있는 수** — 헤더 배지 · 홈의 인사 · 받은 요청 머리가 쓴다(REQ-WEB-217).
 * 서버가 그 수를 싣지 않으면(처리됨 탭 · 옛 서버) 전체 수로 버틴다 — 지어낸 0 보다 낫다.
 */
export function inboxActionable(data: InfiniteData<InboxPage> | undefined): number {
  const actionable = data?.pages[0]?.actionable_total;
  return typeof actionable === 'number' ? actionable : inboxTotal(data);
}

/**
 * **이 카드를 내가 누를 수 없는가** — 서버 판정(`can_approve`)이 거짓인 결재. 질문은 멤버 누구나
 * 답하므로 잠기지 않는다. 판정을 다시 하지 않는다 — 서버가 준 값을 읽기만 한다(REQ-WEB-118).
 */
export function lockedCard(card: Row): boolean {
  return card['subject_type'] !== 'question' && card['can_approve'] === false;
}

/**
 * 알림 목록 — **커서로 이어 받는다**(2026-09-03 · REQ-API-083).
 *
 * 예전에는 한 번 부르고 끝이라 서버 기본 상한 50 건에서 목록이 벽이 됐다. 실측(2026-09-03):
 * 안 읽은 알림 479건 중 **429건에 웹에서 닿을 수 없었다** — 헤더 배지는 진짜 수를 보이는데
 * 목록은 50 에서 끝나므로 화면이 자기 배지와 어긋났다.
 */
export function useNotifications(
  /**
   * 거르는 축 — **중요**(`importance=immediate` · REQ-WEB-149) 또는 **안 읽음**(`state=unread` ·
   * §2.9 의 둘째 필터). 한 세그먼트에서 셋(전체·중요·안 읽음) 중 하나를 고른다(REQ-WEB-218).
   */
  filter?: 'important' | 'unread',
): UseInfiniteQueryResult<InfiniteData<{ items: Row[]; next_cursor: string | null }>> {
  const refetchInterval = useLivePolling();
  return useInfiniteQuery({
    // 거르는 축이 다르면 **다른 목록**이라 캐시 키가 갈라져야 한다. `'list'` 를 끼우는 이유 —
    // 안 읽은 **수**의 키가 `[...myNotifications(), 'unread']` 라, 목록 키가 같은 모양이면
    // 목록과 수가 한 캐시 칸을 다투게 된다
    queryKey: [...queryKeys.myNotifications(), 'list', filter ?? 'all'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam !== null) params.set('before', String(pageParam));
      if (filter === 'important') params.set('importance', 'immediate');
      if (filter === 'unread') params.set('state', 'unread');
      const query = params.toString();
      return apiFetch<{ items: Row[]; next_cursor: string | null }>(
        `/me/notifications${query === '' ? '' : `?${query}`}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval,
  });
}

export function useUnreadCount(): UseQueryResult<{ count: number; immediate: number }> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: [...queryKeys.myNotifications(), 'unread'],
    queryFn: () => apiFetch<{ count: number; immediate: number }>('/me/notifications/unread-count'),
    refetchInterval,
  });
}

/**
 * **프로젝트 축은 `project.id` 하나다.**
 *
 * 아래 훅들은 URL 을 slug 로 만들고 캐시 키를 id 로 만든다. 그 id 는 프로젝트 조회가
 * 끝나야 오는데, 키를 `projectId ?? slug` 로 잡으면 한 번의 로드 안에서 키가 slug → id 로
 * **바뀌고**, TanStack Query 에게 그것은 다른 쿼리라 **같은 URL 을 두 번 부른다**
 * (실측 2026-09-10: `/p/:proj/reviews` 한 로드가 11건이고 그중 3건이 중복이었다 —
 * 트리·발견 큐·게이트 현황).
 *
 * 낭비보다 나쁜 것이 둘 더 있다. ① 먼저 그려진 slug 축 사본은 아무도 구독하지 않는 유령이
 * 되는데, `event-invalidation.ts` 는 키를 `project_id` 로만 만들므로 그 사본은 **영영
 * 무효화되지 않는다**. ② 사람 눈에는 목록이 떴다 사라졌다 다시 뜨는 깜빡임이다 —
 * 2026-08-23 에 `useTasks` 에서 실측하고 고친 그 결함인데, **형제 훅들은 같은 모양으로
 * 남아 있었다**.
 *
 * 그래서 규약은 하나다: **키는 id 축으로만 잡고, id 가 오기 전에는 부르지 않는다.**
 */

export function useSpecTree(
  slug: string,
  projectId?: ProjectId,
  includeArchived = false,
  /**
   * 기준선 — 고르면 **그 세트가 담은 문서만**, 그때 핀된 버전으로 온다(REQ-API-098).
   *
   * 기준선은 세트다. 그 뒤에 만들어진 문서가 목록에 섞이면 그것은 기준선이 아니라
   * "지금" 이고, 보는 사람은 그 세트가 그 문서를 담고 있다고 읽는다.
   */
  baseline?: string,
): UseQueryResult<Row[]> {
  const pin = baseline === undefined || baseline === '' ? '' : baseline;
  return useQuery({
    // 세트가 다르면 **다른 목록**이라 캐시 키가 갈라져야 한다
    queryKey: [...queryKeys.projectSpecTree(projectId ?? PENDING_PROJECT), includeArchived, pin],
    queryFn: () =>
      apiFetch<Row[]>(
        `/projects/${slug}/specs/tree?include_archived=${String(includeArchived)}` +
          (pin === '' ? '' : `&baseline=${encodeURIComponent(pin)}`),
      ),
    // 프로젝트 축 — id 가 오기 전에는 부르지 않는다(파일 위 "프로젝트 축" 규약)
    enabled: projectId !== undefined,
  });
}

/**
 * 스펙 상세. **키는 고정 ID(스펙 키)이고 이벤트 봉투는 UUID 를 싣는다** — 그래서 이 쿼리는
 * 이벤트로 직접 무효화되지 않고, 같은 이벤트가 함께 무효화하는 트리(projectSpecTree)의
 * 재조회와 화면 재진입으로 갱신된다. 두 축을 억지로 잇지 않는 편이 낫다: 봉투에 key 를
 * 실으면 이름 변경이 이벤트 계약을 깨고, 화면이 UUID 를 쓰면 URL 이 사람이 못 읽는 것이 된다.
 */
export function useSpec(slug: string, specKey: string, baseline?: string): UseQueryResult<Row> {
  return useQuery({
    // 기준선이 다르면 **다른 버전**이라 캐시 키가 갈라져야 한다 — 같은 키로 두면
    // 세트를 바꿔도 앞서 읽은 버전이 그대로 보인다
    queryKey: [...queryKeys.spec(specKey), baseline ?? null],
    // **`include=tasks` 를 붙이는 이유**: 영향 미리보기가 파생 Task 수를 세는데, 서버는
    // 요청해야 그것을 싣는다(EP-SPEC-03). 붙이지 않던 동안 그 줄은 언제나 "0건" 이었다 —
    // 실측 2026-09-03: 파생 Task 를 가진 스펙 86개, 한 스펙 최대 29건이 0으로 보였다.
    queryFn: () =>
      apiFetch<Row>(
        `/projects/${slug}/specs/${specKey}?include=tasks` +
          (baseline === undefined || baseline === ''
            ? ''
            : `&baseline=${encodeURIComponent(baseline)}`),
      ),
    // 고르기 전에는 부르지 않는다 — 빈 키로 나가면 `/specs/` 가 되어 404 가 온다
    enabled: specKey !== '',
  });
}

/** EP-SPEC-19 — 전역 그래프. 노드·간선을 한 번에 받는다(끝점 없는 간선을 만들지 않는다) */
/**
 * **결재가 가리키는 바로 그 버전** — 받은 요청의 카드가 연다(REQ-WEB-119).
 *
 * `useSpec` 은 "지금 읽는 사람이 보는 버전"(최신 approved, 없으면 현재)을 준다. 결재는
 * **검토 중인 그 버전**을 두고 하는 결정이라 둘이 다를 수 있다 — 카드가 보여준 것과
 * 승인되는 것이 같아야 한다는 규약(§2.3 지문 대조)과 같은 이유다.
 */
export function useSpecVersion(
  slug: string,
  specKey: string,
  versionNo: number | null,
  enabled: boolean,
): UseQueryResult<Row> {
  return useQuery({
    queryKey: [...queryKeys.spec(specKey), 'v', versionNo ?? 'current'],
    queryFn: () =>
      apiFetch<Row>(
        `/projects/${slug}/specs/${specKey}${versionNo === null ? '' : `?v=${versionNo}`}`,
      ),
    enabled: enabled && specKey !== '',
  });
}

/**
 * EP-SPEC-06 버전 diff — 요구사항 델타 + 줄 단위 diff (REQ-WEB-121).
 *
 * **서버는 처음부터 이것을 줄 수 있었다.** 2026-09-01 까지 부르는 쪽이 없었을 뿐이다.
 */
export function useSpecDiff(
  slug: string,
  specKey: string,
  from: number | null,
  to: number | null,
): UseQueryResult<Row> {
  const query = new URLSearchParams();
  if (from !== null) query.set('from', String(from));
  if (to !== null) query.set('to', String(to));
  return useQuery({
    queryKey: [...queryKeys.spec(specKey), 'diff', from, to],
    queryFn: () => apiFetch<Row>(`/projects/${slug}/specs/${specKey}/diff?${query.toString()}`),
    enabled: specKey !== '' && from !== null && to !== null,
  });
}

/** 스펙 첨부 — 디자인 시안 등(REQ-WEB-125) */
export function useSpecAttachments(slug: string, specKey: string): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['spec', specKey, 'attachments'],
    queryFn: () => apiFetch<Row[]>(`/projects/${slug}/specs/${specKey}/attachments`),
    enabled: specKey !== '',
  });
}

export function useSpecGraph(
  slug: string,
  projectId: ProjectId | undefined,
  includeArchived = false,
  /** 표·그래프도 같은 세트를 본다 — 탭을 옮겼다고 목록이 달라지면 그것이 혼동이다 */
  baseline?: string,
): UseQueryResult<SpecGraph> {
  const pin = baseline === undefined || baseline === '' ? '' : baseline;
  return useQuery({
    queryKey: [...queryKeys.projectSpecGraph(projectId ?? PENDING_PROJECT), includeArchived, pin],
    queryFn: () =>
      apiFetch<SpecGraph>(
        `/projects/${slug}/specs/graph?include_archived=${String(includeArchived)}` +
          (pin === '' ? '' : `&baseline=${encodeURIComponent(pin)}`),
      ),
    enabled: projectId !== undefined,
  });
}

export interface SpecGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * **유한 목록은 봉투로 온다**(2026-09-07 · REQ-API-155 — `{items, total}`).
 *
 * 자라지 않는 목록이라 커서가 아니라 총계다. 훅이 `items` 를 풀어 주므로 부르는 쪽의
 * `rows(...)` 는 그대로 산다 — 봉투를 화면마다 풀면 그때마다 조금씩 다르게 푼다.
 */
export function useSpecVersions(slug: string, specKey: string): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: queryKeys.specVersions(specKey),
    queryFn: () =>
      apiFetch<{ items: Row[]; total: number }>(`/projects/${slug}/specs/${specKey}/versions`),
    select: (data) => data.items,
  });
}

export function useSpecComments(slug: string, specKey: string): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: queryKeys.specComments(specKey),
    queryFn: () =>
      apiFetch<{ items: Row[]; total: number }>(`/projects/${slug}/specs/${specKey}/comments`),
    select: (data) => data.items,
  });
}

/** EP-SPEC-09 — 사전 검토(읽기 전용 셀프서비스). 제출 게이트의 근거를 화면에 미리 보인다. */
export function useSpecCheck(slug: string, versionId: string | null): UseQueryResult<Row> {
  return useQuery({
    queryKey: ['spec-version', versionId, 'check'],
    queryFn: () => apiFetch<Row>(`/projects/${slug}/spec-versions/${versionId ?? ''}/check`),
    enabled: versionId !== null && versionId !== '',
  });
}

export function useSpecRelations(
  slug: string,
  specKey: string,
): UseQueryResult<{ items: Row[]; total: number }> {
  return useQuery({
    queryKey: [...queryKeys.spec(specKey), 'relations'],
    queryFn: () =>
      apiFetch<{ items: Row[]; total: number }>(`/projects/${slug}/specs/${specKey}/relations`),
  });
}

/**
 * S4 보드의 **레인 하나**. 레인마다 따로 부르는 이유가 있다.
 *
 * 전에는 한 번 불러 전량을 받아 화면에서 갈랐다 — clemvion 실측 487건 · 229 KB 였고 그
 * 중 done 이 86% 였다(2026-08-23). 한 목록을 잘라 쓰면 자를 수가 없다: 우선순위 순으로
 * 30건을 받으면 전부 done 이고 ready 는 한 건도 없는 페이지가 나온다. 레인이 각자
 * 자기 창을 갖는 편이 맞다.
 *
 * 키가 `projectTasks` 를 앞에 두므로 기존 이벤트 무효화(접두 일치)가 그대로 듣는다.
 */
export function useTaskLane(
  slug: string,
  projectId: ProjectId | undefined,
  lane: string,
  options?: { includeArchived?: boolean; assignee?: string; spec?: string; ai?: boolean },
): UseInfiniteQueryResult<{ items: Row[]; next_cursor: string | null }> {
  const refetchInterval = useLivePolling();
  const archived = options?.includeArchived === true;
  const assignee = options?.assignee ?? '';
  // **서버는 이 인자를 처음부터 받고 있었다**(EP-TASK-01 `?spec=`) — 넘기는 곳만 없어서
  // "이 스펙의 작업만" 을 링크로 건넬 수 없었다(2026-09-06 대조 · screens.md:164).
  const spec = options?.spec ?? '';
  /** `?ai=1` — 에이전트 세션이 쥔 것만(REQ-API-122). 서버가 판정한다 */
  const ai = options?.ai === true;
  return useInfiniteQuery({
    // **slug 로 대신 잡지 않는다.** projectId 는 프로젝트 조회가 끝나야 오는데, 그때
    // 키가 slug → id 로 바뀌면 새 쿼리가 되어 레인이 빈 채로 한 번 더 그려진다 —
    // 화면에서는 목록이 나타났다 사라졌다 다시 나타나는 깜빡임이다(실측 2026-08-23).
    // 무효화가 project_id 로 키를 만드므로(event-invalidation.ts) id 축이 정답이고,
    // 오기 전까지는 아예 부르지 않는다.
    queryKey: [
      ...queryKeys.projectTasks(projectId ?? PENDING_PROJECT),
      lane,
      archived,
      assignee,
      spec,
      ai,
    ],
    queryFn: ({ pageParam }) =>
      apiFetch<{ items: Row[]; next_cursor: string | null }>(
        `/projects/${slug}/tasks?status=${lane}` +
          (archived ? '&include_archived=true' : '') +
          (assignee === '' ? '' : `&assignee=${encodeURIComponent(assignee)}`) +
          (spec === '' ? '' : `&spec=${encodeURIComponent(spec)}`) +
          (ai ? '&ai=1' : '') +
          (pageParam === null ? '' : `&cursor=${encodeURIComponent(pageParam)}`),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    /**
     * **레인은 한 쪽에서 끝나지 않는다**(2026-09-25 — UI/UX 검토 WORK-10 · REQ-WEB-221). 서버의
     * 한 쪽(30건)을 채운 레인은 "30+" 를 달았는데 [+N개 더]는 받아 둔 카드만 펼쳐, 보관 보기를 켠
     * done 레인(실측 419건)이나 큰 backlog 에서 31번째부터는 보드로 닿을 길이 없었다. 부르는 쪽
     * (보드·요약·스펙 레일·시트)은 `items` 를 그대로 읽으므로 평탄화는 여기서 한다.
     */
    select: (data: InfiniteData<{ items: Row[]; next_cursor: string | null }>) => ({
      items: data.pages.flatMap((page) => page.items),
      next_cursor: data.pages[data.pages.length - 1]?.next_cursor ?? null,
    }),
    enabled: projectId !== undefined,
    refetchInterval,
  });
}

/**
 * 이 문서가 약속한 것 — EP-REQ-01.
 *
 * 화면이 이 질문을 하지 않던 동안 D-03·FR-13 의 축(약속 ↔ 그것을 지키는 일)이
 * 프로젝트 개요의 숫자로만 존재했다 — **어느 요구사항인지**는 아무 화면도 말하지 않았다.
 */
export function useRequirements(slug: string, specKey: string): UseQueryResult<Row[]> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: [...queryKeys.spec(specKey), 'requirements'],
    queryFn: () =>
      apiFetch<Row[]>(`/projects/${slug}/requirements?spec=${encodeURIComponent(specKey)}`),
    refetchInterval,
  });
}

export function useTask(slug: string, taskKey: string): UseQueryResult<Row> {
  return useQuery({
    queryKey: queryKeys.task(taskKey),
    queryFn: () => apiFetch<Row>(`/projects/${slug}/tasks/${taskKey}`),
  });
}

export interface SessionBoardResponse {
  items: Row[];
  summary: Record<string, number>;
  /** 다음 쪽 — null 이면 끝이다(§1.6). 컨트롤러는 처음부터 주고 있었다 */
  next_cursor: string | null;
}

/**
 * 세션 보드 데이터. **키는 projectId 로 잡는다** — 이벤트 봉투가 project_id 를 싣고
 * 무효화 매핑이 그 값으로 키를 만들기 때문이다(event-invalidation.ts). slug 로 잡으면
 * 이벤트가 와도 이 쿼리는 갱신되지 않는다.
 */
/**
 * 세션 목록 — `state` 는 **서버가 거른다**(엔드포인트가 처음부터 `?state=` 를 받는다).
 *
 * 목록은 서버 상한에서 잘리므로 클라이언트에서 거르면 "종료 12건" 이라 적어 놓고 그중
 * 일부만 보이는 화면이 된다. 요약(`summary`)은 필터와 무관하게 **프로젝트 전체**다 —
 * 스트립이 전체 그림이고 목록이 그 조각이라는 관계가 그래야 성립한다.
 *
 * **커서로 이어 받는다**(2026-09-07 · REQ-WEB-150). 컨트롤러는 `cursor` 를 처음부터 주고
 * 있었는데 웹은 어디서도 보내지 않아, 보드는 기본 30건에서 벽이었다 — 그 벽은 오류도 빈
 * 상태도 아니라 **"이게 전부"** 로 읽힌다(REQ-API-120 이 활동 목록에서 막은 것과 같은
 * 모양이다). 알림·발견 큐가 이미 같은 자리를 [더 보기]로 닫아 두었다.
 */
/** 플러그인 활성화 현황의 한 줄 — 사람 + 기계 (EP-SES-06) */
export interface PluginHost {
  user_id: string;
  user_name: string;
  hostname: string;
  last_seen_at: string;
  plugin_version: string | null;
  active: boolean;
}

export interface PluginCoverage {
  window_days: number;
  total: number;
  active: number;
  hosts: PluginHost[];
}

/**
 * 플러그인 활성화 현황 — EP-SES-06 · REQ-WEB-189 (2026-09-24 · E12-S03).
 *
 * 세션 보드와 **같은 축 아래**에 둔다: 세션 이벤트가 보드를 무효화하면 이것도 함께 새로 읽는다
 * (새 기계가 세션을 열면 분모가 바뀐다). 폴링은 하지 않는다 — 분 단위로 바뀌는 수가 아니다.
 */
export function usePluginCoverage(
  slug: string,
  projectId?: ProjectId,
): UseQueryResult<PluginCoverage> {
  return useQuery({
    queryKey: [...queryKeys.projectSessions(projectId ?? PENDING_PROJECT), 'plugin-coverage'],
    queryFn: () => apiFetch<PluginCoverage>(`/projects/${slug}/sessions/plugin-coverage`),
    enabled: projectId !== undefined,
  });
}

export function useSessions(
  slug: string,
  projectId?: ProjectId,
  state?: string | null,
): UseInfiniteQueryResult<SessionBoardResponse> {
  const refetchInterval = useLivePolling();
  return useInfiniteQuery({
    queryKey: [...queryKeys.projectSessions(projectId ?? PENDING_PROJECT), state ?? 'all'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (state != null && state !== '') params.set('state', state);
      if (pageParam !== null) params.set('cursor', String(pageParam));
      const query = params.toString();
      return apiFetch<SessionBoardResponse>(
        `/projects/${slug}/sessions${query === '' ? '' : `?${query}`}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    // **쪽을 이어 붙여 한 목록으로 준다.** 부르는 쪽 셋(보드·개요·세션 화면)이 `items` 를
    // 그대로 읽으므로 평탄화는 여기서 한다 — 화면마다 펴면 그때마다 조금씩 다르게 편다.
    // 요약은 필터·쪽과 무관한 **프로젝트 전체**라 첫 쪽 것이 정본이다(스트립이 전체 그림이고
    // 목록이 그 조각이라는 관계가 그래야 성립한다).
    select: (data: InfiniteData<SessionBoardResponse>) => ({
      items: data.pages.flatMap((page) => page.items),
      summary: data.pages[0]?.summary ?? {},
      next_cursor: data.pages[data.pages.length - 1]?.next_cursor ?? null,
    }),
    refetchInterval,
    // 프로젝트 축 — id 가 오기 전에는 부르지 않는다(파일 위 "프로젝트 축" 규약)
    enabled: projectId !== undefined,
  });
}

/**
 * 세션의 **작업 궤적** — 도구 로그가 아니라 "무엇을 했나"(REQ-API-068 · REQ-WEB-124).
 *
 * 세션 모니터의 첫 물음은 "무슨 도구를 썼나" 가 아니라 "무엇을 하는 중이고 막혀 있나" 다.
 */
export function useSessionTrajectory(slug: string, sessionId: string): UseQueryResult<Row[]> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: ['session', sessionId, 'trajectory'],
    queryFn: () => apiFetch<Row[]>(`/projects/${slug}/sessions/${sessionId}/trajectory`),
    enabled: sessionId !== '',
    refetchInterval,
  });
}

export function useSessionDetail(slug: string, sessionId: string): UseQueryResult<Row> {
  return useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => apiFetch<Row>(`/projects/${slug}/sessions/${sessionId}`),
  });
}

/**
 * 세션 타임라인 — **커서로 이어 받는다**(2026-09-07 · EP-SES-03 · REQ-WEB-141).
 *
 * 2026-09-06 에 봉투가 생기면서(REQ-API-120) 화면은 "앞쪽이 더 있다" 고 **말만** 했다.
 * 잘렸다고 알리는 것과 거기로 가는 길을 주는 것은 다른 일이다 — 443건 세션의 초반은
 * 여전히 닿지 않았고, 알림·발견 큐가 이미 같은 자리를 [더 보기]로 닫아 두었다
 * (REQ-WEB-131). 그래서 알림과 **같은 모양**의 무한 쿼리로 바꾼다.
 *
 * **쪽은 과거로 간다.** 서버는 `seq DESC` 로 seek 하고 한 쪽 안에서만 오름차순으로
 * 되돌려 주므로, 두 번째 쪽은 첫 쪽보다 **더 오래된** 것이다. 시간 순으로 읽으려면
 * 쪽을 뒤집어 이어 붙여야 한다 — `flatTimeline()` 이 그 한 줄이고, 호출부가 각자
 * 하면 어느 화면 하나는 시간이 거꾸로 흐른다.
 */
export function useSessionTimelinePages(
  slug: string,
  sessionId: string,
): UseInfiniteQueryResult<InfiniteData<{ items: Row[]; next_cursor: string | null }>> {
  const refetchInterval = useLivePolling();
  return useInfiniteQuery({
    queryKey: [...queryKeys.session(sessionId), 'activities'],
    queryFn: ({ pageParam }) =>
      apiFetch<{ items: Row[]; next_cursor: string | null }>(
        `/projects/${slug}/sessions/${sessionId}/activities` +
          (pageParam === null ? '' : `?cursor=${encodeURIComponent(String(pageParam))}`),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? null,
    enabled: sessionId !== '',
    refetchInterval,
  });
}

/** 받아 온 쪽들을 **시간 순 한 줄로** — 뒤 쪽일수록 과거라 뒤집어 잇는다 */
export function flatTimeline(
  data: InfiniteData<{ items: Row[]; next_cursor: string | null }> | undefined,
): Row[] {
  return [...(data?.pages ?? [])].reverse().flatMap((page) => rows(page.items));
}

export function useCoverage(slug: string, projectId?: ProjectId): UseQueryResult<Row> {
  return useQuery({
    queryKey: [...queryKeys.project(projectId ?? PENDING_PROJECT), 'coverage'],
    queryFn: () => apiFetch<Row>(`/projects/${slug}/coverage`),
    // 프로젝트 축 — id 가 오기 전에는 부르지 않는다(파일 위 "프로젝트 축" 규약)
    enabled: projectId !== undefined,
  });
}

/**
 * 최근 이벤트 — **응답은 봉투다**(`{items, next_cursor}` · REQ-API-120).
 *
 * 2026-09-06 에 서버가 봉투를 씌웠는데 이 훅은 맨 배열을 기대하고 있었다 — 홈·프로젝트
 * 개요의 "최근 이벤트" 가 그날부터 **빈 목록**이었다(배열이 아닌 값에 `rows()` 가 `[]` 를
 * 준다). 화면은 오류도 빈 상태도 아닌 "아무 일도 없었다" 를 보여 준다 — 가장 나쁜 모양이다.
 *
 * `select` 로 `items` 를 풀어 호출부(`rows(events.data)`)를 그대로 둔다.
 */
/**
 * EP-EVT-01 — 프로젝트 활동 피드. **쪽을 잇는다**(2026-09-24 · REQ-WEB-210). 개요는 30줄에서
 * 끝났고 더 볼 길이 없었다 — 서버는 처음부터 `next_cursor` 를 줬다. 홈과 개요가 같은 키를 쓰니
 * 같은 모양이어야 한다(한쪽이 맨 목록, 다른 쪽이 쪽 묶음이면 캐시가 서로를 깬다).
 */
export function useEventFeed(
  slug: string,
  projectId?: ProjectId,
): UseInfiniteQueryResult<InfiniteData<{ items: Row[]; next_cursor: string | null }>> {
  const refetchInterval = useLivePolling();
  return useInfiniteQuery({
    queryKey: queryKeys.projectEvents(projectId ?? PENDING_PROJECT),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (pageParam !== null) params.set('before', String(pageParam));
      return apiFetch<{ items: Row[]; next_cursor: string | null }>(
        `/projects/${slug}/events?${params.toString()}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval,
    // 프로젝트 축 — id 가 오기 전에는 부르지 않는다(파일 위 "프로젝트 축" 규약)
    enabled: projectId !== undefined,
  });
}

export interface FindingQueueResponse {
  items: Row[];
  /** 서버가 실제로 적용한 상한 — 화면이 "몇 건 중 몇 건"을 말하려면 필요하다 */
  limit: number;
  /** 다음 쪽 — null 이면 끝이다(REQ-API-083) */
  next_cursor: string | null;
  facets: {
    severity: Record<string, number>;
    status: Record<string, number>;
    /** 어디에 대한 지적인가 — 2026-09-01 신설(REQ-API-073) */
    area: Record<string, number>;
    tag: Record<string, number>;
  };
}

export interface GateCoverageResponse {
  items: Row[];
  /** 잘라 놓고 잘랐다고 말하지 않으면 화면이 거짓말한다(REQ-WEB-067) */
  total: number;
}

/**
 * 발견 큐(S6). **필터는 키의 일부다** — 필터를 바꾸면 다른 질문이라 다른 캐시다.
 * facet 이 같은 응답에 오므로 필터 칸의 숫자에 따로 요청하지 않는다(REQ-WEB-061).
 */
/**
 * 발견 큐 — **커서로 이어 받는다**(2026-09-03 · REQ-API-083).
 *
 * 예전에는 상한을 두 배씩 올려 200 에서 멈췄고 서버도 거기가 끝이었다. 실측(2026-09-03):
 * 열린 발견 18,653건 중 **18,453건에 웹에서 닿을 수 없었다** — critical 만 걸러도 423건이라
 * 상한 안에 들어오지 않는다. 화면은 "18653건 중 50건" 이라고 정직하게 말하면서 나머지로
 * 가는 길을 주지 않았다.
 */
export function useFindings(
  slug: string,
  filters: {
    severity: readonly string[];
    status: readonly string[];
    tag: readonly string[];
    area: readonly string[];
    /** 한 브랜치의 발견만(REQ-API-180) — 작업 상세의 리뷰 줄·게이트 표가 여기로 온다 */
    branch?: string | undefined;
  },
  projectId?: ProjectId,
): UseInfiniteQueryResult<InfiniteData<FindingQueueResponse>> {
  const refetchInterval = useLivePolling();
  const base = new URLSearchParams();
  if (filters.severity.length > 0) base.set('severity', filters.severity.join(','));
  if (filters.status.length > 0) base.set('status', filters.status.join(','));
  if (filters.tag.length > 0) base.set('tag', filters.tag.join(','));
  if (filters.area.length > 0) base.set('area', filters.area.join(','));
  if (filters.branch !== undefined && filters.branch !== '') base.set('branch', filters.branch);
  return useInfiniteQuery({
    queryKey: [...queryKeys.projectFindings(projectId ?? PENDING_PROJECT), filters],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams(base);
      if (pageParam !== null) query.set('cursor', String(pageParam));
      return apiFetch<FindingQueueResponse>(`/projects/${slug}/findings?${query.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? null,
    refetchInterval,
    // 프로젝트 축 — id 가 오기 전에는 부르지 않는다(파일 위 "프로젝트 축" 규약)
    enabled: projectId !== undefined,
  });
}

/** 한 발견에 달린 사람의 말 — 레일이 편 것만 부른다(고르지 않았으면 부르지 않는다) */
export function useFindingComments(
  slug: string,
  findingId: string | null,
): UseQueryResult<{ items: Row[] }> {
  return useQuery({
    queryKey: ['finding', findingId, 'comments'],
    queryFn: () =>
      apiFetch<{ items: Row[] }>(`/projects/${slug}/findings/${findingId ?? ''}/comments`),
    enabled: findingId !== null,
  });
}

export function useGateCoverage(
  slug: string,
  projectId?: ProjectId,
): UseQueryResult<GateCoverageResponse> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: queryKeys.projectGateCoverage(projectId ?? PENDING_PROJECT),
    queryFn: () => apiFetch<GateCoverageResponse>(`/projects/${slug}/gates/reviews`),
    refetchInterval,
    // 프로젝트 축 — id 가 오기 전에는 부르지 않는다(파일 위 "프로젝트 축" 규약)
    enabled: projectId !== undefined,
  });
}

export function useMembers(orgSlug: string | null): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['org', orgSlug, 'members'],
    queryFn: () => apiFetch<Row[]>(`/orgs/${orgSlug ?? ''}/members`),
    enabled: orgSlug !== null,
  });
}

/**
 * 내 토큰. `pollMs` 는 **방금 발급한 토큰이 연결되기를 기다리는 동안만** 준다(REQ-WEB-207) —
 * 첫 사용 시각(`last_used_at`)이 채워지면 원문 카드가 "연결됨" 으로 바뀐다.
 */
export function useTokens(pollMs: number | false = false): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['me', 'tokens'],
    queryFn: () => apiFetch<Row[]>('/me/tokens'),
    refetchInterval: pollMs,
  });
}

/**
 * EP-TOK-04 — 조직 전체 토큰(admin). "누가 어느 프로젝트에 무슨 토큰을 갖고 있나" 는
 * 내 목록으로는 답이 나오지 않는 물음이고, 서버는 2026-08 부터 답할 수 있었다.
 *
 * **admin 일 때만 부른다.** 서버가 admin 을 강제하므로 아니면 403 인데, 그 403 은
 * 화면에 아무것도 더해 주지 않으면서 오류 토스트만 띄운다 — 볼 수 없는 것을 부르지 않는
 * 쪽이 "권한이 없으면 화면에 그 자리가 없다" 는 §1.8 과도 맞는다.
 */
export function useOrgTokens(orgSlug: string | null, isAdmin: boolean): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['org', orgSlug, 'tokens'],
    queryFn: () => apiFetch<Row[]>(`/orgs/${orgSlug ?? ''}/tokens`),
    enabled: isAdmin && orgSlug !== null,
  });
}

/**
 * **내게 온 초대** — 홈·온보딩·알림 세 화면이 같은 값을 쓴다(EP-INV-06).
 *
 * 알림 테이블을 타지 않는 이유가 있다: `notification.project_id` 는 NOT NULL 인데 조직
 * 초대에는 프로젝트가 없고, 무엇보다 **초대받은 사람은 아직 아무 프로젝트의 멤버가
 * 아니다** — 프로젝트 소속 알림 목록은 그에게 언제나 비어 있다.
 */
export function useMyInvitations(): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['me', 'invitations'],
    queryFn: () => apiFetch<Row[]>('/me/invitations'),
  });
}

/** 조직이 보낸 초대 — 설정의 멤버 탭이 쓴다(EP-INV-02, admin) */
export function useOrgInvitations(orgSlug: string | null): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['org', orgSlug, 'invitations'],
    queryFn: () => apiFetch<Row[]>(`/orgs/${orgSlug ?? ''}/invitations`),
    enabled: orgSlug !== null,
  });
}
