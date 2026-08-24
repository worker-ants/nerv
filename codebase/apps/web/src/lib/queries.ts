// 화면이 쓰는 조회 훅 모음 — 키 규약은 query-keys.ts, 무효화는 event-invalidation.ts 가 쥔다.
//
// 훅을 한 곳에 모으는 이유는 **폴백 폴링**(REQ-WEB-002) 때문이다. WS 가 끊긴 동안에는 화면이
// 스스로 갱신해야 하는데, 그 판단이 화면마다 흩어지면 어떤 화면은 조용히 멈춘 채로 남는다.

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from './api.js';
import type { GraphEdge, GraphNode } from '../features/spec-graph/graph.js';
import { queryKeys } from './query-keys.js';
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

export function useProjects(orgSlug: string | null): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['org', orgSlug, 'projects'],
    queryFn: () => apiFetch<Row[]>(`/orgs/${orgSlug ?? ''}/projects`),
    enabled: orgSlug !== null,
  });
}

export function useProject(slug: string): UseQueryResult<Row> {
  return useQuery({
    queryKey: queryKeys.project(slug),
    queryFn: () => apiFetch<Row>(`/projects/${slug}`),
    // **프로젝트가 없으면 묻지 않는다.** 셸은 전역 화면(홈·승인함·설정)에서도 이 훅을
    // 부르는데 그때 slug 가 빈 문자열이라 `/projects/` 로 나갔고, 서버는 그것을
    // `:proj = ''` 로 받아 uuid 캐스트에서 터졌다 — **화면마다 조용한 500 두 개**가
    // 깔려 있었다(실측 2026-08-24. 원인 사슬을 로그에 펴 놓은 덕에 바로 보였다).
    enabled: slug !== '',
  });
}

export function useInbox(state: 'pending' | 'decided' = 'pending'): UseQueryResult<Row[]> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: [...queryKeys.inbox(), state],
    queryFn: () => apiFetch<Row[]>(`/approvals?state=${state}`),
    refetchInterval,
  });
}

export function useNotifications(): UseQueryResult<Row[]> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: queryKeys.myNotifications(),
    queryFn: () => apiFetch<Row[]>('/me/notifications'),
    refetchInterval,
  });
}

export function useUnreadCount(): UseQueryResult<{ count: number }> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: [...queryKeys.myNotifications(), 'unread'],
    queryFn: () => apiFetch<{ count: number }>('/me/notifications/unread-count'),
    refetchInterval,
  });
}

export function useSpecTree(
  slug: string,
  projectId?: string,
  includeArchived = false,
): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: [...queryKeys.projectSpecTree(projectId ?? slug), includeArchived],
    queryFn: () =>
      apiFetch<Row[]>(`/projects/${slug}/specs/tree?include_archived=${String(includeArchived)}`),
  });
}

/**
 * 스펙 상세. **키는 안정 키(SPC-…)이고 이벤트 봉투는 UUID 를 싣는다** — 그래서 이 쿼리는
 * 이벤트로 직접 무효화되지 않고, 같은 이벤트가 함께 무효화하는 트리(projectSpecTree)의
 * 재조회와 화면 재진입으로 갱신된다. 두 축을 억지로 잇지 않는 편이 낫다: 봉투에 key 를
 * 실으면 이름 변경이 이벤트 계약을 깨고, 화면이 UUID 를 쓰면 URL 이 사람이 못 읽는 것이 된다.
 */
export function useSpec(slug: string, specKey: string): UseQueryResult<Row> {
  return useQuery({
    queryKey: queryKeys.spec(specKey),
    queryFn: () => apiFetch<Row>(`/projects/${slug}/specs/${specKey}`),
  });
}

/** EP-SPEC-19 — 전역 그래프. 노드·간선을 한 번에 받는다(끝점 없는 간선을 만들지 않는다) */
export function useSpecGraph(
  slug: string,
  projectId: string | undefined,
): UseQueryResult<SpecGraph> {
  return useQuery({
    queryKey: ['project', projectId ?? slug, 'specGraph'],
    queryFn: () => apiFetch<SpecGraph>(`/projects/${slug}/specs/graph`),
    enabled: projectId !== undefined,
  });
}

export interface SpecGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function useSpecVersions(slug: string, specKey: string): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: queryKeys.specVersions(specKey),
    queryFn: () => apiFetch<Row[]>(`/projects/${slug}/specs/${specKey}/versions`),
  });
}

export function useSpecComments(slug: string, specKey: string): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: queryKeys.specComments(specKey),
    queryFn: () => apiFetch<Row[]>(`/projects/${slug}/specs/${specKey}/comments`),
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

