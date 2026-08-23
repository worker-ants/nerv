// /p/:proj/sessions/:session — 세션 상세 · Activity 타임라인 (ui-wireframes §2.5 둘째 그림)
//
// 타임라인에 **사람의 개입이 에이전트의 행동과 같은 줄에 섞여** 보인다(steer/stop 이
// elicitation 으로 적재된다). 그게 이 화면의 값어치다 — "왜 이 세션이 방향을 틀었나"의 답이
// 다른 화면에 있으면 아무도 찾아보지 않는다.

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SteerPanel } from '../../features/session-monitor/steer-panel.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SESSION_TOKEN } from '../../components/status-token.js';
import { rows, useSessionDetail, useSessionTimeline } from '../../lib/queries.js';
import {
  Card,
  EmptyState,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
} from '../../components/ui/primitives.js';
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
  const t = useT();
  const { proj, session } = Route.useParams();
  const detail = useSessionDetail(proj, session);
  const timeline = useSessionTimeline(proj, session);

  const data = detail.data ?? {};
  const state = String(data['state'] ?? '');
  const usage = (data['token_usage'] ?? {}) as Record<string, unknown>;

  return (
    <PageBody>
      <Link
        to="/p/$proj/sessions"
        params={{ proj }}
        className="mb-2 inline-block text-xs text-text-mute hover:text-text"
      >
        {t('session.back_to_board')}
      </Link>
      <PageHeader
        title={
          <>
            {String(data['user_display_name'] ?? '')}{' '}
            <span className="font-mono text-lg text-text-mute">
              {String(data['hostname'] ?? '')}
            </span>
          </>
        }
        meta={
          <>
            <StatusBadge
              token={(SESSION_TOKEN[state as keyof typeof SESSION_TOKEN] ?? 'idle') as StatusToken}
              label={t(statusLabelKey('session', state))}
            />
            <span className="text-xs text-text-mute">{String(data['agent_type'] ?? '')}</span>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Card>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Meta label={t('session.branch')}>{String(data['branch'] ?? '—')}</Meta>
            <Meta label={t('session.meta.worktree')}>{String(data['worktree_path'] ?? '—')}</Meta>
            <Meta label={t('session.meta.current_task')}>
              {String(data['current_task_key'] ?? '—')}
            </Meta>
            <Meta label="diff">
              +{String(data['diff_added'] ?? 0)} / -{String(data['diff_removed'] ?? 0)}
            </Meta>
            <Meta label={t('session.meta.model')}>{String(data['model'] ?? '—')}</Meta>
            <Meta label={t('session.meta.tokens')}>{String(usage['total'] ?? '—')}</Meta>
          </dl>
        </Card>

        <Card>
          <SectionTitle>{t('sessions.intervene')}</SectionTitle>
          <SteerPanel projectSlug={proj} sessionId={session} state={state} />
        </Card>

        <section>
          {/* 사람의 개입이 에이전트의 행동과 **같은 줄에** 섞인다 — 세로선 하나로 묶어야
              "왜 방향을 틀었나"가 위아래로 읽힌다 */}
          <SectionTitle>Activity</SectionTitle>
          <ol className="flex flex-col border-l border-border pl-3">
            {rows(timeline.data).map((item) => (
              <li key={String(item['id'])} className="relative py-1.5 text-sm">
                <span
                  aria-hidden="true"
                  className="absolute -left-[1.05rem] text-xs"
                  style={{ top: '0.4rem' }}
                >
                  {TYPE_ICON[String(item['type'])] ?? '·'}
                </span>
                <div className="flex items-baseline gap-2">
                  <Mono>#{String(item['seq'])}</Mono>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{String(item['title'] ?? item['type'])}</span>
                    {item['body_md'] !== null && item['body_md'] !== undefined && (
                      <span className="ml-1 text-text-mute">{String(item['body_md'])}</span>
                    )}
                  </span>
                  {item['tool_name'] !== null && item['tool_name'] !== undefined && (
                    <Mono>{String(item['tool_name'])}</Mono>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {rows(timeline.data).length === 0 && (
            <EmptyState icon="·" title={t('session.no_activity')} />
          )}
        </section>

        <section>
          <SectionTitle>{t('session.claim_history')}</SectionTitle>
          <ul className="flex flex-col">
            {rows(data['claims']).map((claim) => (
              <li
                key={String(claim['id'])}
                className="flex gap-2 border-b border-border py-1.5 text-xs last:border-0"
              >
                <span className="font-mono">{String(claim['task_key'])}</span>
                <span className="truncate">{String(claim['task_title'])}</span>
                <span className="ml-auto shrink-0 text-text-faint">{String(claim['status'])}</span>
              </li>
            ))}
            {rows(data['claims']).length === 0 && (
              <li className="py-1.5 text-sm text-text-faint">{t('common.none')}</li>
            )}
          </ul>
        </section>
      </div>
    </PageBody>
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
      <dt className="mb-0.5 text-2xs font-medium tracking-wide text-text-faint uppercase">
        {label}
      </dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
