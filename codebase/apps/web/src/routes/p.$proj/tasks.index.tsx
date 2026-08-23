// /p/:proj/tasks → S4 작업 보드 (ui-wireframes §2.4 · screens.md §2.5)
//
// **`ready` 로 직접 만들 수 없다**는 규칙이 이 화면의 형태를 정한다(FR-05). 위임 명세 4요소를
// 채우는 폼이 곧 승격 버튼이고, 미완성 항목은 backlog 칸에 "무엇이 비었는지"와 함께 남는다 —
// 클레임 가능한 작업 = 지시가 완결된 작업이라는 등식이 여기서 눈에 보여야 한다.

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DelegationForm } from '../../features/task-board/delegation-form.js';
import { leaseRemaining } from '../../features/session-monitor/format.js';
import { StatusBadge } from '../../components/status-badge.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { rows, useProject, useTasks } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import { Button, PageBody, PageHeader, Skeleton } from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/tasks/')({ component: TaskBoard });

const COLUMNS = ['backlog', 'ready', 'claimed', 'in_progress', 'done', 'blocked'] as const;

/** 만료까지 남은 초 — 음수면 이미 만료다(회수는 워커가 한다). */
function leaseSeconds(expiresAt: string): number {
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
}

function TaskBoard(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const projectId = project.data?.['id'];
  const tasks = useTasks(proj, typeof projectId === 'string' ? projectId : undefined);
  const [editing, setEditing] = useState<string | null>(null);

  const allTasks = rows(tasks.data);

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

      {tasks.isLoading && <Skeleton rows={4} />}

      {/* 6칸을 화면 폭에 욱여넣지 않는다 — 좁으면 가로로 민다. 억지로 접으면 칸의 순서
          (backlog → ready → … → done)가 깨지고, 그 순서가 이 보드의 의미 전부다 */}
      <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-2">
        {COLUMNS.map((column) => {
          const columnTasks = allTasks.filter((t) => t['status'] === column);
          return (
            <section
              key={column}
              data-testid={`column-${column}`}
              className="flex w-64 shrink-0 flex-col rounded-nerv bg-bg-sunken p-2"
            >
              <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold text-text-mute">
                <StatusBadge
                  token={(TASK_TOKEN[column] ?? 'idle') as StatusToken}
                  label={statusLabelKey('task', column)}
                />
                <span className="tabular-nums text-text-faint">{columnTasks.length}</span>
              </h2>
              <ul className="flex flex-col gap-1.5">
                {columnTasks.map((task) => (
                  <li key={String(task['id'])}>
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
                      {column === 'backlog' && task['delegation_complete'] === false && (
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
                              onClick={() => setEditing(String(task['key']))}
                              className="text-2xs text-link hover:underline"
                            >
                              {t('tasks.fill_brief')}
                            </button>
                          </div>
                        </div>
                      )}
                      {column === 'blocked' && (
                        <p className="mt-1.5 rounded-nerv-sm bg-status-danger-soft px-1.5 py-1 text-2xs text-status-danger">
                          {String(task['blocked_reason'] ?? '')}
                        </p>
                      )}
                    </article>
                  </li>
                ))}
                {columnTasks.length === 0 && (
                  <li className="px-1 py-2 text-2xs text-text-faint">{t('tasks.empty_column')}</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </PageBody>
  );
}
