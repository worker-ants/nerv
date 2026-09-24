// 브라우저 탭 제목 — "화면 · 프로젝트 · 조직 — NERV" (2026-09-24 · REQ-WEB-194)
//
// 제목이 언제나 "NERV" 였다(`index.html` 고정). 탭을 여럿 열어 두는 사람에게는 어느 탭이 어느
// 조직·프로젝트의 무엇인지 가를 길이 없었다 — 조직·프로젝트 경계 점검에서 드러난 자리다.
// 판정은 경로로 하는 순수 함수다: 셸이 부르고, 검사가 그대로 부른다.
import type { Translator } from '@nerv/schema';

type ScreenKey =
  | 'shell.nav.overview'
  | 'shell.nav.specs'
  | 'shell.nav.tasks'
  | 'shell.nav.sessions'
  | 'shell.nav.review'
  | 'shell.home'
  | 'inbox.title'
  | 'notif.title'
  | 'settings.title'
  | 'help.title'
  | 'onboarding.title';

/** 경로 → 화면 이름 키. 모르는 경로는 null — 없는 이름을 지어내지 않는다 */
export function screenKeyFor(pathname: string): ScreenKey | null {
  const project = /^\/p\/[^/]+(?:\/([^/]+))?/.exec(pathname);
  if (project !== null) {
    switch (project[1]) {
      case undefined:
        return 'shell.nav.overview';
      case 'specs':
        return 'shell.nav.specs';
      case 'tasks':
        return 'shell.nav.tasks';
      case 'sessions':
        return 'shell.nav.sessions';
      case 'reviews':
        return 'shell.nav.review';
      default:
        return null;
    }
  }
  if (pathname === '/') return 'shell.home';
  if (pathname.startsWith('/inbox')) return 'inbox.title';
  if (pathname.startsWith('/notifications')) return 'notif.title';
  if (pathname.startsWith('/settings')) return 'settings.title';
  if (pathname.startsWith('/help')) return 'help.title';
  if (pathname.startsWith('/onboarding')) return 'onboarding.title';
  return null;
}

/**
 * 제목을 조립한다. **프로젝트는 프로젝트 화면에서만** 싣는다 — 조직 범위 화면에서 기억된
 * 프로젝트를 싣으면 헤더에서 걷어 낸 그 혼동이 탭에서 되살아난다(REQ-WEB-193).
 */
export function documentTitle(
  t: Translator,
  pathname: string,
  scope: { orgName: string | null; projectName: string | null },
): string {
  const key = screenKeyFor(pathname);
  const onProject = pathname.startsWith('/p/');
  const parts = [
    key === null ? null : t(key),
    onProject ? scope.projectName : null,
    scope.orgName,
  ].filter((p): p is string => p !== null && p !== '');
  return parts.length === 0 ? 'NERV' : `${parts.join(' · ')} — NERV`;
}