export function useSpecRelations(slug: string, specKey: string): UseQueryResult<{ items: Row[] }> {
  return useQuery({
    queryKey: [...queryKeys.spec(specKey), 'relations'],
    queryFn: () => apiFetch<{ items: Row[] }>(`/projects/${slug}/specs/${specKey}/relations`),
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
  projectId: string | undefined,
  lane: string,
  options?: { includeArchived?: boolean; assignee?: string },
): UseQueryResult<{ items: Row[]; next_cursor: string | null }> {
  const refetchInterval = useLivePolling();
  const archived = options?.includeArchived === true;
  const assignee = options?.assignee ?? '';
  return useQuery({
    // **slug 로 대신 잡지 않는다.** projectId 는 프로젝트 조회가 끝나야 오는데, 그때
    // 키가 slug → id 로 바뀌면 새 쿼리가 되어 레인이 빈 채로 한 번 더 그려진다 —
    // 화면에서는 목록이 나타났다 사라졌다 다시 나타나는 깜빡임이다(실측 2026-08-23).
    // 무효화가 project_id 로 키를 만드므로(event-invalidation.ts) id 축이 정답이고,
    // 오기 전까지는 아예 부르지 않는다.
    queryKey: [...queryKeys.projectTasks(projectId ?? ''), lane, archived, assignee],
    queryFn: () =>
      apiFetch<{ items: Row[]; next_cursor: string | null }>(
        `/projects/${slug}/tasks?status=${lane}` +
          (archived ? '&include_archived=true' : '') +
          (assignee === '' ? '' : `&assignee=${encodeURIComponent(assignee)}`),
      ),
    enabled: projectId !== undefined,
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
}

/**
 * 세션 보드 데이터. **키는 projectId 로 잡는다** — 이벤트 봉투가 project_id 를 싣고
 * 무효화 매핑이 그 값으로 키를 만들기 때문이다(event-invalidation.ts). slug 로 잡으면
 * 이벤트가 와도 이 쿼리는 갱신되지 않는다.
 */
export function useSessions(
  slug: string,
  projectId?: string,
): UseQueryResult<SessionBoardResponse> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: queryKeys.projectSessions(projectId ?? slug),
    queryFn: () => apiFetch<SessionBoardResponse>(`/projects/${slug}/sessions`),
    refetchInterval,
  });
}

export function useSessionDetail(slug: string, sessionId: string): UseQueryResult<Row> {
  return useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => apiFetch<Row>(`/projects/${slug}/sessions/${sessionId}`),
  });
}

export function useSessionTimeline(slug: string, sessionId: string): UseQueryResult<Row[]> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: [...queryKeys.session(sessionId), 'activities'],
    queryFn: () => apiFetch<Row[]>(`/projects/${slug}/sessions/${sessionId}/activities`),
    refetchInterval,
  });
}

export function useCoverage(slug: string, projectId?: string): UseQueryResult<Row> {
  return useQuery({
    queryKey: [...queryKeys.project(projectId ?? slug), 'coverage'],
    queryFn: () => apiFetch<Row>(`/projects/${slug}/coverage`),
  });
}

export function useEvents(slug: string, projectId?: string): UseQueryResult<Row[]> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: queryKeys.projectEvents(projectId ?? slug),
    queryFn: () => apiFetch<Row[]>(`/projects/${slug}/events?limit=30`),
    refetchInterval,
  });
}

export interface FindingQueueResponse {
  items: Row[];
  /** 서버가 실제로 적용한 상한 — 화면이 "몇 건 중 몇 건"을 말하려면 필요하다 */
  limit: number;
  facets: {
    severity: Record<string, number>;
    status: Record<string, number>;
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
export function useFindings(
  slug: string,
  filters: { severity: readonly string[]; status: readonly string[]; tag: readonly string[] },
  projectId?: string,
  limit?: number,
): UseQueryResult<FindingQueueResponse> {
  const refetchInterval = useLivePolling();
  const query = new URLSearchParams();
  if (filters.severity.length > 0) query.set('severity', filters.severity.join(','));
  if (filters.status.length > 0) query.set('status', filters.status.join(','));
  if (filters.tag.length > 0) query.set('tag', filters.tag.join(','));
  if (limit !== undefined) query.set('limit', String(limit));
  return useQuery({
    queryKey: [...queryKeys.projectFindings(projectId ?? slug), filters, limit],
    queryFn: () => apiFetch<FindingQueueResponse>(`/projects/${slug}/findings?${query.toString()}`),
    refetchInterval,
  });
}

export function useGateCoverage(
  slug: string,
  projectId?: string,
): UseQueryResult<GateCoverageResponse> {
  const refetchInterval = useLivePolling();
  return useQuery({
    queryKey: queryKeys.projectGateCoverage(projectId ?? slug),
    queryFn: () => apiFetch<GateCoverageResponse>(`/projects/${slug}/gates/reviews`),
    refetchInterval,
  });
}

export function useMembers(orgSlug: string | null): UseQueryResult<Row[]> {
  return useQuery({
    queryKey: ['org', orgSlug, 'members'],
    queryFn: () => apiFetch<Row[]>(`/orgs/${orgSlug ?? ''}/members`),
    enabled: orgSlug !== null,
  });
}

export function useTokens(): UseQueryResult<Row[]> {
  return useQuery({ queryKey: ['me', 'tokens'], queryFn: () => apiFetch<Row[]>('/me/tokens') });
}
