// 앱 셸 — 정본: screens.md §1.3
//
//   전역 헤더(조직 소속 · 받은 요청/알림 배지 · ⌘K · 사용자 메뉴)
//   연결 상태 배너(2단계 — WS 끊김 / 플랫폼 끊김)
//   프로젝트 사이드바(/p/:proj/* 에서만 — 탭 + 스펙 트리)
//   라우트 아웃렛 · 토스트 스택
//
// **받은 요청 배지는 내 결정을 기다리는 것만 센다**(spec-workflow §6.6 원칙 3). 배경 활동까지
// 세면 배지는 곧 무시되고, 무시되는 배지는 없는 배지다.
//
// 헤더와 사이드바는 **고정**이다(sticky). 스펙 트리가 수백 줄이어도 조직 전환·받은 요청은
// 늘 같은 자리에 있어야 한다 — 위로 스크롤해서 찾아야 하는 내비게이션은 내비게이션이 아니다.
//
// **좁은 화면에서는 그 사이드바가 서랍이 된다**(2026-09-21 · REQ-WEB-164). 휴대폰 폭에서
// 헤더의 아홉 자리는 줄어들 줄을 몰라 서로 겹쳐 읽을 수 없었고, 사이드바는 `md` 미만에서
// 아예 그려지지 않아 **스펙·작업·세션·리뷰로 갈 길이 화면에서 통째로 사라져 있었다** —
// 없는 길은 좁은 길보다 나쁘다. 처방은 §2.6a 가 이미 쓴 것과 같다(REQ-WEB-161): **두 벌을
// 그리지 않고 하나를 옮긴다.** 같은 `<aside>` 가 넓은 화면에서는 고정 사이드바로, 좁은
// 화면에서는 헤더 [☰] 가 여는 서랍으로 선다 — 트리의 펼침 상태가 두 벌로 갈리지 않는다.

import { LOCALE_LABEL, LOCALES, useLocale, useT } from '../lib/i18n.js';
import { THEMES, useTheme } from '../lib/theme.js';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { connectionBanner, useRealtime } from '../lib/realtime.js';
import { signOut } from '../lib/session.js';
import { inboxTotal, useInbox, useMe, useUnreadCount, useProject } from '../lib/queries.js';
import { cn } from '../lib/utils.js';
import { chapterForRoute } from '../lib/manual.js';
import { useScope } from '../lib/scope.js';
import { QuickSwitcher } from './quick-switcher.js';
import { SpecTree } from './spec-tree.js';
import { MenuItem, Popover } from './ui/primitives.js';
import { asProjectId } from '../lib/query-keys.js';
import { useMediaQuery } from '../lib/use-media-query.js';

/**
 * 사이드바가 서는 폭 — Tailwind `md`(48rem)와 **같은 값 하나**다. 서랍의 `md:` 클래스와
 * 이 질의가 갈리면 둘 다 선 폭이나 둘 다 없는 폭이 생긴다(REQ-WEB-161 이 짚은 그 함정).
 */
const SIDEBAR_QUERY = '(min-width: 48rem)';

export interface AppShellProps {
  children: React.ReactNode;
  projectSlug?: string | undefined;
  /** 지금 보는 스펙 — 사이드바 트리가 그 자리를 펼치고 표시한다 */
  activeSpecKey?: string | undefined;
}

/** 헤더 링크 — 눌리는 영역이 글자보다 커야 손이 빗나가지 않는다 */
const HEADER_LINK =
  'rounded-nerv-sm px-2 py-1 text-sm text-text-mute transition-colors hover:bg-bg-hover hover:text-text';

/** 사이드바 항목 — 활성 표시는 배경 + 굵기다. 색만으로 구분하지 않는다(REQ-WEB-033) */
// 시안의 nav 는 29px 줄에 13.5px 글자다 — 손가락이 아니라 눈으로 고르는 목록이라
// 빽빽해도 되고, 빽빽해야 트리와 한 덩어리로 읽힌다(시안 대조 2026-08-23).
const NAV_ITEM =
  'group flex h-[29px] items-center gap-2 rounded-[5px] px-2 text-base text-text-mute transition-colors hover:bg-bg-hover hover:text-text';
const NAV_ACTIVE = 'bg-bg-active font-medium text-text';
/** 글리프 칸 — 시안은 15px 고정 폭에 흐린 색, **활성일 때만 강조색**이다 */
const NAV_GLYPH =
  'inline-flex w-[15px] shrink-0 text-text-faint group-[.bg-bg-active]:text-status-action';

/** 사이드바·서랍의 구역 이름 — 트리 머리와 같은 크기여야 한 덩어리로 읽힌다 */
const RAIL_LABEL = 'text-2xs font-semibold tracking-[0.07em] text-text-faint uppercase';

/** 좁은 화면에서 글자 대신 서는 한 칸짜리 단추 */
const ICON_BUTTON = 'max-md:size-[27px] max-md:justify-center max-md:px-0';

/** [☰] 가 여는 것이 무엇인지 `aria-controls` 가 가리킨다 — 서랍은 화면에 하나뿐이다 */
const NAV_ID = 'nerv-nav';

