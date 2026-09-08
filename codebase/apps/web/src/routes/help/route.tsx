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
    // **본문이 자기 상자 안에서 흐른다**(2026-09-08 — 사람 지시 · REQ-WEB-157). S3 와 같은
    // 규약이다(§2.4 · REQ-WEB-156): 스크롤 상자가 페이지면 차례 위에서 굴린 바퀴가
    // 본문을 움직이고(차례가 더 흘릴 것이 없으면 스크롤은 페이지로 넘어간다), 그때 두 칸은
    // 나란히 놓인 두 칸이 아니다. 화면 높이를 확정하고 차례·본문이 각자 자기 안에서 흐른다.
    // 묶는 것은 **차례가 있는 폭(`md`)부터**다 — 차례가 접힌 좁은 화면에는 나란히 놓인
    // 것이 없으니 가둘 이유도 없고, 페이지가 흐르는 편이 그 폭의 손에 맞는다.
    // 높이는 `dvh` 로 잰다: 모바일 브라우저의 주소창이 접히면 `vh` 는 실제 화면보다 크다.
    <div
      className="flex min-h-[calc(100dvh-var(--spacing-header))]
        md:h-[calc(100dvh-var(--spacing-header))] md:overflow-hidden"
    >
      {/* 차례는 사이드바와 같은 무게로 가라앉힌다 — 본문이 문서고 이쪽은 여백에 가깝다.
          높이는 상자가 준다(`h-full`) — `sticky` 로 뷰포트에 손수 묶던 계산식은 페이지가
          흐르지 않게 된 뒤로 할 일이 없다(같은 값을 두 곳에 적으면 갈린다). */}
      <aside className="hidden w-sidebar shrink-0 overflow-y-auto border-r border-border bg-bg-sunken/40 px-2 py-3 md:block md:h-full">
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
      {/* 흐르는 것은 이 칸이다 — 차례는 제자리에 선다 */}
      <div data-testid="manual-content" className="min-w-0 flex-1 md:h-full md:overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
