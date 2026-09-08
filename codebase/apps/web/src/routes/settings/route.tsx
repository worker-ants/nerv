// /settings — S8 설정 셸(탭 내비게이션). 탭 4종: 조직·프로젝트 · 멤버 · 토큰 · 게이트 정책.
// git 연동 탭·리뷰 게이트 정책은 Phase 2 다(scope.md §4.1).
//
// **어느 탭에 있는지 화면이 말해야 한다.** 링크 세 개를 나란히 두고 활성 표시가 없으면
// 사람은 매번 주소창을 본다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { PageBody } from '../../components/ui/primitives.js';

export const Route = createFileRoute('/settings')({
  component: SettingsShell,
});

// 활성 표시를 `activeProps` 로 주면 `border-transparent` 와 `border-status-action` 이
// 같은 속성을 두고 붙는데, 이길지는 클래스 순서가 아니라 **생성된 CSS 순서**가 정한다.
// TanStack Router 가 붙여 주는 `data-status="active"` 를 variant 로 쓰면 그 다툼이 사라진다
// (variant 유틸리티는 항상 뒤에 나온다).
// **탭은 줄지도 접히지도 않는다**(2026-09-08 · REQ-WEB-151). 좁은 칸에서 탭 줄이 할 일은
// 뭉개지는 것이 아니라 미는 것이다 — 줄바꿈된 탭은 두 줄짜리 탭 하나가 되고, 그때 활성
// 밑줄은 어느 글자 아래에도 맞지 않는다. 줄 자신은 아래 `<nav>` 가 스크롤 상자로 받는다.
const TAB =
  'shrink-0 border-b-2 border-transparent px-1 pb-2 text-sm whitespace-nowrap text-text-mute ' +
  'transition-colors hover:text-text ' +
  'data-[status=active]:border-status-action data-[status=active]:font-medium data-[status=active]:text-text';

function SettingsShell(): React.JSX.Element {
  const t = useT();
  return (
    <PageBody>
      {/* 제목(h1)은 각 탭이 갖는다 — 여기서 "설정"을 h1 으로 쓰면 화면마다 h1 이 둘이 된다 */}
      <p className="mb-2 text-2xs font-semibold tracking-wide text-text-faint uppercase">
        {t('settings.title')}
      </p>
      {/* 넘치면 **줄 안에서** 민다 — 페이지를 옆으로 밀면 제목·본문까지 함께 간다
          (S3 곁레일에서 실제로 그랬다 · REQ-WEB-151) */}
      <nav
        data-testid="settings-tabs"
        className="mb-5 flex gap-4 overflow-x-auto border-b border-border"
      >
        {/* 조직·프로젝트가 먼저다 — 멤버·토큰·게이트는 그 안에서 정하는 것들이다 */}
        <Link to="/settings/workspace" className={TAB}>
          {t('settings.tab.workspace')}
        </Link>
        <Link to="/settings/members" className={TAB}>
          {t('settings.tab.members')}
        </Link>
        <Link to="/settings/tokens" className={TAB}>
          {t('settings.tab.tokens')}
        </Link>
        <Link to="/settings/gates" className={TAB}>
          {t('settings.tab.gates')}
        </Link>
      </nav>
      <Outlet />
    </PageBody>
  );
}
