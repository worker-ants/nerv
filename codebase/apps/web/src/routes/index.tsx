// / → S1 홈 대시보드 (ui-wireframes §2.1 · screens.md §2.2)
//
// **오늘 할 일 숫자**가 이 화면의 중심이다. "지금 나를 기다리는 것"이 몇 개인지 한 줄로
// 보이지 않으면 승인은 조용히 늦어지고(P4), 그 지연이 에이전트를 멈춰 세운다.
//
// 그래서 숫자는 크고, **누를 수 있다.** 숫자만 보여주고 목록으로 가는 길을 주지 않으면
// 사람은 숫자를 본 다음 스스로 메뉴를 찾아야 한다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { ApprovalCard } from '../features/inbox/approval-card.js';
import { eventLabel } from '../lib/event-label.js';
import { relativeTime } from '../lib/format.js';
import { rows, useInbox, useMe, useNotifications, useProjects } from '../lib/queries.js';
import { primaryMembership } from '../lib/session.js';
import { cn } from '../lib/utils.js';
import {
  Card,
  EmptyState,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,
} from '../components/ui/primitives.js';

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
  const projectRows = rows(projects.data);

  return (
    <PageBody>
      <PageHeader
        title={me.data === undefined ? '홈' : `${me.data.display_name}님, 오늘 할 일입니다`}
        description="여기 있는 것만 당신을 기다립니다. 나머지는 에이전트가 진행 중입니다."
      />

      <section data-testid="today-strip" className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat
          label="승인 대기"
          value={approvals.length}
          tone="action"
          to="/inbox"
          hint="내가 결정해야 하는 것"
        />
        <Stat
          label="답변 대기 질문"
          value={questions.length}
          tone="waiting"
          to="/inbox"
          hint="에이전트가 막혀 물어본 것"
        />
        <Stat
          label="참여 프로젝트"
          value={projectRows.length}
          tone="idle"
          hint="내가 멤버인 프로젝트"
        />
      </section>

      <section className="mb-8">
        <SectionTitle
          action={
            cards.length > 5 ? (
              <Link to="/inbox" className="text-xs text-link hover:underline">
                승인함 전체 {cards.length}건 ▸
              </Link>
            ) : undefined
          }
        >
          내 결정을 기다리는 항목
        </SectionTitle>
        {inbox.isLoading && <Skeleton rows={2} />}
        {!inbox.isLoading && cards.length === 0 && (
          <EmptyState
            icon="✓"
            title="지금 당신을 기다리는 항목이 없습니다."
            hint={
              <Link to="/inbox" search={{ state: 'decided' }} className="text-link hover:underline">
                최근 처리한 항목 보기 ▸
              </Link>
            }
          />
        )}
        <ul className="flex flex-col gap-2">
          {cards.slice(0, 5).map((card) => (
            <li key={String(card['id'])}>
              <ApprovalCard card={card} compact />
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <SectionTitle>내 프로젝트</SectionTitle>
        {projects.isLoading && <Skeleton rows={2} />}
        {!projects.isLoading && projectRows.length === 0 && (
          <EmptyState icon="◇" title="참여 중인 프로젝트가 없습니다." />
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {projectRows.map((project) => {
            const pending = Number(project['pending_approvals'] ?? 0);
            const active = Number(project['active_sessions'] ?? 0);
            return (
              <li key={String(project['id'])}>
                <Link to="/p/$proj" params={{ proj: String(project['slug']) }} className="block">
                  <Card interactive padded={false} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{String(project['name'])}</span>
                      <Mono>{String(project['slug'])}</Mono>
                    </div>
                    {/* 숫자가 0일 때도 자리를 지운다 — "활성 세션 0" 은 정보가 아니라 소음이다 */}
                    <div className="mt-1 flex gap-3 text-xs text-text-mute">
                      <span>
                        활성 세션 <span className="text-text">{active}</span>
                      </span>
                      <span className={pending > 0 ? 'text-status-action' : undefined}>
                        승인 대기 <span className="font-medium">{pending}</span>
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <SectionTitle
          action={
            <Link to="/notifications" className="text-xs text-link hover:underline">
              전체 ▸
            </Link>
          }
        >
          최근 알림
        </SectionTitle>
        <ul className="flex flex-col">
          {rows(notifications.data)
            .slice(0, 5)
            .map((n) => (
              <li
                key={String(n['id'])}
                className="flex items-center gap-2 border-b border-border py-1.5 text-sm last:border-0"
              >
                <span className="truncate">{eventLabel(String(n['event_type'] ?? ''))}</span>
                <Mono className="truncate">
                  {String(n['spec_key'] ?? n['task_key'] ?? n['project_slug'] ?? '')}
                </Mono>
                <span className="ml-auto shrink-0 text-xs text-text-faint">
                  {relativeTime(typeof n['occurred_at'] === 'string' ? n['occurred_at'] : null)}
                </span>
              </li>
            ))}
          {rows(notifications.data).length === 0 && (
            <li className="py-1.5 text-sm text-text-mute">알림이 없습니다.</li>
          )}
        </ul>
      </section>
    </PageBody>
  );
}

/**
 * 오늘 할 일 숫자. 링크가 있으면 카드 전체가 눌린다 — 숫자를 본 사람의 다음 동작은
 * 언제나 "그래서 그게 뭔데"이고, 그 길이 카드 안에 있어야 한다.
 */
function Stat({
  label,
  value,
  tone,
  hint,
  to,
}: {
  label: string;
  value: number;
  tone: 'action' | 'waiting' | 'idle';
  hint: string;
  to?: '/inbox';
}): React.JSX.Element {
  const toneClass =
    tone === 'action'
      ? 'text-status-action'
      : tone === 'waiting'
        ? 'text-status-waiting'
        : 'text-text';
  const body = (
    <Card interactive={to !== undefined} padded={false} className="px-4 py-3">
      <div className="text-xs font-medium text-text-mute">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-2xl font-semibold tabular-nums',
          value === 0 ? 'text-text-faint' : toneClass,
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-2xs text-text-faint">{hint}</div>
    </Card>
  );
  return to === undefined ? (
    body
  ) : (
    <Link to={to} className="block">
      {body}
    </Link>
  );
}
