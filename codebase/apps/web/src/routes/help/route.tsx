// /help — 제품 매뉴얼 셸 (screens.md §2.10)
//
// 왼쪽은 **차례**다. 매뉴얼은 처음부터 읽는 문서가 아니라 필요할 때 한 장을 펴는 문서라,
// 어느 장이 있는지가 늘 보여야 한다 — 목차로 돌아가야 다음 장이 보이는 구조에서는
// 사람이 두 번째 장을 열지 않는다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { MANUAL_CHAPTERS } from '../../lib/manual.js';

export const Route = createFileRoute('/help')({ component: ManualShell });

const CHAPTER_LINK =
  'block rounded-[5px] px-2 py-[5px] text-base text-text-mute transition-colors hover:bg-bg-hover hover:text-text ' +
  'data-[status=active]:bg-bg-active data-[status=active]:font-medium data-[status=active]:text-text';

function ManualShell(): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex min-h-[calc(100vh-var(--spacing-header))]">
      {/* 차례는 사이드바와 같은 무게로 가라앉힌다 — 본문이 문서고 이쪽은 여백에 가깝다 */}
      <aside className="sticky top-header hidden h-[calc(100vh-var(--spacing-header))] w-sidebar shrink-0 overflow-y-auto border-r border-border bg-bg-sunken/40 px-2 py-3 md:block">
        <p className="px-2 pb-2 text-2xs font-semibold tracking-[0.07em] text-text-faint uppercase">
          {t('help.title')}
        </p>
        <nav className="flex flex-col gap-0.5">
          {MANUAL_CHAPTERS.map((chapter) => (
            <Link
              key={chapter.id}
              to="/help/$chapter"
              params={{ chapter: chapter.id }}
              className={CHAPTER_LINK}
            >
              {t(chapter.titleKey)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
