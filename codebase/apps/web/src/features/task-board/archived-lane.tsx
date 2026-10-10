// 보관함 — 보드의 「보관 보기」가 여는 칸(REQ-WEB-302 · api.md REQ-API-286)
//
// 보관한 작업은 상태를 그대로 들고 있어 상태 레인에 섞으면 "진행 중" 칸에 진행하지 않을 작업이 앉는다. 그래서 상태와
// 상관없는 칸 하나에 따로 모은다 — 사유와 대신할 작업을 함께 보여 사람이 다시 살릴지 판단할 수 있게 한다.

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { taskArchiveReasonText } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import type { Row } from '../../lib/queries.js';
import { queryKeys } from '../../lib/query-keys.js';
import type { ProjectId } from '../../lib/query-keys.js';
import { EntityLink } from '../../components/entity-link.js';

export function ArchivedLane({
  proj,
  projectId,
  filters,
}: {
  proj: string;
  projectId: ProjectId | undefined;
  /** 보드에 걸린 필터 — 레인과 같은 조건으로 거른다 */
  filters: { spec?: string; assignee?: string; ai?: boolean };
}): React.JSX.Element {
  const t = useT();
  // 레인과 같은 쿼리 키 축이다 — 보관 · 복원 이벤트가 작업 목록을 무효화하면 이 칸도 함께 낡는다
  const query = useQuery({
    queryKey: [
      ...queryKeys.projectTasks(projectId ?? ('' as ProjectId)),
      'archived-only',
      filters.spec ?? '',
      filters.assignee ?? '',
      filters.ai === true,
    ],
    queryFn: () =>
      apiFetch<{ items: Row[]; next_cursor: string | null }>(
        `/projects/${proj}/tasks?archived=only&limit=50` +
          (filters.spec === undefined ? '' : `&spec=${encodeURIComponent(filters.spec)}`) +
          (filters.assignee === undefined
            ? ''
            : `&assignee=${encodeURIComponent(filters.assignee)}`) +
          (filters.ai === true ? '&ai=1' : ''),
      ),
    enabled: projectId !== undefined,
  });
  const items = query.data?.items ?? [];
  const more = query.data?.next_cursor != null;
  return (
    <section data-testid="column-archived" className="flex w-67 shrink-0 flex-col">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-text-mute">
        {t('tasks.lane.archived')}
        <span className="tabular-nums text-text-faint">
          {items.length}
          {more ? '+' : ''}
        </span>
      </h3>
      {query.isSuccess && items.length === 0 && (
        <p className="text-xs text-text-faint">{t('tasks.archived.empty')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={String(item['id'])}
            data-testid="archived-task"
            className="rounded-nerv-sm bg-bg-sunken px-3 py-2 text-sm"
          >
            <EntityLink
              projectSlug={proj}
              entity={{ kind: 'task', key: String(item['key']) }}
              className="block truncate text-text underline decoration-border-strong underline-offset-4 hover:decoration-current"
            >
              {String(item['title'] ?? item['key'])}
            </EntityLink>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-text-faint">
              <span className="font-mono">{String(item['key'])}</span>
              <span>{taskArchiveReasonText(t, item['archive_reason'])}</span>
              {typeof item['superseded_by'] === 'string' && (
                <span>
                  → <span className="font-mono">{item['superseded_by']}</span>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
