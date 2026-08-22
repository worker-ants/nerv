// /p/:proj/sessions/:session — 세션 상세 · Activity 타임라인 (ui-wireframes §2.5 둘째 그림)
//
// 타임라인에 **사람의 개입이 에이전트의 행동과 같은 줄에 섞여** 보인다(steer/stop 이
// elicitation 으로 적재된다). 그게 이 화면의 값어치다 — "왜 이 세션이 방향을 틀었나"의 답이
// 다른 화면에 있으면 아무도 찾아보지 않는다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { SteerPanel } from '../../features/session-monitor/steer-panel.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SESSION_TOKEN } from '../../components/status-token.js';
import { rows, useSessionDetail, useSessionTimeline } from '../../lib/queries.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/sessions/$session')({ component: SessionDetail });

const TYPE_ICON: Record<string, string> = {
  thought: '💭',
  action: '⚙️',
  elicitation: '🙋',
  response: '💬',
  error: '⛔',
};

function SessionDetail(): React.JSX.Element {
  const { proj, session } = Route.useParams();
  const detail = useSessionDetail(proj, session);
  const timeline = useSessionTimeline(proj, session);

  const data = detail.data ?? {};
  const state = String(data['state'] ?? '');
  const usage = (data['token_usage'] ?? {}) as Record<string, unknown>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link to="/p/$proj/sessions" params={{ proj }} className="text-sm text-link underline">
          ← 세션 보드
        </Link>
        <h1 className="text-lg font-semibold">
          {String(data['user_display_name'] ?? '')} ·{' '}
          <span className="font-mono">{String(data['hostname'] ?? '')}</span>
        </h1>
        <StatusBadge
          token={(SESSION_TOKEN[state as keyof typeof SESSION_TOKEN] ?? 'idle') as StatusToken}
          label={state}
        />
        <span className="text-xs text-text-mute">{String(data['agent_type'] ?? '')}</span>
      </header>

      <section className="grid gap-2 rounded-md border border-border bg-bg-elev p-3 text-sm md:grid-cols-3">
        <Meta label="브랜치">{String(data['branch'] ?? '—')}</Meta>
        <Meta label="워크트리">{String(data['worktree_path'] ?? '—')}</Meta>
        <Meta label="현재 작업">{String(data['current_task_key'] ?? '—')}</Meta>
        <Meta label="diff">
          +{String(data['diff_added'] ?? 0)} / -{String(data['diff_removed'] ?? 0)}
        </Meta>
        <Meta label="모델">{String(data['model'] ?? '—')}</Meta>
        <Meta label="토큰">{String(usage['total'] ?? '—')}</Meta>
      </section>

      <section className="rounded-md border border-border bg-bg-elev p-3">
        <h2 className="mb-2 text-sm font-semibold text-text-mute">개입</h2>
        <SteerPanel projectSlug={proj} sessionId={session} state={state} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-mute">Activity</h2>
        <ol className="flex flex-col gap-1">
          {rows(timeline.data).map((item) => (
            <li
              key={String(item['id'])}
              className="flex gap-2 rounded border border-border bg-bg-elev px-2 py-1 text-sm"
            >
              <span aria-hidden="true">{TYPE_ICON[String(item['type'])] ?? '·'}</span>
              <span className="font-mono text-xs text-text-faint">#{String(item['seq'])}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{String(item['title'] ?? item['type'])}</span>
                {item['body_md'] !== null && item['body_md'] !== undefined && (
                  <span className="ml-1 text-text-mute">{String(item['body_md'])}</span>
                )}
              </span>
              {item['tool_name'] !== null && item['tool_name'] !== undefined && (
                <span className="font-mono text-xs text-text-faint">
                  {String(item['tool_name'])}
                </span>
              )}
            </li>
          ))}
          {rows(timeline.data).length === 0 && (
            <li className="text-sm text-text-mute">아직 활동이 없습니다.</li>
          )}
        </ol>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-mute">클레임 이력</h2>
        <ul className="flex flex-col gap-1 text-xs">
          {rows(data['claims']).map((claim) => (
            <li key={String(claim['id'])} className="flex gap-2">
              <span className="font-mono">{String(claim['task_key'])}</span>
              <span>{String(claim['task_title'])}</span>
              <span className="ml-auto text-text-faint">{String(claim['status'])}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text-xs text-text-faint">{label}</div>
      <div>{children}</div>
    </div>
  );
}
