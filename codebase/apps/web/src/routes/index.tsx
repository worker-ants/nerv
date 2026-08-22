// / → S1 홈 대시보드 (ui-wireframes §2.1 · screens.md §2.2)
//
// **오늘 할 일 숫자**가 이 화면의 중심이다. "지금 나를 기다리는 것"이 몇 개인지 한 줄로
// 보이지 않으면 승인은 조용히 늦어지고(P4), 그 지연이 에이전트를 멈춰 세운다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { ApprovalCard } from '../features/inbox/approval-card.js';
import { rows, useInbox, useMe, useNotifications, useProjects } from '../lib/queries.js';
import { primaryMembership } from '../lib/session.js';

export const Route = createFileRoute('/')({ component: HomeScreen });

function HomeScreen(): React.JSX.Element {
  const me = useMe();
  const inbox = useInbox();
  const notifications = useNotifications();
  const orgSlug = me.data === undefined ? null : (primaryMembership(me.data)?.org_slug ?? null);
  const projects = useProjects(orgSlug);

  const cards = rows(inbox.data);
  const approvals = cards.filter((c) => c['subject_type'] !== 'question');
  const questions = cards.filter((c) => c['subject_type'] === 'question');

  return (
    <div className="flex flex-col gap-6">
      <section data-testid="today-strip" className="flex gap-4">
        <Stat label="승인 대기" value={approvals.length} tone="action" />
        <Stat label="답변 대기 질문" value={questions.length} tone="waiting" />
        <Stat label="참여 프로젝트" value={rows(projects.data).length} tone="idle" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-mute">내 결정을 기다리는 항목</h2>
        {inbox.isLoading && <div className="h-16 rounded bg-bg-sunken" />}
        {!inbox.isLoading && cards.length === 0 && (
          <div className="rounded-md border border-border bg-bg-elev p-4 text-sm text-text-mute">
            지금 당신을 기다리는 항목이 없습니다.{' '}
            <Link to="/inbox" search={{ state: 'decided' }} className="text-link underline">
              최근 처리한 항목 보기 ▸
            </Link>
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {cards.slice(0, 5).map((card) => (
            <li key={String(card['id'])}>
              <ApprovalCard card={card} compact />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-mute">내 프로젝트</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows(projects.data).map((project) => (
            <li key={String(project['id'])}>
              <Link
                to="/p/$proj"
                params={{ proj: String(project['slug']) }}
                className="block rounded-md border border-border bg-bg-elev p-3 hover:border-border-strong"
              >
                <div className="font-medium">{String(project['name'])}</div>
                <div className="text-sm text-text-mute">
                  활성 세션 {String(project['active_sessions'] ?? 0)} · 승인 대기{' '}
                  {String(project['pending_approvals'] ?? 0)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-mute">최근 알림</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {rows(notifications.data)
            .slice(0, 5)
            .map((n) => (
              <li key={String(n['id'])} className="flex gap-2 text-text-mute">
                <span className="font-mono text-xs">{String(n['event_type'] ?? '')}</span>
                <span>{String(n['spec_key'] ?? n['task_key'] ?? n['project_slug'] ?? '')}</span>
              </li>
            ))}
          {rows(notifications.data).length === 0 && (
            <li className="text-text-mute">알림이 없습니다.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'action' | 'waiting' | 'idle';
}): React.JSX.Element {
  const toneClass =
    tone === 'action'
      ? 'text-status-action'
      : tone === 'waiting'
        ? 'text-status-waiting'
        : 'text-text-mute';
  return (
    <div className="rounded-md border border-border bg-bg-elev px-4 py-3">
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="text-sm text-text-mute">{label}</div>
    </div>
  );
}