/**
 * 헤더의 글리프 — **이모지가 아니라 흐린 선화다**(검색 아이콘과 같은 규약). 이모지는 제
 * 색을 갖고 와 헤더에서 저 혼자 튄다.
 */
function Glyph({ d, size = 15 }: { d: readonly string[]; size?: number }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

const GLYPH_MENU = ['M4 6h16', 'M4 12h16', 'M4 18h16'];
const GLYPH_INBOX = [
  'M22 12h-6l-2 3h-4l-2-3H2',
  'M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z',
];
const GLYPH_BELL = ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.9 1.9 0 0 0 3.4 0'];

function CountBadge({
  count,
  tone,
  testId,
  className,
}: {
  count: number;
  tone: 'action' | 'waiting' | 'agent' | 'danger';
  testId?: string;
  className?: string;
}): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <span
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      className={cn(
        // **차오른 색이 아니라 물든 색이다**(시안). 진한 배경 + 흰 글자는 화면에서 가장
        // 시끄러운 물건이 되는데, 배지는 어디에나 있다 — 소프트 배경 + 같은 계열 글자면
        // 숫자는 읽히되 화면이 배지로 뒤덮이지 않는다.
        'ml-1 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-[5px] text-2xs font-semibold',
        tone === 'action'
          ? 'bg-status-action-soft text-status-action'
          : tone === 'agent'
            ? 'bg-status-agent-soft text-status-agent'
            : tone === 'danger'
              ? 'bg-status-danger-soft text-status-danger'
              : 'bg-status-waiting-soft text-status-waiting',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function AppShell({
  children,
  projectSlug,
  activeSpecKey,
}: AppShellProps): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  // 활성 세션 수는 프로젝트 조회가 함께 준다(EP-PRJ-03) — 세션 목록을 또 부르지 않는다
  const shellProject = useProject(projectSlug ?? '');
  const activeSessions = Number(shellProject.data?.['active_sessions'] ?? 0);
  const openCritical = Number(shellProject.data?.['open_critical_findings'] ?? 0);
  const { state, offline, toasts, dismissToast } = useRealtime();
  const me = useMe();
  const inbox = useInbox();
  const unread = useUnreadCount();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<'org' | 'project' | 'user' | 'help' | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarStands = useMediaQuery(SIDEBAR_QUERY);

  // ── 소속 두 축 ─────────────────────────────────────────────────────────
  //
  // **프로젝트도 고를 수 있어야 한다**(사람 지시 2026-08-24). 이전에는 사이드바가
  // 현재 프로젝트의 **이름만** 적어 두어, 프로젝트가 둘 이상이면 옮겨 갈 길이 화면에
  // 없었다(퀵 스위처를 아는 사람만 ⌘K 로 갔다).
  //
  // 어느 조직·프로젝트인가를 정하는 규칙은 `lib/scope.ts` 한 곳에 있다 — 화면마다 다시
  // 쓰면 그때마다 조금씩 다르게 틀린다(설정 탭들이 실제로 그렇게 틀렸다).
  const orgs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of me.data?.memberships ?? []) seen.set(m.org_slug, m.org_name);
    return [...seen].map(([slug, name]) => ({ slug, name }));
  }, [me.data]);
  const scope = useScope(projectSlug);
  const currentOrg = scope.orgSlug === null ? null : { slug: scope.orgSlug, name: scope.orgName };
  const projectRows = scope.projects;
  const currentProjectSlug = scope.projectSlug;
  const currentProject = scope.project;
  /** 라우트가 프로젝트를 아는가 — 아니면 조직 범위 화면이고, 프로젝트는 빌려 보이지 않는다 */
  const onProjectRoute = projectSlug !== undefined;

  // ⌘K / Ctrl+K — 전 라우트 공통(REQ-WEB-040)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSwitcherOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 바깥을 누르면 닫는다 — 드롭다운이 열린 채로 남으면 다음 클릭이 먹히지 않는다.
  //
  // **어느 메뉴가 열렸든 그 메뉴의 뿌리를 표식으로 찾는다**(`data-menu-root`). 예전에는
  // 사용자 메뉴의 ref 하나로 판정해서, 조직·프로젝트 드롭다운 **안**을 눌러도 "바깥"으로
  // 읽혔다 — mousedown 에서 팝오버가 사라지면 뒤이은 click 은 이미 없는 요소로 가므로
  // 그 항목은 눌러도 아무 일이 없었다.
  useEffect(() => {
    if (menuOpen === null) return;
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target === null || target.closest('[data-menu-root]') === null) setMenuOpen(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  // 도움말의 "이 화면" 항목 — 짚어 줄 장이 없으면 그 항목을 아예 안 보인다(manual.ts)
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const contextChapter = chapterForRoute(pathname);

  // ── 좁은 화면의 서랍 ────────────────────────────────────────────────────
  //
  // 닫히는 길이 셋이다 — **어디론가 떠났을 때**(경로가 바뀐다) · `Esc` · 뒷막. 서랍이
  // 열린 채로 남으면 그 아래의 화면은 손이 닿지 않는데, 사람은 자기가 무엇을 눌렀는지로
  // 그것을 설명하지 못한다.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // 넓어지면 닫는다 — 서랍은 좁은 화면의 것이고, 열린 채로 `md` 를 넘으면 제자리에 선
  // 사이드바 위에 같은 것이 한 벌 더 겹친다.
  useEffect(() => {
    if (sidebarStands) setDrawerOpen(false);
  }, [sidebarStands]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const banner = connectionBanner(t, state, offline);
  // **쪽 길이가 아니라 전체 수다**(2026-09-24 · REQ-API-166). 목록이 커서로 나뉜 뒤로
  // 첫 쪽 길이를 세면 배지가 30 에서 멈춘다 — 배지와 목록이 어긋나면 지울 수 없는
  // 숫자가 남는다(알림 배지에서 이미 겪은 자리 · REQ-WEB-035).
  const pending = inboxTotal(inbox.data);
  /**
   * **배지는 결정이 필요한 것만 센다**(2026-09-07 · REQ-WEB-149 · FR-12). 전체 unread 를
   * 세던 동안 실측 767건 중 99건만 결정이고, 나머지는 배경 활동이었다 — 배지가 그것을
   * 함께 세면 "내가 막고 있는 것" 이 아니라 "무슨 일이 있었나" 가 된다.
   */
  const unreadCount = unread.data?.immediate ?? 0;

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-30 flex h-header items-center justify-between gap-4 border-b border-border bg-bg px-2 max-md:gap-1 md:px-3">
        <nav className="flex min-w-0 items-center gap-1">
          {/* 좁은 화면의 내비게이션은 **서랍**이다(REQ-WEB-164). 헤더에 탭 다섯과 트리를
              둘 폭은 없고, 그렇다고 없애면 갈 길이 사라진다 — 접는 것이지 지우는 것이 아니다. */}
          <button
            type="button"
            data-testid="nav-drawer-toggle"
            aria-label={t('shell.menu')}
            aria-expanded={drawerOpen}
            aria-controls={NAV_ID}
            onClick={() => setDrawerOpen((open) => !open)}
            className={cn(HEADER_LINK, 'flex shrink-0 items-center', ICON_BUTTON, 'md:hidden')}
          >
            <Glyph d={GLYPH_MENU} />
          </button>
          {/* 시안의 로고는 글리프가 아니라 **채운 사각형**이다 — 글리프는 주변 글자와
              같은 무게라 화면에 정박점이 되지 못한다(시안 대조 2026-08-23) */}
          <Link
            to="/"
            title={t('shell.home')}
            className="mr-1 flex shrink-0 items-center gap-[7px] px-1 text-sm font-semibold tracking-[-0.01em] max-md:mr-0"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-[15px] items-center justify-center rounded-[4px] bg-status-action text-[9px] font-bold text-white"
            >
              N
            </span>
            <span className="max-md:hidden">NERV</span>
          </Link>
          {currentOrg !== null && (
            <div className="relative" data-menu-root>
              <button
                type="button"
                data-testid="org-switcher"
                // **무엇을 고르는 칸인지 이름표를 단다**(2026-09-24 · REQ-WEB-193). 두 선택기가 같은
                // 모양이라 이름만 보고는 어느 쪽이 조직인지 알 수 없었다
                aria-label={t('shell.org_label', { name: currentOrg.name ?? currentOrg.slug })}
                onClick={() => setMenuOpen((open) => (open === 'org' ? null : 'org'))}
                className={cn(HEADER_LINK, 'flex max-w-44 items-center gap-1 max-md:hidden')}
              >
                <span aria-hidden="true" className="text-2xs text-text-faint max-lg:hidden">
                  {t('common.org')}
                </span>
                <span className="truncate">{currentOrg.name}</span>
                <span aria-hidden="true" className="text-text-faint">
                  ▾
                </span>
              </button>
              {menuOpen === 'org' && (
                <Popover>
                  {orgs.map((org) => (
                    <Link
                      key={org.slug}
                      to="/o/$org"
                      params={{ org: org.slug }}
                      onClick={() => setMenuOpen(null)}
                      className="block px-3 py-1.5 text-sm hover:bg-bg-hover"
                    >
                      {org.name}
                    </Link>
                  ))}
                  {orgs.length === 1 && (
                    <p className="px-3 py-1.5 text-xs text-text-faint">{t('shell.no_other_org')}</p>
                  )}
                  {/* **고르는 자리에서 만들 수도 있어야 한다.** 설정 어딘가로 찾아가게
                      하면 "새로 만들기"는 아는 사람만 쓰는 기능이 된다 */}
                  <Link
                    to="/settings/workspace"
                    onClick={() => setMenuOpen(null)}
                    className="mt-1 block border-t border-border px-3 pt-2 pb-1.5 text-sm text-text-mute hover:bg-bg-hover hover:text-text"
                  >
                    {t('shell.manage_workspace')}
                  </Link>
                </Popover>
              )}
            </div>
          )}

          {/* 프로젝트 select — 조직 오른쪽. **조직 → 프로젝트**가 권한의 순서이고
              헤더가 그 순서를 그대로 보인다. 하나뿐일 때도 select 로 둔다: 예외 케이스가
              없는 쪽이 직관적이라는 것이 사람 판단이다(2026-08-24). */}
          {currentOrg !== null && (
            <span aria-hidden="true" className="text-text-faint max-md:hidden">
              /
            </span>
          )}
          {currentOrg !== null && (
            <div className="relative" data-menu-root>
              <button
                type="button"
                data-testid="project-switcher"
                data-borrowed={onProjectRoute ? undefined : 'true'}
                aria-label={
                  onProjectRoute && currentProject !== undefined
                    ? t('shell.project_label', { name: String(currentProject['name']) })
                    : t('shell.project_none_label')
                }
                disabled={projectRows.length === 0}
                onClick={() => setMenuOpen((open) => (open === 'project' ? null : 'project'))}
                className={cn(
                  HEADER_LINK,
                  'flex max-w-44 items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60',
                  // 좁은 화면에서는 조직이 서랍으로 내려가고 이 칸만 남는다 — 폭도 함께 줄인다
                  'max-md:max-w-28',
                )}
              >
                {/* 비어 있을 때는 이름표를 빼다 — "프로젝트 프로젝트 선택" 으로 같은 낱말이 두 번 읽혔다 */}
                {onProjectRoute && (
                  <span aria-hidden="true" className="text-2xs text-text-faint max-lg:hidden">
                    {t('common.project')}
                  </span>
                )}
                {/* **조직 범위 화면에서는 프로젝트를 빌려 보이지 않는다**(2026-09-24 사람 결정 ·
                    REQ-WEB-193). 홈·받은 요청·알림·설정에서 마지막으로 본 프로젝트가 떠 있으면 그
                    화면 전체가 그 프로젝트의 것처럼 읽혔다 — 받은 요청은 실제로 모든 조직에 걸친다.
                    돌아가는 길은 드롭다운 맨 위의 "최근" 이 한 번으로 남긴다 */}
                <span className={cn('truncate', !onProjectRoute && 'text-text-faint')}>
                  {currentProject === undefined
                    ? t('shell.no_project')
                    : onProjectRoute
                      ? String(currentProject['name'])
                      : t('shell.pick_project')}
                </span>
                <span aria-hidden="true" className="text-text-faint">
                  ▾
                </span>
              </button>
              {menuOpen === 'project' && (
                <Popover>
                  {!onProjectRoute && currentProject !== undefined && (
                    <Link
                      to="/p/$proj"
                      params={{ proj: String(currentProject['slug']) }}
                      data-testid="project-recent"
                      onClick={() => setMenuOpen(null)}
                      className="mb-1 flex items-center gap-2 border-b border-border px-3 pt-1.5 pb-2 text-sm hover:bg-bg-hover"
                    >
                      <span className="text-2xs text-text-faint">{t('shell.recent')}</span>
                      <span className="truncate font-medium">{String(currentProject['name'])}</span>
                    </Link>
                  )}
                  {projectRows.map((project) => (
                    <Link
                      key={String(project['id'])}
                      to="/p/$proj"
                      params={{ proj: String(project['slug']) }}
                      onClick={() => setMenuOpen(null)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg-hover',
                        onProjectRoute && project['slug'] === currentProjectSlug && 'font-medium',
                      )}
                    >
                      {/* 고른 것에 표식을 준다 — 이름만 늘어놓으면 지금 어디인지 다시 읽어야 한다.
                          조직 범위 화면에서는 고른 것이 없다 — 기억은 "최근" 이지 선택이 아니다 */}
                      <span aria-hidden="true" className="w-3 text-text-faint">
                        {onProjectRoute && project['slug'] === currentProjectSlug ? '✓' : ''}
                      </span>
                      <span className="truncate">{String(project['name'])}</span>
                    </Link>
                  ))}
                  {projectRows.length === 1 && (
                    <p className="px-3 py-1.5 text-xs text-text-faint">
                      {t('shell.no_other_project')}
                    </p>
                  )}
                  <Link
                    to="/settings/workspace"
                    data-testid="project-new-link"
                    onClick={() => setMenuOpen(null)}
                    className="mt-1 block border-t border-border px-3 pt-2 pb-1.5 text-sm text-text-mute hover:bg-bg-hover hover:text-text"
                  >
                    {t('shell.new_project')}
                  </Link>
                </Popover>
              )}
            </div>
          )}
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border max-md:hidden" />
          {/* **홈 링크는 두지 않는다**(2026-08-30 — 사람 지시). 로고가 이미 `/` 로 가는데
              같은 자리로 가는 길을 둘 두면, 헤더에서 가장 비싼 왼쪽 끝을 같은 목적지가
              두 번 차지한다. 로고를 누르면 홈이라는 것은 웹의 기본 약속이다. */}
          {/* 프로젝트 select 오른쪽에 **그 프로젝트로 가는 길**(사람 지시 2026-08-24).
              골라도 갈 데가 없으면 select 는 표시일 뿐이다 — 고른 프로젝트의 개요로 간다.
              프로젝트가 없으면 자리도 없다(빈 링크를 두지 않는다). */}
          {currentProjectSlug !== null && (
            <Link
              to="/p/$proj"
              params={{ proj: currentProjectSlug }}
              className={cn(HEADER_LINK, 'max-md:hidden')}
              activeProps={{ className: 'bg-bg-active text-text' }}
              /* **정확히 개요일 때만 활성이다.** 접두 일치로 두면 작업·세션 화면에서도
                 헤더가 켜져, 사이드바의 활성 항목과 활성 표시가 둘이 된다 — 그때 사람은
                 "지금 어디인가"를 두 곳에서 읽고 어느 쪽이 답인지 고민하게 된다. */
              activeOptions={{ exact: true }}
            >
              {t('shell.nav.project')}
            </Link>
          )}
          {/* **숫자는 좁은 화면에서도 헤더에 남는다**(REQ-WEB-164). 서랍으로 내리면 열어
              봐야 아는 숫자가 되는데, 배지의 전부는 열기 전에 보인다는 것이다 — 글자만
              접고 글리프의 어깨에 그대로 붙인다(`aria-label` 이 이름을 대신 든다). */}
          {/* 배지는 **모든 조직**을 센다(2026-09-24 사람 결정 · REQ-WEB-193) — 조직 선택기 바로 옆에
              있어 지금 조직의 수로 읽히므로, 이름이 그 사실을 말한다 */}
          <Link
            to="/inbox"
            aria-label={t('shell.inbox_all_orgs')}
            title={t('shell.inbox_all_orgs')}
            className={cn(HEADER_LINK, 'relative flex shrink-0 items-center', ICON_BUTTON)}
            activeProps={{ className: 'bg-bg-active text-text' }}
          >
            <span aria-hidden="true" className="md:hidden">
              <Glyph d={GLYPH_INBOX} />
            </span>
            <span className="max-md:hidden">{t('shell.inbox')}</span>
            <CountBadge
              count={pending}
              tone="action"
              testId="inbox-badge"
              className="max-md:absolute max-md:-top-0.5 max-md:-right-1 max-md:ml-0 max-md:h-[15px] max-md:min-w-[15px] max-md:px-[4px] max-md:text-[9px]"
            />
          </Link>
          <Link
            to="/notifications"
            aria-label={t('shell.notifications_all_orgs')}
            title={t('shell.notifications_all_orgs')}
            className={cn(HEADER_LINK, 'relative flex shrink-0 items-center', ICON_BUTTON)}
            activeProps={{ className: 'bg-bg-active text-text' }}
          >
            <span aria-hidden="true" className="md:hidden">
              <Glyph d={GLYPH_BELL} />
            </span>
            <span className="max-md:hidden">{t('shell.notifications')}</span>
            <CountBadge
              count={unreadCount}
              tone="waiting"
              testId="notification-badge"
              className="max-md:absolute max-md:-top-0.5 max-md:-right-1 max-md:ml-0 max-md:h-[15px] max-md:min-w-[15px] max-md:px-[4px] max-md:text-[9px]"
            />
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2 max-md:gap-0.5">
          {/* 검색은 버튼이지만 **입력창처럼 보인다** — 여기에 타이핑하면 된다는 것이
              모양으로 읽혀야 ⌘K 를 모르는 사람도 찾는다 */}
          <button
            type="button"
            onClick={() => setSwitcherOpen(true)}
            aria-label={t('common.search')}
            className={cn(
              'flex h-[27px] w-52 items-center gap-[7px] rounded-nerv bg-bg-sunken px-[9px] text-sm text-text-faint transition-colors hover:bg-bg-hover',
              // 좁은 화면에는 ⌘K 도 없고 입력창 모양을 지킬 폭도 없다 — 글리프 한 칸이다
              'max-md:w-[27px] max-md:justify-center max-md:bg-transparent max-md:px-0',
            )}
          >
            {/* 이모지 돋보기는 색을 갖고 와 헤더에서 저 혼자 튄다 — 시안은 흐린 선화다 */}
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span className="flex-1 text-left max-md:hidden">{t('common.search')}</span>
            <kbd className="text-[10px] text-text-ghost max-md:hidden">⌘K</kbd>
          </button>
          {/* 도움말 — **글자가 아니라 한 칸짜리 글리프다**(2026-08-24 신설). 와이어프레임의
              헤더는 여섯 자리뿐이고(§2.1) 자주 쓰지 않는 항목이 자주 쓰는 항목의 자리를
              먹으면 헤더는 금세 도구모음이 된다. `?` 는 그 규율을 지키면서도 사람들이
              도움을 찾을 때 실제로 먼저 보는 자리다 — 이름은 title·aria-label 이 준다. */}
          <div className="relative" data-menu-root>
            <button
              type="button"
              data-testid="help-menu"
              aria-label={t('shell.help')}
              title={t('shell.help')}
              onClick={() => setMenuOpen((open) => (open === 'help' ? null : 'help'))}
              className={cn(
                HEADER_LINK,
                'flex size-[27px] items-center justify-center px-0 text-text-faint max-md:hidden',
              )}
            >
              <span aria-hidden="true">?</span>
            </button>
            {menuOpen === 'help' && (
              <Popover align="right">
                {/* 지금 화면을 설명하는 장이 먼저다 — 도움말을 여는 사람은 대개 지금
                    보고 있는 것 때문에 연다 */}
                {contextChapter !== null && (
                  <Link
                    to="/help/$chapter"
                    params={{ chapter: contextChapter }}
                    data-testid="help-this-screen"
                    onClick={() => setMenuOpen(null)}
                    className="block px-3 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    {t('help.this_screen')}
                  </Link>
                )}
                <Link
                  to="/help"
                  data-testid="help-manual"
                  onClick={() => setMenuOpen(null)}
                  className="block px-3 py-1.5 text-sm hover:bg-bg-hover"
                >
                  {t('help.title')}
                </Link>
                <Link
                  to="/help/$chapter"
                  params={{ chapter: 'shortcuts' }}
                  onClick={() => setMenuOpen(null)}
                  className="block px-3 py-1.5 text-sm hover:bg-bg-hover"
                >
                  {t('help.ch.shortcuts')}
                </Link>
              </Popover>
            )}
          </div>
          {/* 설정은 사용자 메뉴 안에 있다 — 와이어프레임 헤더(§2.1)는
              `⬢ NERV 홈 받은 요청 알림 🔍검색 [지민 ▾]` 여섯 자리뿐이고, 자주 쓰지 않는 항목이
              자주 쓰는 항목의 자리를 먹으면 헤더는 금세 도구모음이 된다. */}
          {me.data !== undefined && (
            <div className="relative" data-menu-root>
              <button
                type="button"
                data-testid="user-menu"
                // 좁은 화면에서는 이름이 접히고 머리글자만 남는다 — 이름은 여기가 든다
                aria-label={me.data.display_name ?? '?'}
                onClick={() => setMenuOpen((open) => (open === 'user' ? null : 'user'))}
                className={cn(HEADER_LINK, 'flex shrink-0 items-center gap-1.5 max-md:px-1')}
              >
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-status-action-soft text-2xs font-semibold text-status-action"
                >
                  {(me.data.display_name ?? '?').slice(0, 1)}
                </span>
                <span className="max-md:hidden">{me.data.display_name}</span>
                <span aria-hidden="true" className="text-text-faint max-md:hidden">
                  ▾
                </span>
              </button>
              {menuOpen === 'user' && (
                <Popover align="right">
                  <p className="border-b border-border px-3 pb-1.5 text-xs text-text-faint">
                    {me.data.email}
                  </p>
                  <Link
                    to="/settings"
                    onClick={() => setMenuOpen(null)}
                    className="mt-1 block px-3 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    {t('shell.settings')}
                  </Link>
                  {/* 언어 전환은 사용자 메뉴에 둔다 — 자주 바꾸는 것이 아니고, 계정에 붙은
                      설정이라 사용자 이름 아래가 사람들이 먼저 찾아보는 자리다 */}
                  <div className="mt-1 border-t border-border px-3 pt-1.5 pb-1">
                    <p className="mb-1 text-2xs text-text-faint">{t('shell.language')}</p>
                    <div className="flex gap-1">
                      {LOCALES.map((code) => (
                        <button
                          key={code}
                          type="button"
                          data-testid={`locale-${code}`}
                          aria-pressed={locale === code}
                          onClick={() => setLocale(code)}
                          className={cn(
                            'rounded-nerv-sm px-2 py-0.5 text-xs',
                            locale === code
                              ? 'bg-bg-active font-medium'
                              : 'text-text-mute hover:bg-bg-hover',
                          )}
                        >
                          {/* 언어 이름은 그 언어로 적는다 — 읽을 수 없는 말로 적힌 선택지는 고를 수 없다 */}
                          {LOCALE_LABEL[code]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 테마는 언어 바로 아래다 — 둘 다 "이 화면을 어떻게 볼 것인가"이고,
                      같은 자리에 같은 모양으로 있어야 한 번 찾은 사람이 다시 찾는다.
                      다만 성질은 다르다: 언어는 계정에 붙고 **테마는 기계에 붙는다**
                      (같은 사람이 낮의 노트북과 밤의 데스크톱을 다르게 쓴다). */}
                  <div className="border-t border-border px-3 pt-1.5 pb-1">
                    <p className="mb-1 text-2xs text-text-faint">{t('shell.theme')}</p>
                    <div className="flex gap-1">
                      {THEMES.map((name) => (
                        <button
                          key={name}
                          type="button"
                          data-testid={`theme-${name}`}
                          aria-pressed={theme === name}
                          onClick={() => setTheme(name)}
                          className={cn(
                            'rounded-nerv-sm px-2 py-0.5 text-xs',
                            theme === name
                              ? 'bg-bg-active font-medium'
                              : 'text-text-mute hover:bg-bg-hover',
                          )}
                        >
                          {t(`theme.${name}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(null);
                      void signOut().then(() => navigate({ to: '/login' }));
                    }}
                  >
                    {t('shell.sign_out')}
                  </MenuItem>
                </Popover>
              )}
            </div>
          )}
        </div>
      </header>

      {banner !== null && (
        <div
          role="status"
          aria-live="polite"
          data-testid="connection-banner"
          data-level={offline ? 'offline' : 'ws'}
          className="flex items-center gap-2 border-b border-border bg-status-waiting-soft px-4 py-1.5 text-xs text-status-waiting"
        >
          <span aria-hidden="true">●</span>
          {banner}
        </div>
      )}

      {/* 뒷막 — 서랍 밖을 누르면 닫힌다. 헤더는 덮지 않는다: [☰] 는 연 자리에서 닫을 수
          있어야 하고, 배지도 서랍이 열린 동안 계속 보여야 한다. */}
      {drawerOpen && (
        <button
          type="button"
          data-testid="nav-drawer-backdrop"
          aria-label={t('shell.close_menu')}
          onClick={() => setDrawerOpen(false)}
          className="fixed top-header right-0 bottom-0 left-0 z-30 bg-text/20 backdrop-blur-[2px] md:hidden"
        />
      )}

      <div className="flex">
        {/* 시안의 사이드바는 본문보다 **아주 조금만** 가라앉는다. `bg-bg-sunken` 은
            대비가 커서 사이드바가 하나의 패널로 떠 보이는데, 이 화면들에서 사이드바는
            패널이 아니라 여백에 가깝다(시안 대조 2026-08-23) */}
        {/* **같은 것이 두 모양으로 선다**(REQ-WEB-164) — `md` 부터는 제자리에 붙박인
            사이드바, 그 아래에서는 [☰] 가 여는 서랍이다. 두 벌을 그리지 않으므로 트리의
            펼침 상태도, 스크롤 위치도 하나뿐이다. */}
        <aside
          id={NAV_ID}
          data-testid="nav-rail"
          data-open={drawerOpen ? 'true' : 'false'}
          onClick={(e) => {
            // 서랍 안에서 어디론가 떠나면 닫는다 — 보고 있던 화면과 같은 자리를 눌러도
            // 닫혀야 한다(경로가 그대로면 위의 effect 는 걸리지 않는다).
            if ((e.target as HTMLElement).closest('a') !== null) setDrawerOpen(false);
          }}
          className={cn(
            'flex-col overflow-hidden border-border px-2 py-3',
            'fixed top-header right-auto bottom-0 left-0 z-40 w-[17.5rem] max-w-[86vw] border-r bg-bg shadow-popover',
            drawerOpen ? 'flex' : 'hidden',
            projectSlug === undefined
              ? // 프로젝트 밖(홈·받은 요청·설정)에서는 넓은 화면에 사이드바가 없다.
                // 좁은 화면의 서랍은 그때도 남는다 — 조직과 도움말이 거기 있다.
                'md:hidden'
              : 'md:sticky md:top-header md:bottom-auto md:z-auto md:flex md:h-[calc(100vh-var(--spacing-header))] md:w-sidebar md:max-w-none md:shrink-0 md:bg-bg-sunken/40 md:shadow-none',
          )}
        >
          {/* 서랍 머리 — 닫는 길이 서랍 **안에도** 있어야 한다. 뒷막만으로는 닫을 수
              있다는 것을 아무도 모른다. */}
          {drawerOpen && (
            <div className="flex items-center justify-between px-2 pb-1 md:hidden">
              <p className={RAIL_LABEL}>{t('shell.menu')}</p>
              <button
                type="button"
                data-testid="nav-drawer-close"
                aria-label={t('shell.close_menu')}
                onClick={() => setDrawerOpen(false)}
                className={cn(HEADER_LINK, 'flex size-[27px] items-center justify-center px-0')}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          )}

          {/* 조직 — 좁은 화면에서 헤더가 내준 자리가 여기다. **서랍이 열렸을 때만** 그린다:
              넓은 화면의 DOM 에 같은 링크가 한 벌 더 남으면 접근성 트리와 테스트가 둘을 본다. */}
          {drawerOpen && currentOrg !== null && (
            <div className="border-b border-border px-2 pb-2.5 md:hidden">
              <p className={RAIL_LABEL}>{t('shell.org')}</p>
              <div className="mt-1 flex flex-col gap-0.5">
                {orgs.map((org) => (
                  <Link
                    key={org.slug}
                    to="/o/$org"
                    params={{ org: org.slug }}
                    className={cn(NAV_ITEM, org.slug === currentOrg.slug && NAV_ACTIVE)}
                  >
                    <span aria-hidden="true" className="w-3 shrink-0 text-text-faint">
                      {org.slug === currentOrg.slug ? '✓' : ''}
                    </span>
                    <span className="flex-1 truncate">{org.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {projectSlug !== undefined && (
            <>
              <div className="px-2 pb-2.5">
                <p className={RAIL_LABEL}>{t('common.project')}</p>
                {/* 프로젝트에도 표식을 준다 — 이름만 있으면 어느 프로젝트인지 **읽어야** 안다 */}
                <p className="mt-1 flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-status-done text-[9px] font-bold text-white uppercase"
                  >
                    {projectSlug.slice(0, 1)}
                  </span>
                  {/* 헤더와 **같은 글자**로 — 사이드바는 slug, 헤더는 이름이라 같은 프로젝트가 두
                      이름으로 불렸다(REQ-WEB-193) */}
                  <span className="truncate text-base font-semibold tracking-[-0.01em]">
                    {String(currentProject?.['name'] ?? projectSlug)}
                  </span>
                </p>
              </div>
              <nav className="mt-3 flex flex-col gap-0.5">
                <Link
                  to="/p/$proj"
                  params={{ proj: projectSlug }}
                  className={NAV_ITEM}
                  activeProps={{ className: NAV_ACTIVE }}
                  activeOptions={{ exact: true }}
                >
                  <span aria-hidden="true" className={NAV_GLYPH}>
                    ◇
                  </span>
                  <span className="flex-1">{t('shell.nav.overview')}</span>
                </Link>
                <Link
                  to="/p/$proj/specs"
                  params={{ proj: projectSlug }}
                  className={NAV_ITEM}
                  activeProps={{ className: NAV_ACTIVE }}
                >
                  <span aria-hidden="true" className={NAV_GLYPH}>
                    ▤
                  </span>
                  <span className="flex-1">{t('shell.nav.specs')}</span>
                </Link>
                <Link
                  to="/p/$proj/tasks"
                  params={{ proj: projectSlug }}
                  className={NAV_ITEM}
                  activeProps={{ className: NAV_ACTIVE }}
                >
                  <span aria-hidden="true" className={NAV_GLYPH}>
                    ◫
                  </span>
                  <span className="flex-1">{t('shell.nav.tasks')}</span>
                </Link>
                <Link
                  to="/p/$proj/sessions"
                  params={{ proj: projectSlug }}
                  className={NAV_ITEM}
                  activeProps={{ className: NAV_ACTIVE }}
                >
                  <span aria-hidden="true" className={NAV_GLYPH}>
                    ◉
                  </span>
                  <span className="flex-1">{t('shell.nav.sessions')}</span>
                  {/* **지금 몇 개가 돌고 있나**를 사이드바가 말한다 — 세션 화면에 들어가야
                    아는 숫자면 그 화면을 열기 전에는 아무도 모른다(시안 대조) */}
                  <CountBadge count={activeSessions} tone="agent" />
                </Link>
                {/* 리뷰 탭은 Phase 2 였고 2026-08-23 에 열렸다(screens.md §2.6a).
                  배지는 **열린 critical** — 세션 건수와 같은 이유다: 화면에 들어가야
                  아는 숫자면 그 화면을 열기 전에는 아무도 모른다 */}
                <Link
                  to="/p/$proj/reviews"
                  params={{ proj: projectSlug }}
                  className={NAV_ITEM}
                  activeProps={{ className: NAV_ACTIVE }}
                >
                  <span aria-hidden="true" className={NAV_GLYPH}>
                    ◈
                  </span>
                  <span className="flex-1">{t('shell.nav.review')}</span>
                  <CountBadge count={openCritical} tone="danger" />
                </Link>
              </nav>
              {/* 트리는 S3 좌측 트리와 같은 컴포넌트다 — 스크롤 위치를 공유한다(§1.3).
                `projectId` 를 함께 넘겨 쿼리 키를 **UUID 축**으로 맞춘다: 이벤트 무효화는
                project_id(UUID)로 오는데 여기서 slug 로 키를 만들면 같은 컴포넌트인데도
                사이드바만 갱신되지 않는다(실측 2026-08-29). */}
              {/* **트리가 제 상자 안에서 스크롤한다**(2026-08-30). 전부 펼치면 141줄이라
                사이드바 전체가 스크롤되면 프로젝트 이름·메뉴까지 화면 밖으로 밀린다 —
                늘 있어야 하는 것이 사라지면 그건 네비게이션이 아니다. */}
              <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
                <SpecTree
                  projectSlug={projectSlug}
                  projectId={asProjectId(shellProject.data?.['id'])}
                  variant="rail"
                  activeKey={activeSpecKey}
                  heading={t('shell.spec_tree')}
                />
              </div>
            </>
          )}

          {/* 도움말 — 헤더의 `?` 가 좁은 화면에서 내려오는 자리다. 트리가 남은 세로를
              가져가므로 이 구역은 서랍 바닥에 붙어 선다. */}
          {drawerOpen && (
            <div className="mt-3 border-t border-border px-2 pt-2 md:hidden">
              <p className={RAIL_LABEL}>{t('shell.help')}</p>
              <div className="mt-1 flex flex-col gap-0.5">
                {contextChapter !== null && (
                  <Link
                    to="/help/$chapter"
                    params={{ chapter: contextChapter }}
                    data-testid="drawer-help-this-screen"
                    className={NAV_ITEM}
                  >
                    <span aria-hidden="true" className={NAV_GLYPH}>
                      ?
                    </span>
                    <span className="flex-1">{t('help.this_screen')}</span>
                  </Link>
                )}
                <Link to="/help" className={NAV_ITEM}>
                  <span aria-hidden="true" className={NAV_GLYPH}>
                    ▤
                  </span>
                  <span className="flex-1">{t('help.title')}</span>
                </Link>
              </div>
            </div>
          )}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <div data-testid="toast-outlet" className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="toast"
            data-tone={toast.tone}
            className="flex items-center gap-3 rounded-nerv border border-border bg-bg-elev px-3 py-2 text-sm shadow-popover"
          >
            <span>{toast.message}</span>
            {toast.href !== undefined && (
              <a href={toast.href} className="text-link underline">
                {toast.hrefLabel ?? t('shell.toast.undo')}
              </a>
            )}
            <button
              type="button"
              aria-label={t('shell.dismiss')}
              className="text-text-faint hover:text-text"
              onClick={() => dismissToast(toast.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <QuickSwitcher
        projectSlug={projectSlug}
        projectName={currentProject === undefined ? undefined : String(currentProject['name'])}
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </div>
  );
}
