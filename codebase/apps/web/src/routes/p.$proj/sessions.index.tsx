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
import { Card, PageBody, PageHeader, SectionTitle } from '../../components/ui/primitives.js';
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
    <PageBody wide>
      <PageHeader
        title="세션 모니터"
        description="누구의 어느 머신이 무엇을 하고 있는지 — 그리고 멈춰 있다면 왜인지."
      />

      <div className="mb-6">
        <SessionBoard
          projectSlug={proj}
          projectId={typeof projectId === 'string' ? projectId : proj}
        />
      </div>

      {cards.length > 0 && (
        <section>
          <SectionTitle>개입</SectionTitle>
          <ul className="grid gap-3 md:grid-cols-2">
            {cards.map((card) => (
              <li key={card.id}>
                <Card>
                  <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                    <Link
                      to="/p/$proj/sessions/$session"
                      params={{ proj, session: card.id }}
                      className="min-w-0 truncate font-medium hover:text-link"
                    >
                      {card.user_name} · <span className="font-mono text-xs">{card.hostname}</span>
                    </Link>
                    <span className="shrink-0 text-xs text-text-mute">{card.agent_type}</span>
                  </div>
                  <SteerPanel projectSlug={proj} sessionId={card.id} state={card.state} />
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageBody>
  );
}

/** 프로젝트 UUID — 쿼리 키가 이벤트 봉투의 project_id 와 같은 축이어야 갱신이 산다. */
function projectIdOf(project: Record<string, unknown> | undefined): string | undefined {
  const id = project?.['id'];
  return typeof id === 'string' ? id : undefined;
}
