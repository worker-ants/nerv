// 앱 셸 — 정본: docs/04-mvp/screens.md §1.3
//
//   전역 헤더(조직 스코프 · 승인함/알림 배지 · 전역 검색 · 사용자 메뉴)
//   연결 상태 배너(조건부 — WS 끊김 / 플랫폼 끊김 2단계)
//   프로젝트 사이드바(/p/:proj/* 에서만)
//   라우트 아웃렛
//   토스트 스택
//
// 배지 수치·배너 전환·토스트 적재는 E08-S01 이 실데이터에 연결한다. 여기는 골격이다.

import { Link } from '@tanstack/react-router';
import { StatusBadge } from './status-badge.js';

export interface AppShellProps {
  children: React.ReactNode;
  /** /p/:proj/* 에서만 프로젝트 사이드바를 렌더한다(§1.3) */
  projectSlug?: string | undefined;
}

export function AppShell({ children, projectSlug }: AppShellProps): React.JSX.Element {
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
          {/* 승인함 배지는 **내 결정을 기다리는 것만** 센다(spec-workflow §6.6 원칙 3) */}
          <Link to="/inbox" className="text-sm text-text-mute hover:text-text">
            승인함
          </Link>
          <Link to="/notifications" className="text-sm text-text-mute hover:text-text">
            알림
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          {/* ⌘K 퀵 스위처는 E08-S09(REQ-WEB-040) */}
          <span className="text-sm text-text-faint">🔍 전역 검색</span>
          <Link to="/settings" className="text-sm text-text-mute hover:text-text">
            설정
          </Link>
        </div>
      </header>

      {/* 연결 상태 배너 — 2단계 전환은 REQ-WEB-002 · E08-S01 */}
      <div
        role="status"
        aria-live="polite"
        data-testid="connection-banner"
        className="hidden border-b border-border px-4 py-1 text-sm"
      />

      <div className="flex">
        {projectSlug !== undefined && (
          <aside className="w-64 shrink-0 border-r border-border bg-bg-elev p-3">
            <div className="mb-2 text-xs text-text-faint">프로젝트</div>
            <div className="mb-3 font-medium">{projectSlug}</div>
            <nav className="flex flex-col gap-1 text-sm">
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
              {/* 리뷰 탭은 Phase 2 — 비활성 + 사유 표기(§1.3) */}
              <span className="cursor-not-allowed text-text-faint" title="Phase 2">
                리뷰 <StatusBadge token="idle" label="Phase 2" />
              </span>
            </nav>
          </aside>
        )}
        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>

      {/* 토스트 스택 — 겹침 경고·처리됨 트레일(§1.3) */}
      <div data-testid="toast-outlet" className="fixed bottom-4 right-4 flex flex-col gap-2" />
    </div>
  );
}
