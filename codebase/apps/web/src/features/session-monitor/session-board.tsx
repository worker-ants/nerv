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
import { cn } from '../../lib/utils.js';
import { Button, EmptyState, Skeleton } from '../../components/ui/primitives.js';
import type { ProjectId } from '../../lib/query-keys.js';

/** 어휘와 **순서**의 정본은 `@nerv/schema` 다 — 화면이 목록을 새로 만들지 않는다 */
const SESSION_STATES = sessionState.enumValues;

/** 상태 점 — §4.2 매핑의 진한 쪽을 그대로 쓴다(새 색을 만들지 않는다) */
const SUMMARY_DOT: Record<string, string> = {
  pending: 'bg-status-idle-text',
  active: 'bg-status-ok',
  awaiting_input: 'bg-status-waiting',
  complete: 'bg-status-done',
  error: 'bg-status-danger',
  stale: 'bg-status-idle-text',
};

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
    return (
      <EmptyState
        icon="⚠"
        title={t('sessions.load_failed')}
        action={
          <Button size="sm" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        }
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
            onStateChange === undefined ? undefined : (
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
      // 시안의 세션 스트립은 **점 + 큰 숫자 + 라벨**을 한 줄에 둔다 — 상태의 색은
      // 점이 나르고 숫자는 중립을 지킨다(숫자까지 물들이면 스트립이 신호등이 된다).
      // 칸이 여섯이라 좁은 화면에서는 넘친다 — 문서를 가로로 밀지 않고 스트립 안에서 민다
      <div
        data-testid="session-summary"
        className="flex items-center overflow-x-auto border-y border-border py-[13px]"
      >
        {entries.map(([state, n], i) => {
          const on = selected === state;
          const label = t(statusLabelKey('session', state));
          // 고를 수 있는 칸은 **셀 것이 있는** 칸뿐이다
          const selectable = onSelect !== undefined && n > 0;
          // 물러서는 이유는 둘인데 결과는 하나다 — 두 클래스가 겹치지 않게 여기서 합친다
          const dimmed = n === 0 || (onSelect !== undefined && selected !== null && !on);
          return (
            <button
              key={state}
              type="button"
              data-testid={`session-filter-${state}`}
              data-selected={on}
              aria-pressed={on}
              // 고를 수 없으면 단추처럼 굴지 않는다 — 누를 수 있어 보이는데 안 눌리는 것이
              // 가장 나쁘다. onSelect 를 주지 않는 화면(개요 카드)이 그 자리다.
              disabled={!selectable}
              onClick={() => onSelect?.(on ? null : state)}
              className={cn(
                'flex shrink-0 items-center gap-[9px] pr-[30px] transition-opacity',
                i < entries.length - 1 && 'mr-[30px] border-r border-border',
                selectable && 'cursor-pointer hover:opacity-100',
                // 고른 것만 온전히 보이고 나머지는 물러선다 — 선택이 색이 아니라 **대비**로 읽힌다
                dimmed && 'opacity-45',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-[7px] shrink-0 rounded-full',
                  SUMMARY_DOT[state] ?? 'bg-status-idle-text',
                )}
              />
              <span className="text-[20px] leading-none font-[650] tracking-[-0.02em] tabular-nums">
                {n}
              </span>
              <span className={cn('text-sm', on ? 'text-text' : 'text-text-mute')}>{label}</span>
            </button>
          );
        })}
      </div>
    )
  );
}
