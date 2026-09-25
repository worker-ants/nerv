// /p/:proj/tasks — 작업 보드와 **그 위의 작업 상세** (screens.md §2.5 · REQ-WEB-213)
//
// 보드는 이 레이아웃이 그리고, 작업 상세(`/p/:proj/tasks/:task`)는 `<Outlet />` 자리에 **시트로**
// 선다(2026-09-24 사람 결정 — 명세대로 "보드 위 오버레이"). 예전에는 둘이 형제 라우트라 카드를
// 열면 보드가 언마운트됐다: 걸어 둔 필터(`?spec=`·`?backlog=0`)는 "← 보드로" 한 번에 풀렸고,
// 펼친 "+N개 더" 와 접은 레인도 초기화됐으며, 막힌 카드 여러 장을 훑는 트리아지는 카드마다 왕복 두
// 번이었다. 보드의 뷰 상태는 이 라우트가 검사하므로 상세 주소도 같은 필터를 든다.

import { createFileRoute, Outlet } from '@tanstack/react-router';
import { TaskBoard } from '../../features/task-board/board.js';
import { validateBoardSearch } from '../../features/task-board/board-search.js';

export const Route = createFileRoute('/p/$proj/tasks')({
  validateSearch: validateBoardSearch,
  component: TasksLayout,
});

function TasksLayout(): React.JSX.Element {
  return (
    <>
      <TaskBoard />
      <Outlet />
    </>
  );
}
