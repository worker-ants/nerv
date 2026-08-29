// /p/:proj — 프로젝트 셸. 멤버십 가드와 project:{id} 룸 join 이 여기 붙는다(E08-S03).
// 프로젝트 탭·스펙 트리는 앱 셸의 사이드바가 렌더한다(screens.md §1.3).
//
// **join 이 여기 있어야 하는 이유**(2026-08-29 정정): 예전에는 개요·세션 두 화면만 각자
// join 했다. 그래서 스펙 목록·스펙 상세에 있는 동안에는 `project:{id}` 이벤트가 아예
// 도착하지 않았고, 사이드바 트리도 마찬가지였다 — 에이전트가 스펙을 만들어도 새로고침
// 전에는 알 수 없었다. 룸은 **화면이 아니라 프로젝트에 속한다.**
import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useProject } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';

function ProjectShell(): React.JSX.Element {
  const { proj } = useParams({ from: '/p/$proj' });
  const project = useProject(proj);
  const { joinProject } = useRealtime();
  const projectId = project.data?.['id'];

  useEffect(() => {
    if (typeof projectId !== 'string') return;
    return joinProject(projectId);
  }, [joinProject, projectId]);

  return <Outlet />;
}

export const Route = createFileRoute('/p/$proj')({ component: ProjectShell });
