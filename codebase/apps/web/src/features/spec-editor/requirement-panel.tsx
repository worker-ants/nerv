// S3 우측 레일 — 요구사항 목록과 파생 Task (screens.md §2.4)
//
// **약속과 그 약속을 지키는 일을 나란히 둔다.** 문서가 무엇을 약속했는지(요구사항)와
// 그것을 누가 어떻게 지키고 있는지(파생 Task)는 D-03·FR-13 이 세운 축인데, 2026-09-06
// 까지 이 화면에는 둘 다 없었다 — 서버는 `EP-REQ-01`·`EP-TASK-01(?spec=)` 로 처음부터
// 답하고 있었고, 화면이 묻지 않았을 뿐이다.
//
// "빈 약속"(요구사항은 있는데 Task 도 증적도 0)이 여기서 눈에 띄어야 한다. 커버리지
// 숫자는 프로젝트 개요가 말하지만, **어느 요구사항인지**는 이 목록만 말할 수 있다.

import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n.js';
import { rows, useRequirements, useTaskLane } from '../../lib/queries.js';
import { Mono, Skeleton } from '../../components/ui/primitives.js';
import { StatusBadge } from '../../components/status-badge.js';
import { REQUIREMENT_TOKEN } from '../../components/status-token.js';
import { statusLabelKey } from '@nerv/schema';
import type { StatusToken } from '../../components/status-badge.js';

export function RequirementPanel({
  projectSlug,
  specKey,
}: {
  projectSlug: string;
  specKey: string;
}): React.JSX.Element {
  const t = useT();
  const query = useRequirements(projectSlug, specKey);
  const items = rows(query.data);

  if (query.isLoading) return <Skeleton className="h-16" />;
  if (items.length === 0) {
    // 빈 상태는 **막다른 길이 아니다**(§1.5) — 무엇을 쓰면 되는지로 데려간다
    return (
      <p className="px-2 py-3 text-sm text-text-faint">
        {t('spec.requirements.empty')}{' '}
        <Link to="/help/$chapter" params={{ chapter: 'specs' }} className="text-link underline">
          {t('spec.requirements.ears_help')}
        </Link>
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5 px-1">
      {items.map((r) => {
        const tasks = Number(r['task_count'] ?? 0);
        const evidence = Number(r['evidence_count'] ?? 0);
        return (
          <li key={String(r['id'])} className="flex flex-col gap-0.5 rounded-nerv px-1 py-1">
            <div className="flex items-center gap-1.5">
              <Mono>{String(r['ref'])}</Mono>
              <StatusBadge
                token={
                  (REQUIREMENT_TOKEN[String(r['impl_status']) as keyof typeof REQUIREMENT_TOKEN] ??
                    'idle') as StatusToken
                }
                label={t(statusLabelKey('requirement', String(r['impl_status'])))}
              />
              {/* **우선순위가 없으면 없다고 적는다** — `must` 로 채워 보이면 원본이
                  그렇게 선언한 것처럼 읽힌다(4.7 §2.5 규칙 4) */}
              <span className="text-2xs text-text-ghost">
                {r['priority'] == null ? t('spec.requirements.no_priority') : String(r['priority'])}
              </span>
            </div>
            <p className="line-clamp-2 text-xs text-text-mute">{String(r['statement_md'] ?? '')}</p>
            {/* **빈 약속은 눈에 띄어야 한다**(FR-13) — 0 을 회색으로 숨기면 세는 뜻이 없다 */}
            <p
              data-testid={tasks === 0 && evidence === 0 ? 'empty-promise' : undefined}
              className={`text-2xs ${tasks === 0 && evidence === 0 ? 'text-status-danger' : 'text-text-ghost'}`}
            >
              {t('spec.requirements.counts', { tasks, evidence })}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 파생 Task — 이 문서에서 나온 일.
 *
 * 보드의 `?spec=` 과 **같은 서버 필터**를 쓴다(EP-TASK-01). 그래서 "전체 보기" 는
 * 새 화면이 아니라 그 보드로 가는 링크다 — 같은 질문에 답이 둘이면 둘이 갈라진다.
 */
export function DerivedTaskPanel({
  projectSlug,
  projectId,
  specKey,
}: {
  projectSlug: string;
  projectId: string | undefined;
  specKey: string;
}): React.JSX.Element {
  const t = useT();
  // 레인 하나가 아니라 **흐르는 셋**을 본다 — done 까지 실으면 목록이 이력이 된다
  const query = useTaskLane(projectSlug, projectId, 'ready,in_progress,blocked', {
    spec: specKey,
  });
  const items = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-1 px-1">
      {items.length === 0 ? (
        <p className="px-1 py-2 text-sm text-text-faint">{t('spec.derived_tasks.empty')}</p>
      ) : (
        items.map((task) => (
          <Link
            key={String(task['id'])}
            to="/p/$proj/tasks/$task"
            params={{ proj: projectSlug, task: String(task['key']) }}
            className="flex items-center gap-1.5 rounded-nerv px-1 py-1 hover:bg-bg-hover"
          >
            <Mono>{String(task['key'])}</Mono>
            <span className="min-w-0 flex-1 truncate text-xs">{String(task['title'] ?? '')}</span>
            <span className="text-2xs text-text-ghost">{String(task['status'] ?? '')}</span>
          </Link>
        ))
      )}
      <Link
        to="/p/$proj/tasks"
        params={{ proj: projectSlug }}
        search={{ spec: specKey }}
        className="px-1 pt-1 text-2xs text-link hover:underline"
      >
        {t('spec.derived_tasks.all')}
      </Link>
    </div>
  );
}
