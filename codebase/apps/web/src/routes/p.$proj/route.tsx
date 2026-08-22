// /p/:proj — 프로젝트 셸. 멤버십 가드와 project:{id} 룸 join 이 여기 붙는다(E08-S03).
// 프로젝트 탭·스펙 트리는 앱 셸의 사이드바가 렌더한다(screens.md §1.3).
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$proj')({
  component: () => <Outlet />,
});
