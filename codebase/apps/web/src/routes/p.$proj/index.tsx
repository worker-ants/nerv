// /p/:proj → S2 프로젝트 개요 (ui-wireframes §2.2 · screens.md §2.3)
//
// 진입 시 `project:{id}` 룸에 join 한다(§1.4 룸 2종). join 하지 않으면 이 화면은 조용히
// 낡은 데이터를 보여준다 — 폴백 폴링이 있지만 그건 끊겼을 때의 안전망이지 기본 경로가 아니다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SessionCard } from '../../features/session-monitor/session-card.js';
import { rows, useCoverage, useEvents, useProject, useSessions } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import type { SessionCard as Card } from '../../features/session-monitor/types.js';

export const Route = createFileRoute('/p/$proj/')({ component: ProjectOverview });

function ProjectOverview(): React.JSX.Element {
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const coverage = useCoverage(proj, projectIdOf(project.data));
  const sessions = useSessions(proj, projectIdOf(project.data));
  const events = useEvents(proj, projectIdOf(project.data));
  const { joinProject } = useRealtime();

  const projectId = project.data?.['id'];
  useEffect(() => {
    if (typeof projectId !== 'string') return;
    return joinProject(projectId);
  }, [joinProject, projectId]);

  const totals = (coverage.data?.['totals'] ?? {}) as Record<string, number | null>;
  const active = (sessions.data?.items ?? []) as unknown as Card[];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">{String(project.data?.['name'] ?? proj)}</h1>
        <span className="text-sm text-text-mute">
          {String(project.data?.['description'] ?? '')}
        </span>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-md border border-border bg-bg-elev p-3">
          <h2 className="mb-2 text-sm font-semibold text-text-mute">구현 현황</h2>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-text-mute">요구사항</dt>
            <dd>{totals['total'] ?? 0}</dd>
            <dt className="text-text-mute">구현</dt>
            <dd>{totals['implemented'] ?? 0}</dd>
            <dt className="text-text-mute">검증</dt>
            <dd>{totals['verified'] ?? 0}</dd>
            {/* 두 숫자가 이 카드의 존재 이유다 — 관계 그래프가 아니면 셀 수 없다(§5.5) */}
            <dt className="text-text-mute">증적 결손</dt>
            <dd
              className={Number(totals['evidence_missing'] ?? 0) > 0 ? 'text-status-waiting' : ''}
            >
              {totals['evidence_missing'] ?? 0}
            </dd>
            <dt className="text-text-mute">빈 약속</dt>
            <dd className={Number(totals['empty_promises'] ?? 0) > 0 ? 'text-status-danger' : ''}>
              {totals['empty_promises'] ?? 0}
            </dd>
          </dl>
        </div>

        <div className="rounded-md border border-border bg-bg-elev p-3 md:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-text-mute">
            활성 세션 {active.length}개{' '}
            <Link to="/p/$proj/sessions" params={{ proj }} className="text-link underline">
              전체 ▸
            </Link>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {active.slice(0, 4).map((card) => (
              <SessionCard key={card.id} card={card} />
            ))}
            {active.length === 0 && (
              <p className="text-sm text-text-mute">지금 도는 세션이 없습니다.</p>
            )}
          </div>
        </div>
      </section>

      {/* 트리는 **셸 사이드바가 소유한다**(§1.3) — 와이어프레임 §2.2 의 좌측 열이 그것이다.
          여기서 또 그리면 같은 트리가 나란히 두 개 뜬다(문서 대조에서 발견). */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-mute">최근 이벤트</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {rows(events.data).map((e) => (
            <li key={String(e['id'])} className="flex gap-2">
              {/* 사람/에이전트 구분은 감사의 첫 질문이다(FR-16 · D-08) */}
              <span title={e['is_agent'] === true ? '에이전트' : '사람'}>
                {e['is_agent'] === true ? '🤖' : '👤'}
              </span>
              <span className="font-mono text-xs text-text-faint">{String(e['type'])}</span>
              <span className="truncate text-text-mute">{String(e['actor_name'] ?? '')}</span>
            </li>
          ))}
          {rows(events.data).length === 0 && <li className="text-text-mute">아직 없습니다.</li>}
        </ul>
      </section>
    </div>
  );
}

/** 프로젝트 UUID — 쿼리 키가 이벤트 봉투의 project_id 와 같은 축이어야 갱신이 산다. */
function projectIdOf(project: Record<string, unknown> | undefined): string | undefined {
  const id = project?.['id'];
  return typeof id === 'string' ? id : undefined;
}
