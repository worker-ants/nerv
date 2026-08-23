// 앱 셸 — 정본: screens.md §1.3
//
//   전역 헤더(조직 스코프 · 승인함/알림 배지 · ⌘K · 사용자 메뉴)
//   연결 상태 배너(2단계 — WS 끊김 / 플랫폼 끊김)
//   프로젝트 사이드바(/p/:proj/* 에서만 — 탭 + 스펙 트리)
//   라우트 아웃렛 · 토스트 스택
//
// **승인함 배지는 내 결정을 기다리는 것만 센다**(spec-workflow §6.6 원칙 3). 배경 활동까지
// 세면 배지는 곧 무시되고, 무시되는 배지는 없는 배지다.
//
// 헤더와 사이드바는 **고정**이다(sticky). 스펙 트리가 수백 줄이어도 조직 전환·승인함은
// 늘 같은 자리에 있어야 한다 — 위로 스크롤해서 찾아야 하는 내비게이션은 내비게이션이 아니다.

import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { connectionBanner, useRealtime } from '../lib/realtime.js';
import { signOut } from '../lib/session.js';
import { useInbox, useMe, useUnreadCount } from '../lib/queries.js';
import { cn } from '../lib/utils.js';
import { QuickSwitcher } from './quick-switcher.js';
import { SpecTree } from './spec-tree.js';
import { StatusBadge } from './status-badge.js';
import { MenuItem, Popover } from './ui/primitives.js';

export interface AppShellProps {
  children: React.ReactNode;
  projectSlug?: string | undefined;
}

/** 헤더 링크 — 눌리는 영역이 글자보다 커야 손이 빗나가지 않는다 */
const HEADER_LINK =
  'rounded-nerv-sm px-2 py-1 text-sm text-text-mute transition-colors hover:bg-bg-hover hover:text-text';

/** 사이드바 항목 — 활성 표시는 배경 + 굵기다. 색만으로 구분하지 않는다(REQ-WEB-033) */
const NAV_ITEM =
  'flex items-center gap-2 rounded-nerv-sm px-2 py-1 text-sm text-text-mute transition-colors hover:bg-bg-hover hover:text-text';
const NAV_ACTIVE = 'bg-bg-active font-medium text-text';

