// /settings/workspace — 옛 주소. 조직과 프로젝트를 나누면서(2026-09-26 · REQ-WEB-242) 두 화면으로 옮겼다.
// 즐겨찾기와 옛 링크가 깨지지 않도록 새 주소로 보낸다: `?new=1` 은 프로젝트 만들기 폼이므로 프로젝트 목록으로,
// 나머지는 조직 정보로.
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/workspace')({
  beforeLoad: ({ search }) => {
    const raw = (search as Record<string, unknown>)['new'];
    if (raw === 1 || raw === '1') throw redirect({ to: '/settings/projects', search: { new: 1 } });
    throw redirect({ to: '/settings/org' });
  },
});
