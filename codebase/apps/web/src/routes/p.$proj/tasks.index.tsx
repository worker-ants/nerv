// /p/:proj/tasks → S4 작업 보드 (ui-wireframes §2.4 · screens.md §2.5)
//
// **`ready` 로 직접 만들 수 없다**는 규칙이 이 화면의 형태를 정한다(FR-05). 위임 명세 4요소를
// 채우는 폼이 곧 승격 버튼이고, 미완성 항목은 backlog 칸에 "무엇이 비었는지"와 함께 남는다 —
// 클레임 가능한 작업 = 지시가 완결된 작업이라는 등식이 여기서 눈에 보여야 한다.

import { statusLabelKey, TASK_DONE_WINDOW_DAYS } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DelegationForm } from '../../features/task-board/delegation-form.js';
import { leaseRemaining } from '../../features/session-monitor/format.js';
import { StatusBadge } from '../../components/status-badge.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { useProject, useTaskLane } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Button, PageBody, PageHeader, Skeleton } from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/tasks/')({ component: TaskBoard });

/**
 * 레인 — screens.md §2.5 정본. `backlog` 는 레인이 아니라 **필터**이고 `blocked` 는
 * 하단 접이식이다. 둘 다 "지금 흐르고 있는 일"이 아니라서 가로줄을 차지하면 안 된다.
 */
const LANES = ['ready', 'claimed', 'in_progress', 'in_review', 'done'] as const;

/** 레인 이름은 `task_status` 어휘다 — 토큰·라벨 표를 그대로 색인한다 */
type Lane = keyof typeof TASK_TOKEN;

/** 만료까지 남은 초 — 음수면 이미 만료다(회수는 워커가 한다). */
function leaseSeconds(expiresAt: string): number {
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
}

