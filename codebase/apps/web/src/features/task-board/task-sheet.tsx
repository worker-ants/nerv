// 작업 상세 시트 — **보드 위에 연다** (screens.md §2.5 하위 뷰 · REQ-WEB-213)
//
// 2026-09-24 사람 결정(명세대로): 상세가 보드를 갈아 끼우는 페이지였을 때는 막힌 카드 여러 장을
// 훑는 트리아지가 카드마다 왕복 두 번이었고, 보드를 보면서 상세를 읽을 수 없었다. 시트는 보드를
// 가리지만 **보드를 치우지 않는다** — 뒤의 카드를 누르면 시트가 그 작업으로 바뀐다(모달이 아니다).
//
// 닫기(✕ · Esc)는 보드 주소로 가되 **걸어 둔 필터를 그대로** 둔다. j / k 는 같은 레인의 다음·앞
// 카드로 넘긴다 — 레인의 순서는 보드가 이미 받아 둔 그 목록이다(같은 쿼리 키라 다시 부르지 않는다).
// 좁은 화면에서는 화면 전체를 덮는다: 곁에 둘 폭이 없는데 곁에 두면 둘 다 읽을 수 없다.

import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n.js';
import { useProject, useTaskLane } from '../../lib/queries.js';
import { asProjectId } from '../../lib/query-keys.js';
import { useScrollTopOn } from '../../lib/scroll-top.js';
import { boardFilters } from './board-search.js';

/** 입력 중에는 단축키가 글자를 먹지 않는다 — 받은 요청의 j/k 와 같은 규칙이다 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function TaskSheet({
  taskKey,
  status,
  children,
}: {
  taskKey: string;
  /** 지금 작업의 레인 — 받아 오기 전이면 null(j/k 가 쉰다) */
  status: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const { proj } = useParams({ from: '/p/$proj/tasks' });
  const search = useSearch({ from: '/p/$proj/tasks' });
  const project = useProject(proj);
  const projectId = asProjectId(project.data?.['id']);
  const filters = boardFilters(search);
  // **보드의 레인과 같은 키**로 묻는다 — 보드가 이미 받아 둔 목록을 그대로 읽는다(board.tsx `Lane`)
  const lane = useTaskLane(proj, status === null ? undefined : projectId, status ?? '', {
    ...(filters.spec === undefined ? {} : { spec: filters.spec }),
    ...(filters.ai === true ? { ai: true } : {}),
    ...(filters.assignee === undefined ? {} : { assignee: filters.assignee }),
    includeArchived: status === 'done' && filters.archived === true,
  });
  const keys = (lane.data?.items ?? []).map((item) => String(item['key']));
  const at = keys.indexOf(taskKey);

  const close = (): void =>
    void navigate({ to: '/p/$proj/tasks', params: { proj }, search: filters });
  const open = (key: string): void =>
    void navigate({
      to: '/p/$proj/tasks/$task',
      params: { proj, task: key },
      search: filters,
    });

  // 시트가 열리거나 다른 작업으로 바뀌면 **읽는 자리를 시트로** 옮긴다 — 키보드로 연 사람이
  // 뒤의 보드에 남아 있으면 Esc 도 j/k 도 어디에 대한 것인지 모른다. 시트 전체가 아니라 ✕ 에 둔다:
  // 전역 `:focus-visible` 테두리가 시트 가장자리를 따라 긴 파란 선으로 섰다(L3 스크린샷 실측).
  // 읽는 도구는 ✕ 에 닿으면서 시트(대화상자)의 이름을 함께 읽는다
  const closeRef = useRef<HTMLButtonElement>(null);
  // 다른 작업으로 넘기면(j/k · 보드에서 다른 카드) 시트는 처음부터 읽는다(REQ-WEB-244)
  const sheetRef = useRef<HTMLElement>(null);
  useScrollTopOn(sheetRef, taskKey);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [taskKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (at < 0) return;
      if (e.key === 'j' && at + 1 < keys.length) open(keys[at + 1]!);
      if (e.key === 'k' && at > 0) open(keys[at - 1]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <aside
      ref={sheetRef}
      role="dialog"
      aria-modal="false"
      aria-label={t('task.sheet.label', { key: taskKey })}
      data-testid="task-sheet"
      className="@container fixed top-header right-0 bottom-0 z-20 w-full overflow-y-auto border-l border-border bg-bg shadow-popover lg:w-[min(46rem,64vw)]"
    >
      <div className="sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-border bg-bg/95 px-4 py-1.5 text-2xs text-text-faint backdrop-blur-sm">
        {at >= 0 && keys.length > 1 && (
          <span data-testid="task-sheet-position">
            {t('task.sheet.position', { n: at + 1, total: keys.length })}
          </span>
        )}
        <button
          ref={closeRef}
          type="button"
          data-testid="task-sheet-close"
          aria-label={t('task.sheet.close')}
          title={t('task.sheet.close_hint')}
          onClick={close}
          className="rounded-nerv-sm px-1.5 py-0.5 text-sm text-text-mute hover:bg-bg-hover hover:text-text"
        >
          ✕
        </button>
      </div>
      {children}
    </aside>
  );
}
