// S5 세션 모니터 — 보드 자체는 읽기 전용이다(scope.md §4.1 · 로드맵 §2.3).
// steer/stop 은 Phase 1 승격 범위였고 **들어와 있다** — 이 파일이 아니라 옆의
// `steer-panel.tsx` 다(2026-09-05 현황 정정: 예전 주석은 "여기 없다" 를 "아직 없다" 로
// 읽히게 두고 있었다).
//
// 실시간: project:{id} 룸의 session.* 이벤트가 이 화면의 쿼리를 무효화한다(screens.md §1.4).
// 재연결하면 전부 재조회한다 — replay 는 없다(D-14).

import { sessionState, statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { useSessions } from '../../lib/queries.js';
import { SessionCard } from './session-card.js';
import type { SessionBoardResult } from './types.js';
import { Button, EmptyState, Skeleton, SummaryStrip } from '../../components/ui/primitives.js';
import { SESSION_TOKEN, statusDot } from '../../components/status-token.js';
import { ErrorState } from '../../components/query-state.js';
import { ConnectAgentLinks } from '../../components/connect-agent-links.js';
import type { ProjectId } from '../../lib/query-keys.js';

/** 어휘와 **순서**의 정본은 `@nerv/schema` 다 — 화면이 목록을 새로 만들지 않는다 */
const SESSION_STATES = sessionState.enumValues;

export interface SessionBoardProps {
  projectSlug: string;
  projectId: ProjectId | undefined;
  /** master-detail — 선택된 세션 id 와 선택 콜백(시안 §2.5) */
  selectedId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** 스트립에서 고른 상태 — null 이면 전부(REQ-WEB-116) */
  state?: string | null;
  onStateChange?: ((state: string | null) => void) | undefined;
}

export function SessionBoard({
  projectSlug,
  projectId,
  selectedId,
  onSelect,
  state = null,
  onStateChange,
}: SessionBoardProps): React.JSX.Element {
  const t = useT();
  const query = useSessions(projectSlug, projectId, state) as {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data: SessionBoardResult | undefined;
    refetch: () => unknown;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
  };

  if (query.isLoading) {
    // 로딩은 화면 골격으로 — 스피너 단독 금지(screens.md §1.5)
    return (
      <div data-testid="session-board-skeleton">
        <Skeleton rows={3} className="[&>div]:h-24" />
      </div>
    );
  }

  if (query.isError) {
    // 실패는 비어 있음과 다른 모양이다(SYS-14 · REQ-WEB-198) — 공용 실패 카드
    return (
      <ErrorState
        error={query.error}
        title={t('sessions.load_failed')}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const result = query.data;
  const items = result?.items ?? [];

  // **거르고 나서 비어 있는 것은 "세션이 없다" 가 아니다.** 그때 부트스트랩 안내를 띄우면
  // 사람은 자기가 필터를 켠 사실을 잊고 "세션이 사라졌다" 고 읽는다.
  if (items.length === 0 && state !== null) {
    return (
      <div className="flex flex-col gap-3">
        <SessionSummaryStrip
          summary={result?.summary ?? {}}
          selected={state}
          onSelect={onStateChange}
        />
        <EmptyState
          icon="◌"
          title={t('sessions.none_in_state', { state: t(statusLabelKey('session', state)) })}
          action={
            onStateChange === undefined ? null : (
              <Button size="sm" variant="ghost" onClick={() => onStateChange(null)}>
                {t('sessions.show_all')}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (items.length === 0) {
    // 빈 상태에 막다른 길을 두지 않는다 — 다음 행동 링크를 준다(screens.md §1.5)
    return (
      <EmptyState
        icon="◉"
        title={t('sessions.none_running')}
        hint={
          <>
            {t('sessions.none_hint_pre')}{' '}
            <code className="font-mono text-text-mute">nerv_bootstrap</code>
            {t('sessions.none_hint_post')}
          </>
        }
        action={<ConnectAgentLinks />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SessionSummaryStrip
        summary={result?.summary ?? {}}
        selected={state}
        onSelect={onStateChange}
      />
      {/* 줄이 되었으니 격자가 아니라 목록이다 — 2열로 쪼개면 세로 훑기가 끊긴다 */}
      {/* 시안은 상자를 걷었다 — 줄 사이 실선만으로 목록이 된다 */}
      <div className="flex flex-col">
        {items.map((card) => (
          <SessionCard
            projectSlug={projectSlug}
            key={card.id}
            card={card}
            selected={selectedId === card.id}
            onSelect={onSelect === undefined ? undefined : () => onSelect(card.id)}
          />
        ))}
      </div>
      {/*
        **벽 대신 문**(REQ-WEB-150). 보드는 서버 기본 상한에서 끝났고, 그 끝은 오류도 빈
        상태도 아니라 "이게 전부" 로 읽힌다 — 스트립이 "종료 47건" 이라 적은 옆에서.
        단추는 더 받을 것이 있을 때만 그린다: 눌러도 아무 일이 없는 단추는 두지 않는다.
      */}
      {query.hasNextPage && (
        <div className="flex justify-center pt-1">
          <Button
            size="sm"
            variant="ghost"
            data-testid="sessions-load-more"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? t('common.loading') : t('sessions.more')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * 요약 스트립 — 상태별 집계이자 **필터다**(screens.md §2.6 · REQ-WEB-116).
 *
 * 숫자가 보이면 사람은 그것을 누른다. 예전에는 눌러도 아무 일이 없었다 — "종료 12건" 을
 * 보고 그 열둘이 무엇인지 알려면 목록 전체를 훑어야 했다(사람 보고 2026-08-30).
 * 고른 것을 다시 누르면 풀린다: 필터를 켜는 길과 끄는 길이 같은 자리에 있어야 한다.
 *
 * **숫자는 필터를 따라가지 않는다.** 전체 그림이 스트립이고 목록이 그 조각이라,
 * 거를 때마다 숫자가 1로 바뀌면 스트립이 스트립이기를 그만둔다.
 *
 * **0 인 상태도 자리를 지킨다**(2026-09-05 사람 요청 · REQ-WEB-139). 있는 것만 그리면
 * 스트립의 폭과 칸이 프로젝트마다·시각마다 달라져 눈이 매번 자리를 다시 찾아야 하고,
 * 무엇보다 **"오류 0건" 과 "오류라는 상태가 없음" 을 구별할 수 없다.** 0 인 칸은 누를
 * 것이 없으므로 물러서고 눌리지 않는다 — 눌러도 빈 목록이 나오는 단추는 두지 않는다.
 */
export function SessionSummaryStrip({
  summary,
  selected = null,
  onSelect,
}: {
  summary: Record<string, number>;
  selected?: string | null;
  onSelect?: ((state: string | null) => void) | undefined;
}): React.JSX.Element {
  const t = useT();
  const total = Object.values(summary).reduce((sum, n) => sum + n, 0);
  // 어휘 순서로 놓고, 어휘 밖의 값이 오면 뒤에 붙인다 — 조용히 사라지는 칸을 만들지 않는다
  const entries: [string, number][] = [
    ...SESSION_STATES.map((state): [string, number] => [state, summary[state] ?? 0]),
    ...Object.entries(summary).filter(
      ([state, n]) => n > 0 && !(SESSION_STATES as readonly string[]).includes(state),
    ),
  ];
  return (
    // **배지 나열이 아니라 스트립이다**(2026-08-23 재검토). 상태 배지를 늘어놓으면
    // 숫자가 라벨 뒤에 붙어 작게 읽히고, "지금 몇 개가 도나"는 배지를 하나씩 훑어야
    // 답이 나온다. 큰 숫자 몇 개가 먼저 오는 편이 이 화면의 첫 물음에 맞다.
    // 하나도 없는 프로젝트에 0 을 여섯 개 늘어놓는 것은 답이 아니다 — 그때는 문장이 낫다
    total === 0 ? (
      <div className="text-xs text-text-faint" data-testid="session-summary">
        {t('sessions.no_sessions')}
      </div>
    ) : (
      // 시안의 세션 스트립은 **점 + 큰 숫자 + 라벨**을 한 줄에 둔다 — 상태의 색은 점이 나르고 숫자는 중립을 지킨다.
      // 줄은 공용 요약 스트립 한 벌이다(2026-09-26 · SYS-13) — 칸이 여섯이라 좁은 폭에서는 넘치는데, 예전에는 이
      // 자리만 가로 스크롤로 따로 풀었다. 이제 다른 요약 줄처럼 접힌다
      <SummaryStrip
        data-testid="session-summary"
        layout="inline"
        metrics={entries.map(([state, n]) => {
          const on = selected === state;
          // 고를 수 있는 칸은 **셀 것이 있는** 칸뿐이다 — onSelect 를 주지 않는 화면(개요 카드)은 모두 잠긴다
          const selectable = onSelect !== undefined && n > 0;
          return {
            label: t(statusLabelKey('session', state)),
            value: n,
            testId: `session-filter-${state}`,
            // 점은 **세션 → 토큰 → 점** 한 길이다 — 따로 든 표에서 stale 이 회색이었다(배지는 빨강 · SYS-07)
            dot: statusDot(SESSION_TOKEN, state),
            toggle: {
              pressed: on,
              onToggle: () => onSelect?.(on ? null : state),
              disabled: !selectable,
            },
            // 물러서는 이유는 둘인데 결과는 하나다 — 셀 것이 없거나, 다른 칸을 골랐다
            dimmed: n === 0 || (onSelect !== undefined && selected !== null && !on),
          };
        })}
      />
    )
  );
}
