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
import { useEffect, useState } from 'react';
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
          <Link to="/settings" className="text-sm text-text-mute hover:text-text">
            설정
          </Link>
          {me.data !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-mute">{me.data.display_name}</span>
              <button
                type="button"
                className="text-text-faint hover:text-text"
                onClick={() => {
                  void signOut().then(() => navigate({ to: '/login' }));
                }}
              >
                로그아웃
              </button>
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
