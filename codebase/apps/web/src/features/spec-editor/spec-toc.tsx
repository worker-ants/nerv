// 목차 — 긴 문서의 절 사이를 오간다 (screens.md §2.4 · REQ-WEB-215)
//
// 50,685px 짜리 문서(clemvion `data-model`)를 읽는 사람에게 절을 오갈 수단이 스크롤바뿐이었다
// (2026-09-24 UI/UX 검토 SPEC-05). 머리의 메타 줄에 접어 둔다 — 늘 펼쳐 두면 본문 폭을 먹고,
// 2열 화면에서 본문 칸은 이미 26rem 바닥에 가깝다. `##`·`###` 만 싣는다: `#` 는 대개 문서 제목이다.

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';
import { Popover } from '../../components/ui/primitives.js';
import type { MdHeading } from '../../lib/spec-anchors.js';

export function SpecToc({
  headings,
  onPick,
}: {
  headings: readonly MdHeading[];
  onPick: (slug: string) => void;
}): React.JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const items = headings.filter((h) => h.level === 2 || h.level === 3);

  // 밖을 누르거나 Esc 면 닫는다 — 헤더의 메뉴들과 같은 규칙이다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 절이 둘도 안 되는 문서에 목차는 자리만 먹는다
  if (items.length < 2) return null;
  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        data-testid="spec-toc"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-nerv-sm px-2 py-0.5 text-sm text-text-mute hover:bg-bg-hover hover:text-text"
      >
        {t('spec.toc')} ▾
      </button>
      {open && (
        <Popover className="max-h-[60vh] w-72 overflow-y-auto py-1" align="right">
          <ul data-testid="spec-toc-list">
            {items.map((h, i) => (
              <li key={`${h.slug}-${String(i)}`}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPick(h.slug);
                  }}
                  className={cn(
                    'block w-full truncate px-3 py-1 text-left text-sm hover:bg-bg-hover',
                    h.level === 3 ? 'pl-6 text-text-mute' : 'text-text',
                  )}
                >
                  {h.text.replace(/[`*]/g, '')}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  );
}
