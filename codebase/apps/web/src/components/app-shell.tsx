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

import { useT } from '../lib/i18n.js';
import { THEMES, useTheme } from '../lib/theme.js';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { connectionBanner, useRealtime } from '../lib/realtime.js';
import { canManageScope, signOut } from '../lib/session.js';
import { inboxActionable, useInbox, useMe, useUnreadCount, useProject } from '../lib/queries.js';
import { cn } from '../lib/utils.js';
import { chapterForRoute, MANUAL_CHAPTERS } from '../lib/manual.js';
import { useScope } from '../lib/scope.js';
import { QuickSwitcher } from './quick-switcher.js';
import { ToastStack } from './toast-stack.js';
import { documentTitle, onDetailRoute, screenKeyFor } from '../lib/document-title.js';
import { useTitleDetailValue } from '../lib/title-detail.js';
import { SpecTreeColumn } from './spec-tree-column.js';
import { SettingsNav } from '../features/settings/settings-nav.js';
import { LocaleSwitch } from './locale-switch.js';
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
  /** 지금 보는 스펙 — 있으면 스펙 트리의 둘째 열이 서고, 그 자리를 펼치고 표시한다(REQ-WEB-226) */
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
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  // 활성 세션 수는 프로젝트 조회가 함께 준다(EP-PRJ-03) — 세션 목록을 또 부르지 않는다
  const shellProject = useProject(projectSlug ?? '');
  const activeSessions = Number(shellProject.data?.['active_sessions'] ?? 0);
  const openCritical = Number(shellProject.data?.['open_critical_findings'] ?? 0);
  // **열 수 없는 프로젝트에는 탭과 트리를 세우지 않는다**(REQ-WEB-199). 없는 프로젝트·멤버가
  // 아닌 프로젝트에 탭 다섯과 빈 트리를 세우면 그 화면이 방금 만든 빈 프로젝트처럼 읽힌다 —
  // 본문은 무엇이 틀렸는지 말하고(ProjectShell), 사이드바는 비킨다.
  const projectBroken = shellProject.isError && shellProject.data === undefined;
  const sidebarProject = projectBroken ? undefined : projectSlug;
  const { state, offline } = useRealtime();
  const me = useMe();
  const inbox = useInbox();
  const unread = useUnreadCount();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<'org' | 'user' | 'help' | null>(null);
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
  // 새 프로젝트는 조직 수준 조작이라 조직 admin 만 — 드롭다운의 라벨·목적지가 이것을 따른다(SET-X2)
  const orgAdmin = canManageScope(me.data, scope.orgSlug, null);
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

  /**
   * **키보드로도 열고 닫는다**(2026-09-25 — UI/UX 검토 NAV-12 · REQ-WEB-224). 메뉴 넷은 바깥 클릭으로만
   * 닫혀, 키보드로 연 사람은 Esc 로도 닫지 못했고 Tab 으로 메뉴 밖에 나가도 팝오버가 열린 채 남았다.
   * 단추는 열림을 말하지 않았다(aria-expanded). 열면 첫 항목으로 가고, Esc 면 닫고 연 단추로 돌아가며,
   * 포커스가 메뉴 밖으로 나가면 닫는다.
   */
  useEffect(() => {
    if (menuOpen === null) return;
    const root = document.querySelector(`[data-menu-root="${menuOpen}"]`);
    root
      ?.querySelector<HTMLElement>(
        `#shell-menu-${menuOpen} a[href], #shell-menu-${menuOpen} button`,
      )
      ?.focus();
    const trigger = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[data-menu-trigger="${menuOpen}"]`);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setMenuOpen(null);
      trigger()?.focus();
    };
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target !== null && target.closest(`[data-menu-root="${menuOpen}"]`) === null)
        setMenuOpen(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [menuOpen]);

  // 도움말의 "이 화면" 항목 — 짚어 줄 장이 없으면 그 항목을 아예 안 보인다(manual.ts)
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // 지금 보는 **기준선** — 사이드바 트리도 같은 세트를 읽고 그것을 물고 상세로 간다(REQ-WEB-135 · SPEC-06).
  // 넘기지 않으면 기준선으로 읽던 사람이 사이드바에서 옆 문서를 누르는 순간 최신 승인본으로 떨어졌다
  const viewBaseline = useRouterState({
    select: (s) => {
      const value = (s.location.search as Record<string, unknown>)['baseline'];
      return typeof value === 'string' && value !== '' ? value : undefined;
    },
  });
  const contextChapter = chapterForRoute(pathname);

  // 탭 제목이 범위를 말한다(REQ-WEB-194) — 탭을 여럿 열어 두면 어느 것이 어디인지 제목뿐이다.
  // 상세 화면이면 **무엇을 보는지**까지(2026-09-25 — NAV-13 · REQ-WEB-228): 스펙 세 편을 열어 두면 셋 다 "스펙" 이었다
  const titleDetail = useTitleDetailValue();
  const detail = onDetailRoute(pathname) ? titleDetail : null;
  useEffect(() => {
    document.title = documentTitle(
      t,
      pathname,
      {
        orgName: scope.orgName,
        projectName: currentProject === undefined ? null : String(currentProject['name']),
      },
      detail,
    );
  }, [t, pathname, scope.orgName, currentProject, detail]);

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
  // **쪽 길이가 아니라 서버가 센 수다**(2026-09-24 · REQ-API-166). 목록이 커서로 나뉜 뒤로
  // 첫 쪽 길이를 세면 배지가 30 에서 멈춘다 — 배지와 목록이 어긋나면 지울 수 없는
  // 숫자가 남는다(알림 배지에서 이미 겪은 자리 · REQ-WEB-035). 그리고 **내가 누를 수 있는 것만**
  // 센다(2026-09-24 사람 결정 D2 · REQ-WEB-217) — 내가 요청한 것까지 세면 할 일을 다 해도 0 이
  // 되지 않아, 배지가 "내가 막고 있는 것" 을 뜻하지 않게 됐다.
  const pending = inboxActionable(inbox.data);
  /**
   * **배지는 결정이 필요한 것만 센다**(2026-09-07 · REQ-WEB-149 · FR-12). 전체 unread 를
   * 세던 동안 실측 767건 중 99건만 결정이고, 나머지는 배경 활동이었다 — 배지가 그것을
   * 함께 세면 "내가 막고 있는 것" 이 아니라 "무슨 일이 있었나" 가 된다.
   */
  const unreadCount = unread.data?.immediate ?? 0;
  // 알림 화면은 "읽지 않음 126" 인데 헤더 배지는 없을 수 있다(중요 0) — 두 수가 설명 없이
  // 다르지 않게, 안 읽은 것이 있으면 이름이 둘 다 말한다(HUB-09 · REQ-WEB-218)
  const unreadTotal = unread.data?.count ?? 0;
  const notificationsTitle =
    unreadTotal === 0
      ? t('shell.notifications_all_orgs')
      : t('shell.notifications_counts', { important: unreadCount, unread: unreadTotal });

  const screenKey = screenKeyFor(pathname);
  const onHelp = pathname.startsWith('/help');
  const onSettings = pathname.startsWith('/settings');
  /**
   * 조직을 바꾼 뒤 **돌아올 자리**(2026-09-25 — 사람 결정 D1 · SET-07 · REQ-WEB-227). 조직 범위 화면(설정·받은 요청·
   * 알림·도움말)에서 바꾸면 같은 화면의 새 조직 판으로 돌아온다 — 예전에는 늘 홈으로 튕겨, 두 조직의 멤버를 차례로
   * 보던 admin 이 매번 설정을 다시 찾아 들어왔다. 프로젝트 화면은 싣지 않는다: 새 조직에는 그 프로젝트가 없다.
   * 경로만 싣는다 — 쿼리(`?project=` 같은)는 옛 조직의 것이다.
   */
  const orgSwitchNext =
    onSettings || onHelp || pathname.startsWith('/inbox') || pathname.startsWith('/notifications')
      ? pathname
      : undefined;
  /**
   * 사이드바의 프로젝트 목록 — 지금 조직의 것 전부. 라우트의 프로젝트가 목록에 아직 없으면(목록을 받기 전 ·
   * 다른 경로로 들어왔을 때) 그 하나를 앞에 세운다 — 펼칠 자리가 사라지면 탭과 트리가 함께 사라진다
   */
  const railProjects =
    sidebarProject !== undefined && !projectRows.some((p) => p['slug'] === sidebarProject)
      ? [{ slug: sidebarProject, name: currentProject?.['name'] ?? sidebarProject }, ...projectRows]
      : projectRows;

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* **본문으로 건너뛴다**(2026-09-25 — UI/UX 검토 SYS-X2 · REQ-WEB-224). 키보드는 매 화면 헤더 여덟 자리와
          사이드바 탭 다섯, 펼친 스펙 트리 전체를 지나야 본문에 닿았다. 첫 Tab 에만 보인다 */}
      <a
        href="#main"
        data-testid="skip-to-main"
        onClick={(e) => {
          // 해시를 바꾸지 않는다 — 스펙 상세는 해시를 헤딩 앵커로 읽는다(REQ-WEB-215)
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-nerv focus:bg-bg-elev focus:px-3 focus:py-2 focus:text-sm focus:shadow-popover"
      >
        {t('shell.skip_to_main')}
      </a>
      <header className="sticky top-0 z-30 flex h-header items-center justify-between gap-4 border-b border-border bg-bg px-2 max-md:gap-1 md:px-3">
        <div className="flex min-w-0 items-center gap-1">
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
          {/* **헤더는 "어디" 를 말한다**(2026-09-25 사람 결정 D1 — 상시 사이드바 · REQ-WEB-225). 조직▾ / 프로젝트▾
              선택기와 [프로젝트] 링크는 사이드바로 내려갔다 — 헤더에는 지금 자리(조직 › 프로젝트 › 화면)만 남는다.
              같은 곳을 가리키는 [프로젝트] 링크와 사이드바 [개요]가 함께 켜지던 자리다(NAV-05) */}
          <nav
            aria-label={t('shell.breadcrumb')}
            data-testid="breadcrumb"
            className="ml-1 flex min-w-0 items-center gap-1 text-sm max-md:ml-0"
          >
            {/* 조직은 **글자**다 — 헤더에서 `/` 로 가는 길은 로고 하나다(2026-08-30 · 같은 목적지를 두 번 두지 않는다) */}
            {currentOrg !== null && (
              <span
                data-testid="crumb-org"
                className="max-w-40 truncate rounded-nerv-sm px-1 text-text-mute max-md:hidden"
              >
                {currentOrg.name ?? currentOrg.slug}
              </span>
            )}
            {sidebarProject !== undefined && (
              <>
                <span aria-hidden="true" className="text-text-ghost max-md:hidden">
                  /
                </span>
                <Link
                  to="/p/$proj"
                  params={{ proj: sidebarProject }}
                  data-testid="crumb-project"
                  className={cn(
                    'max-w-44 truncate rounded-nerv-sm px-1 text-text-mute hover:text-text',
                    // 좁은 폭에서 상세까지 서면 넘친다 — 프로젝트는 사이드바(서랍)가 말한다
                    detail !== null && 'max-md:hidden',
                  )}
                >
                  {String(currentProject?.['name'] ?? sidebarProject)}
                </Link>
              </>
            )}
            {screenKey !== null && (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'text-text-ghost',
                    (sidebarProject === undefined || detail !== null) && 'max-md:hidden',
                  )}
                >
                  /
                </span>
                {detail !== null && sidebarProject !== undefined ? (
                  // **상세에서는 화면 이름이 그 목록으로 가는 길이다**(2026-09-25 — NAV-13 · REQ-WEB-228) — 지금 자리는
                  // 끝의 키가 말한다. 목록으로 돌아가는 링크를 화면마다 따로 두던 것을 헤더가 한 모양으로 든다
                  <Link
                    to={
                      screenKey === 'shell.nav.tasks'
                        ? '/p/$proj/tasks'
                        : screenKey === 'shell.nav.sessions'
                          ? '/p/$proj/sessions'
                          : '/p/$proj/specs'
                    }
                    params={{ proj: sidebarProject }}
                    // 목록은 지금 자리가 아니다 — 접두 일치로 켜지면 aria-current 가 둘이 된다(끝의 키가 지금 자리)
                    activeOptions={{ exact: true }}
                    data-testid="crumb-screen"
                    className="shrink-0 rounded-nerv-sm px-1 text-text-mute hover:text-text"
                  >
                    {t(screenKey)}
                  </Link>
                ) : (
                  <span
                    aria-current="page"
                    data-testid="crumb-screen"
                    className="truncate px-1 font-medium text-text"
                  >
                    {t(screenKey)}
                  </span>
                )}
              </>
            )}
            {detail !== null && (
              <>
                <span aria-hidden="true" className="text-text-ghost">
                  /
                </span>
                <span
                  aria-current="page"
                  data-testid="crumb-detail"
                  title={detail.title ?? detail.key}
                  className="min-w-0 truncate px-1 font-mono text-xs font-medium text-text"
                >
                  {detail.key}
                </span>
              </>
            )}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 max-md:gap-0.5">
          {/* **좁은 화면에서만** 받은 요청·알림이 헤더에 선다(REQ-WEB-164 — 숫자는 열기 전에 보인다). 넓으면
              사이드바의 전역 구역이 그 자리다 — 두 곳에 같은 수가 서지 않는다 */}
          {!sidebarStands && (
            <>
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
                aria-label={notificationsTitle}
                title={notificationsTitle}
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
            </>
          )}
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
          <div className="relative" data-menu-root="help">
            <button
              type="button"
              data-testid="help-menu"
              data-menu-trigger="help"
              aria-haspopup="true"
              aria-expanded={menuOpen === 'help'}
              aria-controls="shell-menu-help"
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
              <Popover align="right" id="shell-menu-help">
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
            <div className="relative" data-menu-root="user">
              <button
                type="button"
                data-testid="user-menu"
                data-menu-trigger="user"
                aria-haspopup="true"
                aria-expanded={menuOpen === 'user'}
                aria-controls="shell-menu-user"
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
                <Popover align="right" id="shell-menu-user">
                  <p className="border-b border-border px-3 pb-1.5 text-xs text-text-faint">
                    {me.data.email}
                  </p>
                  {/* **내 계정이 이름 바로 아래다**(2026-09-25 — 사람 결정 D10 · REQ-WEB-229) — 이름·비밀번호를 바꾸러 온
                      사람은 자기 이름을 누른다 */}
                  <Link
                    to="/settings/account"
                    data-testid="user-menu-account"
                    onClick={() => setMenuOpen(null)}
                    className="mt-1 block px-3 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    {t('settings.tab.account')}
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setMenuOpen(null)}
                    className="block px-3 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    {t('shell.settings')}
                  </Link>
                  {/* 언어 전환은 사용자 메뉴에 둔다 — 자주 바꾸는 것이 아니고, 계정에 붙은
                      설정이라 사용자 이름 아래가 사람들이 먼저 찾아보는 자리다. 로그인 전 화면도 같은 단추 줄이다 */}
                  <LocaleSwitch className="mt-1 border-t border-border px-3 pt-1.5 pb-1" />
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
        {/* **왼쪽 열은 모든 화면에서 같다**(2026-09-25 사람 결정 D1 · REQ-WEB-225). 프로젝트 화면에서는 탭과
            트리, 홈·받은 요청·알림·설정에서는 열이 통째로 사라져 본문이 가운데로 뛰고, 도움말에서는 같은 폭의
            다른 열(차례)이 섰다 — 세 모양이었다(NAV-06). 이제 조직 · 전역 · 프로젝트 · 설정·도움말이 늘 같은
            자리에 있고, 펼쳐지는 것은 라우트가 정한다: 프로젝트 화면이면 그 프로젝트, 도움말이면 차례.
            좁은 화면에서는 같은 한 벌이 서랍이다(REQ-WEB-164). */}
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
            'flex-col overflow-y-auto border-border px-2 py-3',
            'fixed top-header right-auto bottom-0 left-0 z-40 w-[17.5rem] max-w-[86vw] border-r bg-bg shadow-popover',
            drawerOpen ? 'flex' : 'hidden',
            'md:sticky md:top-header md:bottom-auto md:z-auto md:flex md:h-[calc(100vh-var(--spacing-header))] md:w-sidebar md:max-w-none md:shrink-0 md:bg-bg-sunken/40 md:shadow-none',
          )}
        >
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

          {/* 조직 — 전환기가 열의 머리다. 헤더에 있던 동안 받은 요청·알림 배지가 그 바로 옆이라 "지금 조직의 수" 로
              읽혔다(배지는 모든 조직을 센다 — REQ-WEB-193) */}
          {currentOrg !== null && (
            <div className="relative shrink-0 pb-2" data-menu-root="org">
              <button
                type="button"
                data-testid="org-switcher"
                data-menu-trigger="org"
                aria-haspopup="true"
                aria-expanded={menuOpen === 'org'}
                aria-controls="shell-menu-org"
                aria-label={t('shell.org_label', { name: currentOrg.name ?? currentOrg.slug })}
                onClick={() => setMenuOpen((open) => (open === 'org' ? null : 'org'))}
                className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-text text-[10px] font-bold text-bg uppercase"
                >
                  {(currentOrg.name ?? currentOrg.slug).slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span aria-hidden="true" className="block text-2xs text-text-faint">
                    {t('common.org')}
                  </span>
                  <span className="block truncate text-sm font-semibold">{currentOrg.name}</span>
                </span>
                <span aria-hidden="true" className="text-text-faint">
                  ▾
                </span>
              </button>
              {menuOpen === 'org' && (
                <Popover id="shell-menu-org" className="right-0">
                  {orgs.map((org) => (
                    <Link
                      key={org.slug}
                      to="/o/$org"
                      params={{ org: org.slug }}
                      search={orgSwitchNext === undefined ? {} : { next: orgSwitchNext }}
                      onClick={() => setMenuOpen(null)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg-hover"
                    >
                      <span aria-hidden="true" className="w-3 shrink-0 text-text-faint">
                        {org.slug === currentOrg.slug ? '✓' : ''}
                      </span>
                      <span className="truncate">{org.name}</span>
                    </Link>
                  ))}
                  {orgs.length === 1 && (
                    <p className="px-3 py-1.5 text-xs text-text-faint">{t('shell.no_other_org')}</p>
                  )}
                  {/* **고르는 자리에서 만들 수도 있어야 한다** — 설정 어딘가로 찾아가게 하면 "새로 만들기" 는
                      아는 사람만 쓰는 기능이 된다 */}
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

          {/* 전역 — 조직을 가로지르는 자리들이다(받은 요청·알림은 모든 조직을 센다) */}
          <nav aria-label={t('shell.nav.global')} className="flex shrink-0 flex-col gap-0.5">
            <Link
              to="/"
              data-testid="rail-home"
              className={NAV_ITEM}
              activeProps={{ className: NAV_ACTIVE }}
              activeOptions={{ exact: true }}
            >
              <span aria-hidden="true" className={NAV_GLYPH}>
                ⌂
              </span>
              <span className="flex-1">{t('shell.home')}</span>
            </Link>
            <Link
              to="/inbox"
              data-testid="rail-inbox"
              title={t('shell.inbox_all_orgs')}
              className={NAV_ITEM}
              activeProps={{ className: NAV_ACTIVE }}
            >
              <span aria-hidden="true" className={NAV_GLYPH}>
                <Glyph d={GLYPH_INBOX} size={13} />
              </span>
              <span className="flex-1">{t('shell.inbox')}</span>
              <CountBadge count={pending} tone="action" testId="rail-inbox-badge" />
            </Link>
            <Link
              to="/notifications"
              data-testid="rail-notifications"
              title={notificationsTitle}
              className={NAV_ITEM}
              activeProps={{ className: NAV_ACTIVE }}
            >
              <span aria-hidden="true" className={NAV_GLYPH}>
                <Glyph d={GLYPH_BELL} size={13} />
              </span>
              <span className="flex-1">{t('shell.notifications')}</span>
              <CountBadge count={unreadCount} tone="waiting" testId="rail-notification-badge" />
            </Link>
          </nav>

          {/* 프로젝트 — 지금 조직의 것이 다 서고, **라우트의 프로젝트만 펼친다**. 조직 범위 화면에서는 아무것도
              펼치지 않는다 — 기억한 프로젝트는 "최근" 표식일 뿐 선택이 아니다(REQ-WEB-193 의 목적을 구조가 지킨다) */}
          {/* 조직을 몰라도(목록을 받기 전) **라우트의 프로젝트는 선다** — 탭이 그 조회를 기다리면 안 된다 */}
          {(currentOrg !== null || sidebarProject !== undefined) && (
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <p className={cn(RAIL_LABEL, 'px-2 pb-1')}>{t('common.project')}</p>
              <ul className="flex flex-col gap-0.5">
                {railProjects.map((project) => {
                  const slug = String(project['slug']);
                  const name = String(project['name'] ?? slug);
                  if (slug !== sidebarProject)
                    return (
                      <li key={slug}>
                        <Link
                          to="/p/$proj"
                          params={{ proj: slug }}
                          data-testid={`rail-project-${slug}`}
                          className={NAV_ITEM}
                        >
                          <span aria-hidden="true" className={NAV_GLYPH}>
                            ▸
                          </span>
                          <span className="flex-1 truncate">{name}</span>
                          {!onProjectRoute && slug === currentProjectSlug && (
                            <span
                              data-testid="project-recent"
                              className="shrink-0 text-2xs text-text-faint"
                            >
                              {t('shell.recent')}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  return (
                    <li key={slug} className="flex flex-col">
                      {/* 프로젝트 이름이 **그 프로젝트로 가는 링크**다(NAV-05) — 활성 표시는 아래의 [개요] 하나다 */}
                      <Link
                        to="/p/$proj"
                        params={{ proj: slug }}
                        data-testid="rail-project-current"
                        aria-label={t('shell.project_label', { name })}
                        className={cn(NAV_ITEM, 'font-semibold text-text')}
                      >
                        <span
                          aria-hidden="true"
                          className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-status-done text-[9px] font-bold text-white uppercase"
                        >
                          {slug.slice(0, 1)}
                        </span>
                        <span className="flex-1 truncate">{name}</span>
                      </Link>
                      <nav
                        aria-label={t('shell.nav.project')}
                        className="mt-0.5 ml-2 flex flex-col gap-0.5 border-l border-border pl-1.5"
                      >
                        <Link
                          to="/p/$proj"
                          params={{ proj: sidebarProject }}
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
                          params={{ proj: sidebarProject }}
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
                          params={{ proj: sidebarProject }}
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
                          params={{ proj: sidebarProject }}
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
                          params={{ proj: sidebarProject }}
                          className={NAV_ITEM}
                          activeProps={{ className: NAV_ACTIVE }}
                        >
                          <span aria-hidden="true" className={NAV_GLYPH}>
                            ◈
                          </span>
                          <span className="flex-1">{t('shell.nav.review')}</span>
                          <CountBadge count={openCritical} tone="danger" />
                        </Link>
                        {/* **그 프로젝트의 설정으로 가는 길**(2026-09-25 — 사람 결정 D1 · NAV-10 · REQ-WEB-227). clemvion 을
                            보던 admin 이 그 게이트 정책을 고치려면 사용자 메뉴 → 설정 → 게이트 탭 → 프로젝트 고르기를
                            밟아야 했다 — 프로젝트를 주소에 실어 보낸다(와이어프레임 S2 의 프로젝트 메뉴에도 [설정]이 있다) */}
                        <Link
                          to="/settings/gates"
                          search={{ project: sidebarProject }}
                          data-testid="rail-project-settings"
                          title={t('shell.nav.project_settings_title')}
                          className={NAV_ITEM}
                        >
                          <span aria-hidden="true" className={NAV_GLYPH}>
                            ⚙
                          </span>
                          <span className="flex-1">{t('shell.nav.project_settings')}</span>
                        </Link>
                      </nav>
                      {/* **스펙 트리는 여기 없다**(2026-09-25 — 사람 결정 D1 · OBS-01 · REQ-WEB-226). 사이드바의 마지막
                          블록이던 동안 작업·세션·리뷰에서도 그 화면과 상관없는 문서 목록이 열의 대부분을 차지했다 —
                          트리는 스펙 상세에서만 서는 둘째 열(`SpecTreeColumn`)이다 */}
                    </li>
                  );
                })}
              </ul>
              {scope.projectsLoaded && projectRows.length === 0 && (
                <p data-testid="project-none" className="px-2 py-1 text-sm text-text-faint">
                  {t('shell.no_projects_yet')}
                </p>
              )}
              {/* **약속한 것만 적는다**(SET-X2). 조직 admin 이 아니면 도착한 탭에서 [+ 새 프로젝트]가 잠겨 있다 */}
              {currentOrg !== null && (
                <Link
                  to="/settings/workspace"
                  search={orgAdmin ? { new: 1 } : {}}
                  data-testid="project-new-link"
                  className="mt-1 shrink-0 px-2 py-1 text-xs text-text-faint hover:text-text"
                >
                  {orgAdmin ? t('shell.new_project') : t('shell.project_manage')}
                </Link>
              )}
            </div>
          )}

          {/* 설정 · 도움말 — 열의 바닥. 도움말에 있으면 **차례가 여기 펼쳐진다**(도움말의 둘째 열을 걷었다 —
              좁은 화면의 서랍에도 차례가 선다 · NAV-14) */}
          <div className="mt-3 shrink-0 border-t border-border pt-2">
            <Link
              to="/settings"
              data-testid="rail-settings"
              className={NAV_ITEM}
              activeProps={{ className: NAV_ACTIVE }}
            >
              <span aria-hidden="true" className={NAV_GLYPH}>
                ⚙
              </span>
              <span className="flex-1">{t('shell.settings')}</span>
            </Link>
            {/* 설정에 있으면 **항목이 여기 펼쳐진다** — 도움말의 차례와 같은 규칙이다(범위로 묶인 목록 · REQ-WEB-227) */}
            {onSettings && <SettingsNav variant="rail" />}
            <Link
              to="/help"
              data-testid="rail-help"
              className={NAV_ITEM}
              activeProps={{ className: NAV_ACTIVE }}
            >
              <span aria-hidden="true" className={NAV_GLYPH}>
                ?
              </span>
              <span className="flex-1">{t('shell.help')}</span>
            </Link>
            {onHelp ? (
              <nav
                data-testid="manual-toc"
                aria-label={t('help.title')}
                className="mt-0.5 ml-2 flex flex-col gap-0.5 border-l border-border pl-1.5"
              >
                {MANUAL_CHAPTERS.map((chapter) => (
                  <Link
                    key={chapter.id}
                    to="/help/$chapter"
                    params={{ chapter: chapter.id }}
                    className={NAV_ITEM}
                    activeProps={{ className: NAV_ACTIVE }}
                  >
                    <span className="flex-1 truncate">{t(chapter.titleKey)}</span>
                  </Link>
                ))}
              </nav>
            ) : (
              contextChapter !== null && (
                <Link
                  to="/help/$chapter"
                  params={{ chapter: contextChapter }}
                  data-testid="drawer-help-this-screen"
                  className={cn(NAV_ITEM, 'ml-2')}
                >
                  <span className="flex-1 truncate text-sm">{t('help.this_screen')}</span>
                </Link>
              )
            )}
          </div>
        </aside>
        {/* 스펙 상세의 둘째 열 — 셸이 세운다: 문서를 옮겨도(라우트 컴포넌트가 불러오는 동안에도) 열은 그대로라
            펼침과 스크롤이 남는다. 쿼리 키는 UUID 축이다 */}
        {sidebarProject !== undefined && activeSpecKey !== undefined && (
          <SpecTreeColumn
            projectSlug={sidebarProject}
            projectId={asProjectId(shellProject.data?.['id'])}
            activeKey={activeSpecKey}
            baseline={viewBaseline}
          />
        )}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          {children}
        </main>
      </div>

      <ToastStack />

      <QuickSwitcher
        projectSlug={projectSlug}
        projectName={currentProject === undefined ? undefined : String(currentProject['name'])}
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </div>
  );
}
