// 앱 셸 — 정본: screens.md §1.3
//
//   전역 헤더(조직 스코프 · 승인함/알림 배지 · ⌘K · 사용자 메뉴)
//   연결 상태 배너(2단계 — WS 끊김 / 플랫폼 끊김)
//   프로젝트 사이드바(/p/:proj/* 에서만 — 탭 + 스펙 트리)
//   라우트 아웃렛 · 토스트 스택
//
// **승인함 배지는 내 결정을 기다리는 것만 센다**(spec-workflow §6.6 원칙 3). 배경 활동까지
// 세면 배지는 곧 무시되고, 무시되는 배지는 없는 배지다.

import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { connectionBanner, useRealtime } from '../lib/realtime.js';
import { signOut } from '../lib/session.js';
import { useInbox, useMe, useUnreadCount } from '../lib/queries.js';
import { QuickSwitcher } from './quick-switcher.js';
import { SpecTree } from './spec-tree.js';
import { StatusBadge } from './status-badge.js';

export interface AppShellProps {
  children: React.ReactNode;
  projectSlug?: string | undefined;
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
      <header className="flex items-center justify-between gap-4 border-b border-border bg-bg-elev px-4 py-2">
        <nav className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span aria-hidden="true">⬢</span> NERV
          </Link>
          {currentOrg !== null && (
            <div className="relative">
              <button
                type="button"
                data-testid="org-switcher"
                onClick={() => setMenuOpen((open) => (open === 'org' ? null : 'org'))}
                className="rounded border border-border px-2 py-0.5 text-sm text-text-mute hover:text-text"
              >
                {currentOrg.name} <span aria-hidden="true">▾</span>
              </button>
              {menuOpen === 'org' && (
                <ul className="absolute left-0 z-40 mt-1 min-w-40 rounded-md border border-border bg-bg-elev py-1 shadow">
                  {orgs.map((org) => (
                    <li key={org.slug}>
                      <Link
                        to="/o/$org"
                        params={{ org: org.slug }}
                        onClick={() => setMenuOpen(null)}
                        className="block px-3 py-1 text-sm hover:bg-bg-sunken"
                      >
                        {org.name}
                      </Link>
                    </li>
                  ))}
                  {orgs.length === 1 && (
                    <li className="px-3 py-1 text-xs text-text-faint">다른 조직 없음</li>
                  )}
                </ul>
              )}
            </div>
          )}
          <Link to="/" className="text-sm text-text-mute hover:text-text">
            홈
          </Link>
          <Link to="/inbox" className="text-sm text-text-mute hover:text-text">
            승인함
            {pending > 0 && (
              <span
                data-testid="inbox-badge"
                className="ml-1 rounded-full bg-status-action px-1.5 text-xs text-white"
              >
                {pending}
              </span>
            )}
          </Link>
          <Link to="/notifications" className="text-sm text-text-mute hover:text-text">
            알림
            {unreadCount > 0 && (
              <span
                data-testid="notification-badge"
                className="ml-1 rounded-full bg-status-waiting px-1.5 text-xs text-white"
              >
                {unreadCount}
              </span>
            )}
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSwitcherOpen(true)}
            className="rounded-md border border-border px-2 py-1 text-sm text-text-mute hover:text-text"
          >
            🔍 검색 <kbd className="ml-1 text-xs text-text-faint">⌘K</kbd>
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
                className="rounded border border-border px-2 py-0.5 text-sm text-text-mute hover:text-text"
              >
                {me.data.display_name} <span aria-hidden="true">▾</span>
              </button>
              {menuOpen === 'user' && (
                <ul className="absolute right-0 z-40 mt-1 min-w-36 rounded-md border border-border bg-bg-elev py-1 shadow">
                  <li className="px-3 py-1 text-xs text-text-faint">{me.data.email}</li>
                  <li>
                    <Link
                      to="/settings"
                      onClick={() => setMenuOpen(null)}
                      className="block px-3 py-1 text-sm hover:bg-bg-sunken"
                    >
                      설정
                    </Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="block w-full px-3 py-1 text-left text-sm hover:bg-bg-sunken"
                      onClick={() => {
                        setMenuOpen(null);
                        void signOut().then(() => navigate({ to: '/login' }));
                      }}
                    >
                      로그아웃
                    </button>
                  </li>
                </ul>
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
          className="border-b border-border bg-status-waiting-soft px-4 py-1 text-sm text-status-waiting"
        >
          {banner}
        </div>
      )}

      <div className="flex">
        {projectSlug !== undefined && (
          <aside className="w-64 shrink-0 border-r border-border bg-bg-elev p-3">
            <div className="mb-2 text-xs text-text-faint">프로젝트</div>
            <div className="mb-3 font-medium">{projectSlug}</div>
            <nav className="mb-4 flex flex-col gap-1 text-sm">
              <Link
                to="/p/$proj"
                params={{ proj: projectSlug }}
                className="hover:text-status-action"
              >
                개요
              </Link>
              <Link
                to="/p/$proj/specs"
                params={{ proj: projectSlug }}
                className="hover:text-status-action"
              >
                스펙
              </Link>
              <Link
                to="/p/$proj/tasks"
                params={{ proj: projectSlug }}
                className="hover:text-status-action"
              >
                작업
              </Link>
              <Link
                to="/p/$proj/sessions"
                params={{ proj: projectSlug }}
                className="hover:text-status-action"
              >
                세션
              </Link>
              {/* 리뷰 탭은 Phase 2 — 숨기지 않고 비활성 + 사유를 보인다(§1.3) */}
              <span className="cursor-not-allowed text-text-faint" title="Phase 2">
                리뷰 <StatusBadge token="idle" label="Phase 2" />
              </span>
            </nav>
            {/* 트리는 S3 좌측 트리와 같은 컴포넌트다 — 스크롤 위치를 공유한다(§1.3) */}
            <SpecTree projectSlug={projectSlug} compact />
          </aside>
        )}
        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>

      <div data-testid="toast-outlet" className="fixed bottom-4 right-4 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="toast"
            data-tone={toast.tone}
            className="flex items-center gap-3 rounded-md border border-border bg-bg-elev px-3 py-2 text-sm shadow"
          >
            <span>{toast.message}</span>
            {toast.href !== undefined && (
              <a href={toast.href} className="text-link underline">
                {toast.hrefLabel ?? '되돌리기'}
              </a>
            )}
            <button
              type="button"
              className="text-text-faint"
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
