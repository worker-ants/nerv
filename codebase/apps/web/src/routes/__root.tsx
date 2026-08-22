// 앱 셸 라우트 — screens.md §1.2·§1.3
//
// 보호 경로 가드가 여기 있다(REQ-WEB-001): 인증되지 않은 요청은 `/login` 으로 보내되
// **원래 경로를 보존**한다 — 로그인 후 하려던 일로 돌아가지 못하면 링크 공유가 무의미해진다.

import {
  createRootRoute,
  Outlet,
  useMatches,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppShell } from '../components/app-shell.js';
import { NervApiError } from '../lib/api.js';
import { useMe } from '../lib/queries.js';

export const Route = createRootRoute({ component: RootComponent });

/** 셸을 두르지 않는 경로 — 로그인 전에는 헤더·사이드바가 의미를 갖지 않는다. */
const BARE_ROUTES = new Set(['/login']);

function RootComponent(): React.JSX.Element {
  const matches = useMatches();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const me = useMe();

  const projectSlug = matches
    .map((m) => (m.params as { proj?: string }).proj)
    .find((slug): slug is string => slug !== undefined);

  const unauthenticated = me.isError && me.error instanceof NervApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated && !BARE_ROUTES.has(pathname)) {
      void navigate({ to: '/login', search: { redirect: pathname } });
    }
  }, [navigate, pathname, unauthenticated]);

  if (BARE_ROUTES.has(pathname)) return <Outlet />;

  return (
    <AppShell projectSlug={projectSlug}>
      <Outlet />
    </AppShell>
  );
}
