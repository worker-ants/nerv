// TanStack Query 키 규약 — 정본: docs/04-mvp/screens.md §1.4
//
// 키를 문자열로 흩뿌리지 않고 여기 한 곳에서 만든다. 이벤트 → 무효화 매핑
// (event-invalidation.ts)이 같은 함수를 쓰기 때문에, 키가 갈라지면 실시간 갱신이 조용히 죽는다.

/**
 * **프로젝트 축의 표시.** 아래 `project*` 키들은 전부 `project.id`(UUIDv7)로 잡히고,
 * slug 로 잡으면 캐시가 갈려 조회는 같은 URL 을 두 번 부르고 무효화는 아무 데도 닿지 않는다.
 *
 * 그 결함이 **네 번** 반복됐다(2026-08-23 작업 보드 · 2026-08-29 사이드바 트리 ·
 * 2026-09-10 개입 패널 · 발견 승격). 네 번 다 타입도 lint 도 통과했고 화면만 조용히
 * 안 바뀌었다 — 두 축이 똑같이 `string` 이라 **틀릴 방법이 있었기** 때문이다.
 * 표시를 붙이면 slug 를 넘기는 코드가 컴파일되지 않는다.
 *
 * 값은 그대로 문자열이다. 만드는 길은 `asProjectId()` 하나이고, 그 함수가 유일한 경계다.
 */
export type ProjectId = string & { readonly __projectId: unique symbol };

/**
 * 서버가 준 값에서 프로젝트 축을 만든다 — **이 축을 만드는 유일한 자리다.**
 *
 * `Row` 는 `Record<string, unknown>` 이라 화면마다 `typeof x === 'string' ? x : undefined`
 * 를 손으로 적어 왔다(실측 여덟 곳). 그 판정을 여기 하나로 모은다.
 */
export function asProjectId(value: unknown): ProjectId | undefined {
  return typeof value === 'string' && value !== '' ? (value as ProjectId) : undefined;
}

/**
 * id 가 **아직 오지 않은 동안**의 자리표. 프로젝트 조회가 끝나야 축이 생기는데 키는 첫
 * 렌더부터 필요하다 — 그 사이를 이 값으로 메우고, 그 키의 쿼리는 `enabled` 가 막아
 * **절대 나가지 않는다**(queries.ts "프로젝트 축"). slug 를 대신 넣지 않는 이유가 그것이다:
 * slug 를 넣으면 나가 버린다.
 */
export const PENDING_PROJECT = '' as ProjectId;

export const queryKeys = {
  me: () => ['me'] as const,
  myNotifications: () => ['me', 'notifications'] as const,
  inbox: () => ['inbox'] as const,

  /**
   * 프로젝트 축의 뿌리. **접두 일치**로 그 아래(`…/coverage` 등)까지 함께 무효화한다.
   */
  project: (projId: ProjectId) => ['project', projId] as const,
  /**
   * **slug 축은 여기 하나뿐이다** — `useProject` 는 slug 를 id 로 바꿔 주는 *해소용*
   * 쿼리라, 부를 시점에 가진 것이 slug 밖에 없다. 이름을 갈라 두는 이유는 위의 `project`
   * 와 같은 모양(`['project', X]`)을 내면서 **뜻이 다르기** 때문이다.
   */
  projectBySlug: (slug: string) => ['project', slug] as const,
  projectSpecTree: (projId: ProjectId) => ['project', projId, 'specTree'] as const,
  /** 스펙 표·관계 그래프가 함께 쓰는 한 응답(EP-SPEC-19) */
  projectSpecGraph: (projId: ProjectId) => ['project', projId, 'specGraph'] as const,
  projectTasks: (projId: ProjectId) => ['project', projId, 'tasks'] as const,
  projectSessions: (projId: ProjectId) => ['project', projId, 'sessions'] as const,
  projectBaselines: (projId: ProjectId) => ['project', projId, 'baselines'] as const,
  projectEvents: (projId: ProjectId) => ['project', projId, 'events'] as const,
  /** S6 리뷰 센터 — 큐와 게이트 현황이 같은 축(발견의 변화)으로 갱신된다 */
  projectFindings: (projId: ProjectId) => ['project', projId, 'findings'] as const,
  projectGateCoverage: (projId: ProjectId) => ['project', projId, 'gateCoverage'] as const,

  spec: (specId: string) => ['spec', specId] as const,
  specVersions: (specId: string) => ['spec', specId, 'versions'] as const,
  specComments: (specId: string) => ['spec', specId, 'comments'] as const,

  task: (taskId: string) => ['task', taskId] as const,
  session: (sessionId: string) => ['session', sessionId] as const,
  /**
   * 감사 축이 무효화하는 자리(2026-09-07 · REQ-API-151). 설정 화면들이 각자 적어 쓰던
   * 배열을 여기로 모은다 — 키가 두 벌이면 실시간 갱신이 조용히 죽는다(이 파일의 존재 이유).
   */
  myTokens: () => ['me', 'tokens'] as const,
  orgMembers: (orgSlug: string) => ['org', orgSlug, 'members'] as const,
} as const;

export type NervQueryKey = readonly unknown[];
