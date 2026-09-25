// 스펙 트리의 둘째 열 — 스펙 상세에서만 선다 (2026-09-25 — 사람 결정 D1 · UI/UX 검토 OBS-01 · REQ-WEB-226)
//
// 트리는 사이드바의 마지막 블록이었다. 그래서 작업 보드·세션·리뷰에서도 그 화면과 상관없는 141편이
// 왼쪽 열 대부분을 차지했고, 스펙 목록에서는 같은 트리가 본문에 한 벌 더 서서 한 화면에 두 번 보였다.
// 사이드바가 모든 화면에 서게 된 뒤로(REQ-WEB-225) 사이드바는 "어느 프로젝트의 어느 화면" 까지만 말하고,
// 한 화면 안의 깊은 구조는 그 화면에서만 서는 둘째 열이 든다(리서치 패턴 5 — Jira·Plane·Sentry).
//
// **서는 곳은 스펙 상세뿐이다.** 스펙 목록의 본문 트리가 이 열의 전체 화면 판이라(§2.4), 목록에서 이 열을
// 세우면 같은 트리가 다시 두 벌이 된다.
//
// **한 벌이다.** 폭에 따라 두 벌을 그리지 않는다 — 넓으면(`xl`) 제자리에 서고, 좁으면 띠의 단추가 여는
// 겹침 패널이다(REQ-WEB-164 의 서랍과 같은 규칙). 닫혀도 언마운트하지 않는다: 펼침과 스크롤이 남는다.

import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { useMediaQuery } from '../lib/use-media-query.js';
import { cn } from '../lib/utils.js';
import { SpecTree } from './spec-tree.js';
import type { ProjectId } from '../lib/query-keys.js';

/** 열이 제자리에 서는 폭 — 사이드바(15rem)·열(16rem)·본문(26rem 바닥)·레일(17rem)이 함께 드는 가장 좁은 폭이다 */
const COLUMN_QUERY = '(min-width: 80rem)';
const STORAGE_KEY = 'nerv.spec-column';
const PANEL_ID = 'spec-column-panel';

/** 넓은 화면에서 사람이 접어 둔 것은 남는다 — 좁은 화면의 열고 닫음은 그 순간의 것이라 남기지 않는다 */
function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    // 저장이 막힌 환경에서도 열은 선다 — 이번 방문 동안만 기억한다
  }
}

/** 패널 아이콘 — 열이 열려 있으면 왼쪽으로(접기), 닫혀 있으면 오른쪽으로(펴기) */
function PanelIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9 4.5v15" />
      <path d={open ? 'M15.5 10l-2 2 2 2' : 'M13.5 10l2 2-2 2'} />
    </svg>
  );
}

export function SpecTreeColumn({
  projectSlug,
  projectId,
  activeKey,
  baseline,
}: {
  projectSlug: string;
  projectId?: ProjectId | undefined;
  activeKey: string | undefined;
  baseline?: string | undefined;
}): React.JSX.Element {
  const t = useT();
  const wide = useMediaQuery(COLUMN_QUERY);
  const [open, setOpen] = useState(() => wide && readOpen());
  const toggleRef = useRef<HTMLButtonElement>(null);

  // 폭이 바뀌면 그 폭의 규칙으로 — 넓어지면 사람이 정해 둔 것, 좁아지면 닫힘(본문을 덮은 채 남지 않게)
  useEffect(() => {
    setOpen(wide && readOpen());
  }, [wide]);

  // 좁은 화면의 패널은 **어디론가 떠나면 닫힌다** — 다른 문서를 골랐으면 그 문서를 읽을 차례다
  useEffect(() => {
    if (!wide) setOpen(false);
  }, [activeKey, wide]);

  useEffect(() => {
    if (wide || !open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, wide]);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (wide) writeOpen(next);
  };
  const label = open ? t('specs.column.hide') : t('specs.column.show');
  const toggleButton = (
    <button
      ref={toggleRef}
      type="button"
      data-testid="spec-column-toggle"
      aria-expanded={open}
      aria-controls={PANEL_ID}
      aria-label={label}
      title={label}
      onClick={toggle}
      className="flex size-6 shrink-0 items-center justify-center rounded-nerv-sm text-text-mute hover:bg-bg-active hover:text-text"
    >
      <PanelIcon open={open} />
    </button>
  );

  return (
    <div
      data-testid="spec-column"
      data-open={open ? 'true' : 'false'}
      // 사이드바와 같은 규칙이다 — 페이지가 흘러도 열은 화면 높이로 제자리에 선다. `sticky` 는 제 쌓임 맥락을
      // 만들어 안쪽 패널의 z 가 그 안에 갇힌다 — 열 자신이 z 를 가져야 좁은 폭의 패널이 본문(제목의 sticky · z-20)을
      // 덮는다. 헤더·서랍의 뒷막(z-30)보다는 아래다: 서랍이 열린 동안 띠가 뒷막 위로 떠 눌리면 안 된다
      className="sticky top-header z-[25] flex h-[calc(100dvh-var(--spacing-header))] shrink-0 self-start"
    >
      {/* **띠** — 열이 제자리에 없을 때(접었거나 좁은 폭) 여는 자리가 늘 같은 곳에 있다 */}
      {!(open && wide) && (
        <div className="flex w-8 shrink-0 flex-col items-center border-r border-border bg-bg-sunken/40 pt-3">
          {toggleButton}
        </div>
      )}
      <div
        id={PANEL_ID}
        data-testid="spec-column-panel"
        role="region"
        aria-label={t('shell.spec_tree')}
        onClick={(e) => {
          // 좁은 폭에서 같은 문서를 다시 눌러도 닫힌다 — 경로가 그대로면 위의 effect 는 걸리지 않는다
          if (!wide && (e.target as HTMLElement).closest('a') !== null) setOpen(false);
        }}
        className={cn(
          open ? 'flex' : 'hidden',
          'w-64 min-h-0 flex-col border-r border-border bg-bg px-2 py-3',
          wide ? 'h-full' : 'absolute top-0 bottom-0 left-8 shadow-popover',
        )}
      >
        <SpecTree
          projectSlug={projectSlug}
          projectId={projectId}
          variant="rail"
          activeKey={activeKey}
          heading={t('shell.spec_tree')}
          baseline={baseline}
          titleFilter
          headerAction={open && wide ? toggleButton : undefined}
        />
      </div>
    </div>
  );
}