function TaskBoard(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const projectId = project.data?.['id'];
  const [editing, setEditing] = useState<string | null>(null);
  // 백로그와 보관은 **끄고 시작한다** — 스펙 아카이브(REQ-API-022)와 같은 규약이다.
  const [showBacklog, setShowBacklog] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const id = typeof projectId === 'string' ? projectId : undefined;

  const lanes = [...(showBacklog ? (['backlog'] as const) : []), ...LANES];

  return (
    <PageBody wide>
      <PageHeader
        title={t('tasks.title')}
        description={
          <>
            {t('tasks.lead_pre')} <code className="font-mono text-text">ready</code>
            {t('tasks.lead_post')}
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            {t('tasks.new')}
          </Button>
        }
      />

      {editing !== null && (
        <div className="mb-4">
          <DelegationForm
            projectSlug={proj}
            taskKey={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        </div>
      )}

      {/* 필터는 보드 위에 둔다 — 레인 머리에 붙이면 어느 레인의 설정인지 헷갈리고,
          `보관 보기`는 done 레인만 바꾸지만 `백로그 보기`는 레인 자체를 늘린다 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterToggle
          testId="filter-backlog"
          on={showBacklog}
          onClick={() => setShowBacklog(!showBacklog)}
          label={t('tasks.filter.backlog')}
        />
        <FilterToggle
          testId="filter-archived"
          on={showArchived}
          onClick={() => setShowArchived(!showArchived)}
          label={t('tasks.filter.archived')}
          title={t('tasks.filter.archived_title', { days: TASK_DONE_WINDOW_DAYS })}
        />
      </div>

      {/* 레인을 화면 폭에 욱여넣지 않는다 — 좁으면 가로로 민다. 억지로 접으면 순서
          (ready → … → done)가 깨지고, 그 순서가 이 보드의 의미 전부다 */}
      <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-2">
        {lanes.map((lane) => (
          <Lane
            key={lane}
            proj={proj}
            projectId={id}
            lane={lane}
            includeArchived={showArchived}
            onEdit={setEditing}
          />
        ))}
      </div>

      {/* `blocked` 는 하단 접이식이다(§2.5) — 흐르고 있는 일이 아니라서 가로줄을
          차지하면 안 되지만, 감춰 두면 막힌 일을 아무도 안 본다 */}
      <BlockedLane proj={proj} projectId={id} onEdit={setEditing} />
    </PageBody>
  );
}

/** 필터 토글 — 켜짐이 **한눈에** 보여야 한다. 색만으로 구분하지 않는다(REQ-WEB-033) */
function FilterToggle({
  testId,
  on,
  onClick,
  label,
  title,
}: {
  testId: string;
  on: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      onClick={onClick}
      {...(title === undefined ? {} : { title })}
      className={cn(
        'rounded-nerv-sm border px-2 py-1 text-2xs transition-colors',
        on
          ? 'border-border-strong bg-bg-elev font-medium text-text'
          : 'border-border text-text-mute hover:text-text',
      )}
    >
      {on ? '✓ ' : ''}
      {label}
    </button>
  );
}

/** 막힘 레인 — 접이식. 건수는 접힌 채로도 보인다. */
function BlockedLane({
  proj,
  projectId,
  onEdit,
}: {
  proj: string;
  projectId: string | undefined;
  onEdit: (key: string) => void;
}): React.JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const query = useTaskLane(proj, projectId, 'blocked');
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="mt-4" data-testid="lane-blocked">
      <button
        type="button"
        data-testid="blocked-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-semibold text-status-danger"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        {t('tasks.blocked_lane', { count: items.length })}
      </button>
      {open && (
        <ul className="mt-2 grid gap-1.5 md:grid-cols-3">
          {items.map((task) => (
            <li key={String(task['id'])}>
              <TaskCard proj={proj} task={task} lane="blocked" onEdit={onEdit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 레인 하나 — **자기 질의를 자기가 갖는다**(queries.ts `useTaskLane` 주석) */
function Lane({
  proj,
  projectId,
  lane,
  includeArchived,
  onEdit,
}: {
  proj: string;
  projectId: string | undefined;
  lane: Lane;
  includeArchived: boolean;
  onEdit: (key: string) => void;
}): React.JSX.Element {
  const t = useT();
  // 창은 done 에만 의미가 있다 — 다른 레인에 실어 보내면 쿼리 키만 둘로 갈라진다
  const query = useTaskLane(proj, projectId, lane, {
    includeArchived: lane === 'done' && includeArchived,
  });
  const items = query.data?.items ?? [];
  const more = query.data?.next_cursor !== null && query.data?.next_cursor !== undefined;

  return (
            <section
              data-testid={`column-${lane}`}
              className="flex w-64 shrink-0 flex-col rounded-nerv bg-bg-sunken p-2"
            >
              <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold text-text-mute">
                {/* `statusLabelKey` 는 **키**를 준다 — 번역을 거치지 않으면 화면에
                    `status.task.ready` 가 그대로 찍힌다(실측 2026-08-23) */}
                <StatusBadge
                  token={TASK_TOKEN[lane] as StatusToken}
                  label={t(statusLabelKey('task', lane))}
                />
                {/* 한 페이지를 채웠으면 **뒤에 더 있다**는 뜻이다 — 그냥 30 이라고
                    적으면 사람은 그것이 전부라고 읽는다 */}
                <span className="tabular-nums text-text-faint">
                  {items.length}
                  {more ? '+' : ''}
                </span>
              </h2>
              {/* 로딩은 화면 골격으로 — 스피너 단독 금지(§1.5). 레인마다 따로 부르므로
                  빠른 레인이 먼저 차고 느린 레인만 골격으로 남는다 */}
              {query.isLoading && <Skeleton rows={3} className="[&>div]:h-12" />}
              <ul className="flex flex-col gap-1.5">
                {items.map((task) => (
                  <li key={String(task['id'])}>
                    <TaskCard proj={proj} task={task} lane={lane} onEdit={onEdit} />
                  </li>
                ))}
                {items.length === 0 && !query.isLoading && (
                  <li className="px-1 py-2 text-2xs text-text-faint">{t('tasks.empty_column')}</li>
                )}
              </ul>
              {more && (
                // 커서가 남았다는 사실만 알린다 — 여기서 다음 장을 이어 붙이는 것은
                // 실시간 무효화와 얽히므로 목록 화면(§2.5 필터)의 몫으로 둔다
                <p className="px-1 pt-1 text-2xs text-text-faint">{t('tasks.more')}</p>
              )}
            </section>
  );
}

/**
 * 작업 카드. 레인이 이미 상태를 말하므로 카드에 상태 배지를 또 붙이지 않는다 —
 * 붙이면 한 레인에 같은 배지가 열 개 세로로 늘어선다.
 */
function TaskCard({
  proj,
  task,
  lane,
  onEdit,
}: {
  proj: string;
  task: Record<string, unknown>;
  lane: Lane;
  onEdit: (key: string) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <article className="rounded-nerv-sm border border-border bg-bg-elev px-2.5 py-2 text-sm transition-colors hover:border-border-strong">
      {/* 칸이 이미 상태를 말한다 — 카드마다 같은 배지를 또 붙이면
          칸 하나에 같은 배지 열 개가 세로로 늘어선다 */}
      <Link
        to="/p/$proj/tasks/$task"
        params={{ proj, task: String(task['key']) }}
        className="block font-medium hover:text-link"
      >
        {String(task['title'])}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-text-faint">
        <span className="font-mono">{String(task['key'])}</span>
        {task['spec_key'] !== null && task['spec_key'] !== undefined && (
          <span className="font-mono">{String(task['spec_key'])}</span>
        )}
        {task['basis_superseded'] === true && (
          // 기준 버전이 지나갔다 — 재브리핑 신호(agent-integration §2.4)
          <span className="text-status-waiting">{t('tasks.basis_superseded')}</span>
        )}
        {/* 리스 잔여는 서버 시각 기준으로 클라이언트가 센다(§1.4).
            2분 미만은 호박색 — 곧 회수된다는 뜻이고, 그때 화면이 조용하면
            사람은 작업이 사라진 이유를 모른다(REQ-WEB-017 · D-04) */}
        {typeof task['lease_expires_at'] === 'string' && (
          <span
            data-testid="lease-countdown"
            className={cn(
              'font-mono',
              leaseSeconds(task['lease_expires_at']) < 120
                ? 'font-medium text-status-waiting'
                : 'text-text-faint',
            )}
          >
            {t('tasks.lease', {
              remaining: leaseRemaining(t, leaseSeconds(task['lease_expires_at'])),
            })}
          </span>
        )}
      </div>
      {task['rebrief_required_at'] !== null &&
        task['rebrief_required_at'] !== undefined && (
          // 036 — 기준 버전이 지나갔다는 사실과 어디로 가야 하는지를 함께 준다
          <Link
            to="/p/$proj/tasks/$task"
            params={{ proj, task: String(task['key']) }}
            data-testid="rebrief-badge"
            className="mt-1.5 block rounded-nerv-sm bg-status-waiting-soft px-1.5 py-1 text-2xs text-status-waiting hover:underline"
          >
            {t('tasks.rebrief', {
              version: String(task['basis_version_no'] ?? '?'),
            })}
          </Link>
        )}
      {lane === 'backlog' && task['delegation_complete'] === false && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          {/* **무엇이 비었는지**를 카드가 말한다(REQ-WEB-016). "채우세요"만
              있으면 사람은 폼을 열고서야 무엇이 빠졌는지 알게 된다 */}
          <p data-testid="ready-blocked" className="text-2xs text-status-waiting">
            {t('tasks.ready_blocked')}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Button size="sm" disabled title={t('tasks.ready_blocked_title')}>
              {t('tasks.ready_transition')}
            </Button>
            <button
              type="button"
              onClick={() => onEdit(String(task['key']))}
              className="text-2xs text-link hover:underline"
            >
              {t('tasks.fill_brief')}
            </button>
          </div>
        </div>
      )}
      {lane === 'blocked' && (
        <p className="mt-1.5 rounded-nerv-sm bg-status-danger-soft px-1.5 py-1 text-2xs text-status-danger">
          {String(task['blocked_reason'] ?? '')}
        </p>
      )}
    </article>
  );
}

