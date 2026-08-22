// /p/:proj/sessions → S5 세션 모니터 (ui-wireframes §2.5 · screens.md §2.6)
//
// Phase 0 은 읽기 전용이었고 여기서 **steer/stop** 이 붙는다(FR-08 · E08-S06).
// stop 은 "지시를 전달한다"가 아니라 "지금 회수한다"이다 — 세션이 이미 죽어 하트비트를 못
// 치는 것이 stop 을 누르는 가장 흔한 상황이라, 전달을 기다리면 아무 일도 일어나지 않는다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SessionBoard } from '../../features/session-monitor/session-board.js';
import { SteerPanel } from '../../features/session-monitor/steer-panel.js';
import { useProject, useSessions } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import type { SessionCard } from '../../features/session-monitor/types.js';

export const Route = createFileRoute('/p/$proj/sessions/')({ component: SessionMonitor });

function SessionMonitor(): React.JSX.Element {
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const sessions = useSessions(proj, projectIdOf(project.data));
  const { joinProject } = useRealtime();

  const projectId = project.data?.['id'];
  useEffect(() => {
    if (typeof projectId !== 'string') return;
    return joinProject(projectId);
  }, [joinProject, projectId]);

  const cards = (sessions.data?.items ?? []) as unknown as SessionCard[];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">세션 모니터</h1>
      <SessionBoard
        projectSlug={proj}
        projectId={typeof projectId === 'string' ? projectId : proj}
      />
      <ul className="grid gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <li key={card.id} className="rounded-md border border-border bg-bg-elev p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <Link
                to="/p/$proj/sessions/$session"
                params={{ proj, session: card.id }}
                className="font-medium text-link underline"
              >
                {card.user_name} · {card.hostname}
              </Link>
              <span className="text-xs text-text-mute">{card.agent_type}</span>
            </div>
            <SteerPanel projectSlug={proj} sessionId={card.id} state={card.state} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 프로젝트 UUID — 쿼리 키가 이벤트 봉투의 project_id 와 같은 축이어야 갱신이 산다. */
function projectIdOf(project: Record<string, unknown> | undefined): string | undefined {
  const id = project?.['id'];
  return typeof id === 'string' ? id : undefined;
}
