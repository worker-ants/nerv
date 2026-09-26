// 둘째 열의 뼈대 — 사이드바와 본문 사이에 서는 접을 수 있는 열 (screens.md §1.3 · REQ-WEB-226 · REQ-WEB-232)
//
// 스펙 상세의 트리(REQ-WEB-226)와 도움말의 차례(2026-09-25 사람 지시 · REQ-WEB-232)가 같은 열을 쓴다. 한 화면 안의
// 깊은 구조는 사이드바가 아니라 그 화면에서만 서는 이 열이 든다 — 사이드바는 "어느 프로젝트의 어느 화면" 까지만
// 말한다(리서치 패턴 5). 두 열이 따로 짜이면 여는 자리·접는 단추·좁은 폭의 겹침이 화면마다 달라진다.
//
// **한 벌이다.** 폭에 따라 두 벌을 그리지 않는다 — 넓으면 제자리에 서고, 좁으면 띠의 단추가 여는 겹침 패널이다
// (REQ-WEB-164 의 서랍과 같은 규칙). 닫혀도 언마운트하지 않는다: 펼침과 스크롤이 남는다.

import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../lib/use-media-query.js';
import { cn } from '../lib/utils.js';

/** 넓은 화면에서 사람이 접어 둔 것은 남는다 — 좁은 화면의 열고 닫음은 그 순간의 것이라 남기지 않는다 */
function readOpen(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== 'closed';
  } catch {
    return true;
  }
}

function writeOpen(storageKey: string, open: boolean): void {
  try {
    localStorage.setItem(storageKey, open ? 'open' : 'closed');
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

export function SideColumn({
  name,
  query,
  storageKey,
  label,
  showLabel,
  hideLabel,
  activeKey,
  children,
}: {
  /** 검사 이름의 머리 — `${name}-column` · `${name}-column-toggle` · `${name}-column-panel` */
  name: string;
  /** 열이 제자리에 서는 폭 — 그보다 좁으면 띠와 겹침 패널이다 */
  query: string;
  /** 넓은 화면에서 접어 둔 것을 기억하는 자리 */
  storageKey: string;
  /** 패널의 이름(보조기기) */
  label: string;
  showLabel: string;
  hideLabel: string;
  /** 지금 보는 것 — 바뀌면 좁은 폭의 패널이 닫힌다(다른 것을 골랐으면 그것을 읽을 차례다) */
  activeKey: string | undefined;
  /** 패널의 내용 — 열이 제자리에 서 있으면 머리에 둘 접기 단추를 받는다 */
  children: (headerAction: React.ReactNode | undefined) => React.ReactNode;
}): React.JSX.Element {
  const wide = useMediaQuery(query);
  const [open, setOpen] = useState(() => wide && readOpen(storageKey));
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = `${name}-column-panel`;

  // 폭이 바뀌면 그 폭의 규칙으로 — 넓어지면 사람이 정해 둔 것, 좁아지면 닫힘(본문을 덮은 채 남지 않게)
  useEffect(() => {
    setOpen(wide && readOpen(storageKey));
  }, [wide, storageKey]);

  // 좁은 화면의 패널은 **어디론가 떠나면 닫힌다** — 다른 것을 골랐으면 그것을 읽을 차례다
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
    if (wide) writeOpen(storageKey, next);
  };
  const buttonLabel = open ? hideLabel : showLabel;
  const toggleButton = (
    <button
      ref={toggleRef}
      type="button"
      data-testid={`${name}-column-toggle`}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={buttonLabel}
      title={buttonLabel}
      onClick={toggle}
      className="flex size-6 shrink-0 items-center justify-center rounded-nerv-sm text-text-mute hover:bg-bg-active hover:text-text"
    >
      <PanelIcon open={open} />
    </button>
  );

  return (
    <div
      data-testid={`${name}-column`}
      data-open={open ? 'true' : 'false'}
      // 사이드바와 같은 규칙이다 — 페이지가 흘러도 열은 화면 높이로 제자리에 선다. `sticky` 는 제 쌓임 맥락을
      // 만들어 안쪽 패널의 z 가 그 안에 갇힌다 — 열 자신이 z 를 가져야 좁은 폭의 패널이 본문(제목의 sticky · z-20)을
      // 덮는다. 헤더·서랍의 뒷막(z-30)보다는 아래다: 서랍이 열린 동안 띠가 뒷막 위로 떠 눌리면 안 된다
      className="sticky top-header z-25 flex h-below-header shrink-0 self-start"
    >
      {/* **띠** — 열이 제자리에 없을 때(접었거나 좁은 폭) 여는 자리가 늘 같은 곳에 있다 */}
      {!(open && wide) && (
        <div className="flex w-8 shrink-0 flex-col items-center border-r border-border bg-bg-sunken/40 pt-3">
          {toggleButton}
        </div>
      )}
      <div
        id={panelId}
        data-testid={`${name}-column-panel`}
        role="region"
        aria-label={label}
        onClick={(e) => {
          // 좁은 폭에서 같은 것을 다시 눌러도 닫힌다 — 경로가 그대로면 위의 effect 는 걸리지 않는다
          if (!wide && (e.target as HTMLElement).closest('a') !== null) setOpen(false);
        }}
        className={cn(
          open ? 'flex' : 'hidden',
          'w-64 min-h-0 flex-col border-r border-border bg-bg px-2 py-3',
          wide ? 'h-full' : 'absolute top-0 bottom-0 left-8 shadow-popover',
        )}
      >
        {children(open && wide ? toggleButton : undefined)}
      </div>
    </div>
  );
}
