// /settings → 첫 무리(조직)의 첫 항목으로(screens.md §1.2 · 2026-09-25 개정 — REQ-WEB-227). 예전에는 멤버·역할로 보내
// 탭 줄의 첫 칸(조직·프로젝트)이 아니라 둘째 칸에 착지했다
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/workspace' });
  },
});
