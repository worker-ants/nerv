// /p/:proj/sessions → S5 세션 모니터 (ui-wireframes §2.5 · screens.md §2.6)
//
// **master-detail 이다**(시안 반영 2026-08-24). 목록에서 줄을 고르면 오른쪽 레일에 그
// 세션의 활동이 흐른다 — 이전에는 목록 아래 "개입" 카드 격자가 따로 있어, "이 세션이
// 왜 멈췄나"를 보려면 상세 페이지로 건너가야 했다. 모니터가 답할 질문은 그 자리에서
// 답해야 모니터다.
//
// stop 은 "지시를 전달한다"가 아니라 "지금 회수한다"이다 — 세션이 이미 죽어 하트비트를 못
// 치는 것이 stop 을 누르는 가장 흔한 상황이라, 전달을 기다리면 아무 일도 일어나지 않는다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ActivityRail } from '../../features/session-monitor/activity-rail.js';
import { SessionBoard } from '../../features/session-monitor/session-board.js';
import { useProject, useSessions } from '../../lib/queries.js';
import { PageBody, PageHeader } from '../../components/ui/primitives.js';
import type { SessionCard } from '../../features/session-monitor/types.js';

export const Route = createFileRoute('/p/$proj/sessions/')({ component: SessionMonitor });

function SessionMonitor(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const project = useProject(proj);
  // 스트립에서 고른 상태 — 목록과 레일이 **같은 조각**을 봐야 하므로 여기가 그 자리다
  const [state, setState] = useState<string | null>(null);
  const sessions = useSessions(proj, projectIdOf(project.data), state);
  const projectId = project.data?.['id'];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cards = (sessions.data?.items ?? []) as unknown as SessionCard[];
  // 고르지 않았으면 첫 줄이 초점이다 — 빈 레일은 화면 절반을 버리는 것이다
  const focused = cards.find((c) => c.id === selectedId) ?? cards[0] ?? null;

  return (
    <div className="flex min-h-[calc(100vh-var(--spacing-header))]">
      <div className="min-w-0 flex-1">
        <PageBody wide>
          <PageHeader title={t('sessions.title')} />
          <SessionBoard
            projectSlug={proj}
            projectId={typeof projectId === 'string' ? projectId : proj}
            selectedId={focused?.id}
            onSelect={setSelectedId}
            state={state}
            onStateChange={(next) => {
              setState(next);
              // 거른 뒤에도 앞서 고른 세션이 레일에 남아 있으면 화면 둘이 다른 말을 한다
              setSelectedId(null);
            }}
          />
        </PageBody>
      </div>

      {/* 오른쪽 레일 — 시안 372px. 세션이 없으면 레일도 없다(빈 패널을 세우지 않는다) */}
      {focused !== null && (
        <aside className="hidden w-[372px] shrink-0 border-l border-border bg-bg-sunken/40 px-[22px] py-7 lg:block">
          <ActivityRail projectSlug={proj} card={focused} />
        </aside>
      )}
    </div>
  );
}

/** 프로젝트 UUID — 쿼리 키가 이벤트 봉투의 project_id 와 같은 축이어야 갱신이 산다. */
function projectIdOf(project: Record<string, unknown> | undefined): string | undefined {
  const id = project?.['id'];
  return typeof id === 'string' ? id : undefined;
}
