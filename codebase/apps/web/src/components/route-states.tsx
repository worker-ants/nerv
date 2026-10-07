// 라우터가 그리는 세 자리 — 없는 주소 · 그리다 멈춘 화면 · 화면 코드를 받는 중 (REQ-WEB-199 · 296 · screens.md §1.5)
//
// 2026-09-24 까지 둘 다 라이브러리 기본값이었다 — 없는 주소는 영문 `Not Found` 한 줄,
// 렌더 중 예외는 영문 오류 상자. 번역도, 다음 행동도 없는 막다른 길이었다(§1.5).

import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useT } from '../lib/i18n.js';
import { ErrorState, NotFoundState } from './query-state.js';
import { Skeleton } from './ui/primitives.js';

/**
 * 화면 코드를 받는 중 — 라우터의 `defaultPendingComponent`(2026-10-07 · REQ-WEB-296).
 *
 * 화면마다 코드를 나눠 받는데(`autoCodeSplitting`) 대기 화면이 없어서, 조각을 받는 동안 그 자리에는 아무것도
 * 그려지지 않았다. 대기 화면을 주면 라우터가 라우트마다 Suspense 경계를 두고(`Match` 의 `wrapInSuspense`) 그
 * 자리에 이 골격을 그린다 — 셸은 그대로 있다.
 */
export function RoutePending(): React.JSX.Element {
  return <Skeleton rows={4} className="p-6" />;
}

/** 없는 주소 — 셸 안에서 그린다(루트 라우트의 `notFoundComponent`) */
export function NotFoundPage(): React.JSX.Element {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <NotFoundState
      className="mx-auto max-w-xl px-6 py-10"
      title={t('state.not_found')}
      hint={t('state.not_found_path', { path })}
      action={
        <Link to="/" className="text-sm text-link">
          {t('state.go_home')}
        </Link>
      }
    />
  );
}

/** 그리다 멈춘 화면 — 그 라우트 자리에만 선다. [다시 시도]는 그 라우트를 다시 불러온다 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  return (
    <ErrorState
      className="mx-auto max-w-xl px-6 py-10"
      title={t('state.render_failed')}
      error={error}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}
