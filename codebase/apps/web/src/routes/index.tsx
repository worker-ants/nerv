// / → S1 홈 대시보드 (ui-wireframes §2.1 · screens.md §2.2)
//
// **오늘 할 일 숫자**가 이 화면의 중심이다. "지금 나를 기다리는 것"이 몇 개인지 한 줄로
// 보이지 않으면 승인은 조용히 늦어지고(P4), 그 지연이 에이전트를 멈춰 세운다.
//
// 그래서 숫자는 크고, **누를 수 있다.** 숫자만 보여주고 목록으로 가는 길을 주지 않으면
// 사람은 숫자를 본 다음 스스로 메뉴를 찾아야 한다.

import { eventLabelKey } from '@nerv/schema';
import { useT } from '../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ApprovalCard } from '../features/inbox/approval-card.js';
import { relativeTime } from '../lib/format.js';
import { rows, useInbox, useMe, useNotifications, useProjects } from '../lib/queries.js';
import { primaryMembership } from '../lib/session.js';
import {
  Card,
  EmptyState,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,

  SummaryStrip,
} from '../components/ui/primitives.js';

export const Route = createFileRoute('/')({ component: HomeScreen });

function HomeScreen(): React.JSX.Element {
  const t = useT();
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
        title={
          me.data === undefined
            ? t('home.title_anon')
            : t('home.title', { name: me.data.display_name })
        }
        description={t('home.lead')}
      />

      {/* **한 줄이다**(2026-08-23 재검토). 상자 셋으로 두면 셋 다 같은 무게로 읽히고,
          정작 "지금 나를 기다리는 게 몇 건인가"는 세 상자를 다 본 뒤에야 답이 나온다.
          숫자는 누를 수 있다 — 보고 갈 데가 없으면 그냥 표시일 뿐이다(§1.5) */}
      <SummaryStrip
        data-testid="today-strip"
        className="mb-8"
        metrics={[
          {
            label: t('home.stat.approvals'),
            value: approvals.length,
            tone: 'default',
            href: '/inbox',
          },
          {
            label: t('home.stat.questions'),
            value: questions.length,
            tone: questions.length > 0 ? 'waiting' : 'default',
            href: '/inbox',
          },
          { label: t('home.stat.projects'), value: projectRows.length },
        ]}
      />

      <section className="mb-8">
        <SectionTitle
          action={
            cards.length > 5 ? (
              <Link to="/inbox" className="text-xs text-link hover:underline">
                {t('home.inbox_all', { count: cards.length })}
              </Link>
            ) : undefined
          }
        >
          {t('home.waiting_on_you')}
        </SectionTitle>
        {inbox.isLoading && <Skeleton rows={2} />}
        {!inbox.isLoading && cards.length === 0 && (
          <EmptyState
            icon="✓"
            title={t('home.nothing_waiting')}
            hint={
              <Link to="/inbox" search={{ state: 'decided' }} className="text-link hover:underline">
                {t('home.see_decided')}
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
        <SectionTitle>{t('home.my_projects')}</SectionTitle>
        {projects.isLoading && <Skeleton rows={2} />}
        {!projects.isLoading && projectRows.length === 0 && (
          <EmptyState icon="◇" title={t('home.no_projects')} />
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
                        {t('home.active_sessions')} <span className="text-text">{active}</span>
                      </span>
                      <span className={pending > 0 ? 'text-status-action' : undefined}>
                        {t('home.pending_approvals')} <span className="font-medium">{pending}</span>
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
              {t('common.all')}
            </Link>
          }
        >
          {t('home.recent_notifications')}
        </SectionTitle>
        <ul className="flex flex-col">
          {rows(notifications.data)
            .slice(0, 5)
            .map((n) => (
              <li
                key={String(n['id'])}
                className="flex items-center gap-2 border-b border-border py-1.5 text-sm last:border-0"
              >
                <span className="truncate">{t(eventLabelKey(String(n['event_type'] ?? '')))}</span>
                <Mono className="truncate">
                  {String(n['spec_key'] ?? n['task_key'] ?? n['project_slug'] ?? '')}
                </Mono>
                <span className="ml-auto shrink-0 text-xs text-text-faint">
                  {relativeTime(t, typeof n['occurred_at'] === 'string' ? n['occurred_at'] : null)}
                </span>
              </li>
            ))}
          {rows(notifications.data).length === 0 && (
            <li className="py-1.5 text-sm text-text-mute">{t('home.no_notifications')}</li>
          )}
        </ul>
      </section>
    </PageBody>
  );
}

