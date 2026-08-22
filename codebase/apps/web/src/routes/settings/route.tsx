// /settings — S8 설정 셸(탭 내비게이션). MVP 탭 3종: 멤버·토큰·게이트 정책.
// git 연동 탭·리뷰 게이트 정책은 Phase 2 다(scope.md §4.1).
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({
  component: SettingsShell,
});

function SettingsShell(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-3 border-b border-border pb-2 text-sm">
        <Link to="/settings/members" className="hover:text-status-action">
          멤버·역할
        </Link>
        <Link to="/settings/tokens" className="hover:text-status-action">
          에이전트 토큰
        </Link>
        <Link to="/settings/gates" className="hover:text-status-action">
          게이트 정책
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
