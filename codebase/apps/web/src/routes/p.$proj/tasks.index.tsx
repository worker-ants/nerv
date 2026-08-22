// /p/:proj/tasks → S4 작업 보드 (ui-wireframes §2.4 · screens.md §2.5)
//
// **`ready` 로 직접 만들 수 없다**는 규칙이 이 화면의 형태를 정한다(FR-05). 위임 명세 4요소를
// 채우는 폼이 곧 승격 버튼이고, 미완성 항목은 backlog 칸에 "무엇이 비었는지"와 함께 남는다 —
// 클레임 가능한 작업 = 지시가 완결된 작업이라는 등식이 여기서 눈에 보여야 한다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DelegationForm } from '../../features/task-board/delegation-form.js';
import { leaseRemaining } from '../../features/session-monitor/format.js';
import { StatusBadge } from '../../components/status-badge.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { rows, useProject, useTasks } from '../../lib/queries.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/tasks/')({ component: TaskBoard });

const COLUMNS = ['backlog', 'ready', 'claimed', 'in_progress', 'done', 'blocked'] as const;

/** 만료까지 남은 초 — 음수면 이미 만료다(회수는 워커가 한다). */
function leaseSeconds(expiresAt: string): number {
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
}
const COLUMN_LABEL: Record<string, string> = {
  backlog: '백로그',
  ready: '준비됨',
  claimed: '클레임',
  in_progress: '진행 중',
  done: '완료',
  blocked: '막힘',
};

function TaskBoard(): React.JSX.Element {
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const projectId = project.data?.['id'];
  const tasks = useTasks(proj, typeof projectId === 'string' ? projectId : undefined);
  const [editing, setEditing] = useState<string | null>(null);

  const allTasks = rows(tasks.data);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">작업 보드</h1>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded bg-status-action px-2 py-1 text-sm text-white"
        >
          + 새 작업
        </button>
      </header>

      {editing !== null && (
        <DelegationForm
          projectSlug={proj}
          taskKey={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}

      <div className="grid gap-3 overflow-x-auto md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((column) => {
          const columnTasks = allTasks.filter((t) => t['status'] === column);
          return (
            <section key={column} data-testid={`column-${column}`} className="min-w-48">
              <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-text-mute">
                {COLUMN_LABEL[column]}
                <span className="text-xs text-text-faint">{columnTasks.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {columnTasks.map((task) => (
                  <li key={String(task['id'])}>
                    <article className="rounded-md border border-border bg-bg-elev p-2 text-sm">
                      <div className="flex items-center gap-1">
                        <StatusBadge
                          token={(TASK_TOKEN[column] ?? 'idle') as StatusToken}
                          label={COLUMN_LABEL[column] ?? column}
                        />
                        <Link
                          to="/p/$proj/tasks/$task"
                          params={{ proj, task: String(task['key']) }}
                          className="min-w-0 flex-1 truncate font-medium"
                        >
                          {String(task['title'])}
                        </Link>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-mute">
                        <span className="font-mono">{String(task['key'])}</span>
                        {task['spec_key'] !== null && task['spec_key'] !== undefined && (
                          <span>{String(task['spec_key'])}</span>
                        )}
                        {task['basis_superseded'] === true && (
                          // 기준 버전이 지나갔다 — 재브리핑 신호(agent-integration §2.4)
                          <span className="text-status-waiting">기준 버전 갱신됨</span>
                        )}
                        {task['rebrief_required_at'] !== null &&
                          task['rebrief_required_at'] !== undefined && (
                            // 036 — 기준 버전이 지나갔다는 사실과 어디로 가야 하는지를 함께 준다
                            <Link
                              to="/p/$proj/tasks/$task"
                              params={{ proj, task: String(task['key']) }}
                              data-testid="rebrief-badge"
                              className="text-status-waiting underline"
                            >
                              재브리핑 필요 — v{String(task['basis_version_no'] ?? '?')} → 최신
                            </Link>
                          )}
                        {/* 리스 잔여는 서버 시각 기준으로 클라이언트가 센다(§1.4).
                            2분 미만은 호박색 — 곧 회수된다는 뜻이고, 그때 화면이 조용하면
                            사람은 작업이 사라진 이유를 모른다(REQ-WEB-017 · D-04) */}
                        {typeof task['lease_expires_at'] === 'string' && (
                          <span
                            data-testid="lease-countdown"
                            className={
                              leaseSeconds(task['lease_expires_at']) < 120
                                ? 'text-status-waiting'
                                : 'text-text-mute'
                            }
                          >
                            리스 {leaseRemaining(leaseSeconds(task['lease_expires_at']))}
                          </span>
                        )}
                      </div>
                      {column === 'backlog' && task['delegation_complete'] === false && (
                        <div className="mt-1">
                          {/* **무엇이 비었는지**를 카드가 말한다(REQ-WEB-016). "채우세요"만
                              있으면 사람은 폼을 열고서야 무엇이 빠졌는지 알게 된다 */}
                          <p data-testid="ready-blocked" className="text-xs text-status-waiting">
                            ready 불가 — 위임 명세 4요소 미완성
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              type="button"
                              disabled
                              title="위임 명세 4요소(목표·산출물·도구/출처·경계)가 채워져야 ready 로 갑니다"
                              className="cursor-not-allowed rounded border border-border px-1.5 py-0.5 text-xs opacity-50"
                            >
                              ready 전이
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(String(task['key']))}
                              className="text-xs text-link underline"
                            >
                              위임 명세 채우기 ▸
                            </button>
                          </div>
                        </div>
                      )}
                      {column === 'blocked' && (
                        <p className="mt-1 text-xs text-status-danger">
                          {String(task['blocked_reason'] ?? '')}
                        </p>
                      )}
                    </article>
                  </li>
                ))}
                {columnTasks.length === 0 && (
                  <li className="rounded border border-dashed border-border p-2 text-xs text-text-faint">
                    비어 있음
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
