// TanStack Query 키 규약 — 정본: docs/04-mvp/screens.md §1.4
//
// 키를 문자열로 흩뿌리지 않고 여기 한 곳에서 만든다. 이벤트 → 무효화 매핑
// (event-invalidation.ts)이 같은 함수를 쓰기 때문에, 키가 갈라지면 실시간 갱신이 조용히 죽는다.

export const queryKeys = {
  me: () => ['me'] as const,
  myNotifications: () => ['me', 'notifications'] as const,
  inbox: () => ['inbox'] as const,

  project: (projId: string) => ['project', projId] as const,
  projectSpecTree: (projId: string) => ['project', projId, 'specTree'] as const,
  projectTasks: (projId: string) => ['project', projId, 'tasks'] as const,
  projectSessions: (projId: string) => ['project', projId, 'sessions'] as const,
  projectBaselines: (projId: string) => ['project', projId, 'baselines'] as const,
  projectEvents: (projId: string) => ['project', projId, 'events'] as const,

  spec: (specId: string) => ['spec', specId] as const,
  specVersions: (specId: string) => ['spec', specId, 'versions'] as const,
  specComments: (specId: string) => ['spec', specId, 'comments'] as const,

  task: (taskId: string) => ['task', taskId] as const,
  session: (sessionId: string) => ['session', sessionId] as const,
} as const;

export type NervQueryKey = readonly unknown[];
