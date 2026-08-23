// S5 세션 모니터 — **Phase 0 은 읽기 전용 축소판**이다(scope.md §4.1 · 로드맵 §2.3).
// steer/stop 은 Phase 1 승격 범위라 여기 없다(E08-S06).
//
// 실시간: project:{id} 룸의 session.* 이벤트가 이 화면의 쿼리를 무효화한다(screens.md §1.4).
// 재연결하면 전부 재조회한다 — replay 는 없다(D-14).

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SESSION_TOKEN } from '../../components/status-token.js';
import { SessionCard } from './session-card.js';
import type { SessionBoardResult } from './types.js';
import { Button, EmptyState, Skeleton } from '../../components/ui/primitives.js';

export interface SessionBoardProps {
  projectSlug: string;
  projectId: string;
}

export function SessionBoard({ projectSlug, projectId }: SessionBoardProps): React.JSX.Element {
  const query = useQuery({
    queryKey: queryKeys.projectSessions(projectId),
    queryFn: () => apiFetch<SessionBoardResult>(`/projects/${projectSlug}/sessions`),
  });

  if (query.isLoading) {
    // 로딩은 화면 골격으로 — 스피너 단독 금지(screens.md §1.5)
    return (
      <div data-testid="session-board-skeleton">
        <Skeleton rows={3} className="[&>div]:h-24" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        icon="⚠"
        title="세션을 불러오지 못했습니다."
        action={
          <Button size="sm" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        }
      />
    );
  }

  const result = query.data;
  const items = result?.items ?? [];

  if (items.length === 0) {
    // 빈 상태에 막다른 길을 두지 않는다 — 다음 행동 링크를 준다(screens.md §1.5)
    return (
      <EmptyState
        icon="◉"
        title="실행 중인 세션이 없습니다."
        hint={
          <>
            플러그인을 설치하고 <code className="font-mono text-text-mute">nerv_bootstrap</code> 을
            호출하면 여기 나타납니다.
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SessionSummaryStrip summary={result?.summary ?? {}} />
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((card) => (
          <SessionCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

/** 요약 스트립 — 상태별 집계(screens.md §2.6) */
export function SessionSummaryStrip({
  summary,
}: {
  summary: Record<string, number>;
}): React.JSX.Element {
  const entries = Object.entries(summary).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-wrap gap-2" data-testid="session-summary">
      {entries.length === 0 ? (
        <span className="text-xs text-text-faint">세션 없음</span>
      ) : (
        entries.map(([state, n]) => (
          <StatusBadge
            key={state}
            token={SESSION_TOKEN[state as keyof typeof SESSION_TOKEN] ?? 'idle'}
            label={`${state} ${n}`}
          />
        ))
      )}
    </div>
  );
}
