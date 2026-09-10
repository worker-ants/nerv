// /p/:proj/sessions/:session — 세션 상세 · Activity 타임라인 (ui-wireframes §2.5 둘째 그림)
//
// 타임라인에 **사람의 개입이 에이전트의 행동과 같은 줄에 섞여** 보인다(steer/stop 이
// elicitation 으로 적재된다). 그게 이 화면의 값어치다 — "왜 이 세션이 방향을 틀었나"의 답이
// 다른 화면에 있으면 아무도 찾아보지 않는다.
//
// **레일과 같은 것을 그린다**(2026-09-07 · REQ-WEB-142). 2026-09-06 까지 이 화면은
// 자기만의 단순 목록이었다 — 묶기도, 실패 강조도, 원문 펼침도, 잘림 표시도, 궤적도
// 없었다. 화면이 좁으면 레일이 접히고 매뉴얼은 "그때는 상세로 들어가 보라" 고 적는데,
// 도착한 곳이 **덜 보여 주는 화면**이었다. 목록의 정본은 `ActivityTimeline` 이다.

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ActivityTimeline,
  SessionTrajectory,
} from '../../features/session-monitor/activity-timeline.js';
import { SteerPanel } from '../../features/session-monitor/steer-panel.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SESSION_TOKEN } from '../../components/status-token.js';
import { rows, useProject, useSessionDetail } from '../../lib/queries.js';
import { useCanIntervene } from '../../lib/scope.js';
import { Card, PageBody, PageHeader, SectionTitle } from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/sessions/$session')({ component: SessionDetail });

function SessionDetail(): React.JSX.Element {
  const t = useT();
  const { proj, session } = Route.useParams();
  const detail = useSessionDetail(proj, session);
  // 개입 뒤 세션 목록 무효화가 id 축이라 필요하다(4.5 §1.4). 셸이 이미 같은 키로 받아 둔
  // 값이라 요청이 늘지 않는다 — `useProject` 는 slug 로 잡히는 **해소용** 쿼리다.
  const project = useProject(proj);

  const data = detail.data ?? {};
  const state = String(data['state'] ?? '');
  const canIntervene = useCanIntervene(proj, data['user_id']);
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
          <SteerPanel
            projectSlug={proj}
            projectId={
              typeof project.data?.['id'] === 'string' ? (project.data['id'] as string) : undefined
            }
            sessionId={session}
            state={state}
            canIntervene={canIntervene}
          />
        </Card>

        {/* **위에는 한 일, 아래에 도구 로그** — 레일과 같은 순서다(REQ-WEB-124).
            이 화면의 첫 물음도 "무슨 도구를 썼나" 가 아니다 */}
        <section>
          <SectionTitle>{t('sessions.rail.trajectory')}</SectionTitle>
          <SessionTrajectory projectSlug={proj} sessionId={session} />
        </section>

        <section>
          {/* 사람의 개입이 에이전트의 행동과 **같은 줄에** 섞인다 — 세로선 하나로 묶어야
              "왜 방향을 틀었나"가 위아래로 읽힌다 */}
          <SectionTitle>{t('sessions.rail.activity')}</SectionTitle>
          <ActivityTimeline projectSlug={proj} sessionId={session} />
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
