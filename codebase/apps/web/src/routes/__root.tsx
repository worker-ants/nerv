// 앱 셸 라우트 — screens.md §1.2·§1.3
import { createRootRoute, Outlet, useMatches } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell.js';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent(): React.JSX.Element {
  // 프로젝트 사이드바는 /p/:proj/* 에서만 렌더한다(§1.3).
  const matches = useMatches();
  const projectSlug = matches
    .map((m) => (m.params as { proj?: string }).proj)
    .find((slug): slug is string => slug !== undefined);

  return (
    <AppShell projectSlug={projectSlug}>
      <Outlet />
    </AppShell>
  );
}