function CountBadge({
  count,
  tone,
  testId,
}: {
  count: number;
  tone: 'action' | 'waiting';
  testId: string;
}): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <span
      data-testid={testId}
      className={cn(
        'ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs font-semibold text-white',
        tone === 'action' ? 'bg-status-action' : 'bg-status-waiting',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function AppShell({ children, projectSlug }: AppShellProps): React.JSX.Element {
  const navigate = useNavigate();
  const { state, offline, toasts, dismissToast } = useRealtime();
  const me = useMe();
  const inbox = useInbox();
  const unread = useUnreadCount();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<'org' | 'user' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 조직 스코프 — 헤더가 조직 단위라는 것을 화면이 말해야 한다(§1.3 "전역 헤더 · 조직 스코프").
  // 멤버십에서 조직을 뽑는다: 사용자가 속한 곳만 고를 수 있다는 사실이 목록 자체로 드러난다.
  const orgs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of me.data?.memberships ?? []) seen.set(m.org_slug, m.org_name);
    return [...seen].map(([slug, name]) => ({ slug, name }));
  }, [me.data]);
  const currentOrg = orgs[0] ?? null;

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

  // 바깥을 누르면 닫는다 — 드롭다운이 열린 채로 남으면 다음 클릭이 먹히지 않는다
  useEffect(() => {
    if (menuOpen === null) return;
    const onClick = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node))
        setMenuOpen(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const banner = connectionBanner(state, offline);
  const pending = inbox.data?.length ?? 0;
  const unreadCount = unread.data?.count ?? 0;

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-30 flex h-header items-center justify-between gap-4 border-b border-border bg-bg px-3">
        <nav className="flex min-w-0 items-center gap-1">
          <Link to="/" className="mr-1 flex items-center gap-1.5 px-1 text-sm font-semibold">
            <span aria-hidden="true" className="text-status-action">
              ⬢
            </span>{' '}
            NERV
          </Link>
          {currentOrg !== null && (
            <div className="relative">
              <button
                type="button"
                data-testid="org-switcher"
                onClick={() => setMenuOpen((open) => (open === 'org' ? null : 'org'))}
                className={cn(HEADER_LINK, 'flex max-w-40 items-center gap-1')}
              >
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
                    <p className="px-3 py-1.5 text-xs text-text-faint">다른 조직 없음</p>
                  )}
                </Popover>
              )}
            </div>
          )}
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          <Link
            to="/"
            className={HEADER_LINK}
            activeProps={{ className: 'bg-bg-active text-text' }}
            activeOptions={{ exact: true }}
          >
            홈
          </Link>
          <Link
            to="/inbox"
            className={HEADER_LINK}
            activeProps={{ className: 'bg-bg-active text-text' }}
          >
            승인함
            <CountBadge count={pending} tone="action" testId="inbox-badge" />
          </Link>
          <Link
            to="/notifications"
            className={HEADER_LINK}
            activeProps={{ className: 'bg-bg-active text-text' }}
          >
            알림
            <CountBadge count={unreadCount} tone="waiting" testId="notification-badge" />
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {/* 검색은 버튼이지만 **입력창처럼 보인다** — 여기에 타이핑하면 된다는 것이
              모양으로 읽혀야 ⌘K 를 모르는 사람도 찾는다 */}
          <button
            type="button"
            onClick={() => setSwitcherOpen(true)}
            className="flex h-7 w-56 items-center gap-2 rounded-nerv-sm border border-border bg-bg-sunken px-2 text-sm text-text-faint transition-colors hover:border-border-strong"
          >
            <span aria-hidden="true">🔍</span>
            <span className="flex-1 text-left">검색</span>
            <kbd className="rounded-nerv-sm border border-border px-1 text-2xs">⌘K</kbd>
          </button>
          {/* 설정은 사용자 메뉴 안에 있다 — 와이어프레임 헤더(§2.1)는
              `⬢ NERV 홈 승인함 알림 🔍검색 [지민 ▾]` 여섯 자리뿐이고, 자주 쓰지 않는 항목이
              자주 쓰는 항목의 자리를 먹으면 헤더는 금세 도구모음이 된다. */}
          {me.data !== undefined && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                data-testid="user-menu"
                onClick={() => setMenuOpen((open) => (open === 'user' ? null : 'user'))}
                className={cn(HEADER_LINK, 'flex items-center gap-1.5')}
              >
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-status-action-soft text-2xs font-semibold text-status-action"
                >
                  {(me.data.display_name ?? '?').slice(0, 1)}
                </span>
                {me.data.display_name}
                <span aria-hidden="true" className="text-text-faint">
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
                    설정
                  </Link>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(null);
                      void signOut().then(() => navigate({ to: '/login' }));
                    }}
                  >
                    로그아웃
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

      <div className="flex">
        {projectSlug !== undefined && (
          <aside className="sticky top-header hidden h-[calc(100vh-var(--spacing-header))] w-sidebar shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-sunken px-2 py-3 md:flex">
            <div className="px-2">
              <p className="text-2xs font-semibold tracking-wide text-text-faint uppercase">
                프로젝트
              </p>
              <p className="mt-0.5 truncate font-medium">{projectSlug}</p>
            </div>
            <nav className="mt-3 flex flex-col gap-0.5">
              <Link
                to="/p/$proj"
                params={{ proj: projectSlug }}
                className={NAV_ITEM}
                activeProps={{ className: NAV_ACTIVE }}
                activeOptions={{ exact: true }}
              >
                <span aria-hidden="true">◇</span> 개요
              </Link>
              <Link
                to="/p/$proj/specs"
                params={{ proj: projectSlug }}
                className={NAV_ITEM}
                activeProps={{ className: NAV_ACTIVE }}
              >
                <span aria-hidden="true">▤</span> 스펙
              </Link>
              <Link
                to="/p/$proj/tasks"
                params={{ proj: projectSlug }}
                className={NAV_ITEM}
                activeProps={{ className: NAV_ACTIVE }}
              >
                <span aria-hidden="true">◫</span> 작업
              </Link>
              <Link
                to="/p/$proj/sessions"
                params={{ proj: projectSlug }}
                className={NAV_ITEM}
                activeProps={{ className: NAV_ACTIVE }}
              >
                <span aria-hidden="true">◉</span> 세션
              </Link>
              {/* 리뷰 탭은 Phase 2 — 숨기지 않고 비활성 + 사유를 보인다(§1.3) */}
              <span
                className={cn(
                  NAV_ITEM,
                  'cursor-not-allowed justify-between hover:bg-transparent hover:text-text-mute',
                )}
                title="Phase 2"
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden="true">◈</span> 리뷰
                </span>
                <StatusBadge token="idle" label="Phase 2" />
              </span>
            </nav>
            {/* 트리는 S3 좌측 트리와 같은 컴포넌트다 — 스크롤 위치를 공유한다(§1.3) */}
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1 px-2 text-2xs font-semibold tracking-wide text-text-faint uppercase">
                스펙 트리
              </p>
              <SpecTree projectSlug={projectSlug} compact />
            </div>
          </aside>
        )}
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
                {toast.hrefLabel ?? '되돌리기'}
              </a>
            )}
            <button
              type="button"
              aria-label="닫기"
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
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </div>
  );
}
