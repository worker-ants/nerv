// /settings → 첫 무리(조직)의 첫 항목인 조직 정보로(screens.md §1.2 · 2026-09-26 개정 — REQ-WEB-227 · 242). 예전에는
// 멤버·역할로 보내서 탭 줄의 첫 칸이 아니라 둘째 칸이 열렸다
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/org' });
  },
});
