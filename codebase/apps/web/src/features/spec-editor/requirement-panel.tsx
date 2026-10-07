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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../lib/i18n.js';
import { rows, useMe, useRequirements, useSpecDiff, useTaskLane } from '../../lib/queries.js';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { useScope } from '../../lib/scope.js';
import { rolesInProject } from '../../lib/session.js';
import { Button, Mono, Skeleton } from '../../components/ui/primitives.js';
import { cn } from '../../lib/utils.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { StatusBadge } from '../../components/status-badge.js';
import { REQUIREMENT_TOKEN } from '../../components/status-token.js';
import { EVIDENCE_SIGNER_ROLES, requirementsOf, statusLabelKey } from '@nerv/schema';
import { taskStatusText } from '../../lib/format.js';
import type { StatusToken } from '../../components/status-badge.js';
import type { ProjectId } from '../../lib/query-keys.js';
import { helpLink } from '../../lib/manual-chapters.js';

export function RequirementPanel({
  projectSlug,
  specKey,
  /**
   * 지금 보고 있는 버전 — **승인본에서만 파생한다**(D-02 · REQ-WEB-147). 승인되지 않은
   * 버전에서 일을 파생하면 그 일은 아직 합의되지 않은 약속 위에 선다.
   */
  version,
  approvedNo = null,
  draftBody,
  onOpenDiff,
}: {
  projectSlug: string;
  specKey: string;
  version?: { id: string; versionNo: number; status: string };
  /** 이 문서의 최신 승인본 번호 — 승인된 적 없으면 null */
  approvedNo?: number | null;
  /** 보고 있는 초안의 본문 — 승인된 적 없는 초안이 무엇을 약속하는지 센다 */
  draftBody?: string;
  /** 두 버전의 비교를 연다 */
  onOpenDiff?: (from: number, to: number) => void;
}): React.JSX.Element {
  const t = useT();
  const query = useRequirements(projectSlug, specKey);
  const items = rows(query.data);
  // **초안이 무엇을 바꾸는지 먼저 보인다**(2026-09-28 · SPEC-14 · REQ-WEB-278). 요구사항 행은 승인될 때
  // 만들어져서, 초안을 보는 동안 이 탭은 승인본의 약속만 보였다 — 검토를 부르기 전에 "이번에 무엇이
  // 늘고 줄었나" 를 볼 곳이 없었다
  const draft =
    version !== undefined && version.status !== 'approved' ? (
      <DraftRequirementDelta
        projectSlug={projectSlug}
        specKey={specKey}
        versionNo={version.versionNo}
        approvedNo={approvedNo}
        draftBody={draftBody ?? ''}
        {...(onOpenDiff === undefined ? {} : { onOpenDiff })}
      />
    ) : null;
  // 검증 서명을 남길 수 있는 사람만 "영향 없음 확인" 을 본다 — 서버의 서명 규칙과 같은 목록이다
  const me = useMe();
  const { orgSlug } = useScope(projectSlug);
  const canSign = rolesInProject(me.data, orgSlug, projectSlug).some((role) =>
    (EVIDENCE_SIGNER_ROLES as readonly string[]).includes(role),
  );

  if (query.isPending) return <Skeleton className="h-16" />;
  if (items.length === 0) {
    // 빈 상태는 **막다른 길이 아니다**(§1.5) — 무엇을 쓰면 되는지로 데려간다.
    //
    // **왜 비었는지를 가른다**(2026-09-24 · SPEC-14 · REQ-WEB-215). 요구사항 행은 **승인될 때** 본문의
    // EARS 줄에서 만들어진다 — 한 번도 승인된 적 없는 초안은 본문에 줄이 열 개 있어도 "이 버전에는
    // 요구사항 블록이 없습니다" 를 받았다. 그리고 줄의 형식은 에이전트용 스킬에만 있었다: 여기서 한 줄로
    // 보이고, 예 셋은 매뉴얼의 요구사항 절에 있다
    const neverApproved = version !== undefined && version.status !== 'approved';
    return (
      <div className="flex flex-col gap-2">
        {draft}
        <div data-testid="requirements-empty" className="flex flex-col gap-1.5 px-2 py-3 text-sm">
          <p className="text-text-faint">
            {neverApproved ? t('spec.requirements.empty_draft') : t('spec.requirements.empty')}
          </p>
          <code className="rounded-nerv-sm bg-bg-sunken px-1.5 py-1 font-mono text-2xs text-text-mute">
            {t('spec.requirements.format')}
          </code>
          <Link
            {...helpLink('specs', 'requirements')}
            className="text-2xs text-link hover:underline"
          >
            {t('spec.requirements.ears_help')} ▸
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {draft}
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
                    (REQUIREMENT_TOKEN[
                      String(r['impl_status']) as keyof typeof REQUIREMENT_TOKEN
                    ] ?? 'idle') as StatusToken
                  }
                  label={t(statusLabelKey('requirement', String(r['impl_status'])))}
                />
                {/* **우선순위가 없으면 없다고 적는다** — `must` 로 채워 보이면 원본이
                  그렇게 선언한 것처럼 읽힌다(4.7 §2.5 규칙 4) */}
                <span className="text-2xs text-text-faint">
                  {r['priority'] == null
                    ? t('spec.requirements.no_priority')
                    : String(r['priority'])}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-text-mute">
                {String(r['statement_md'] ?? '')}
              </p>
              {r['reverify_required'] === true && (
                <ReverifyLine
                  projectSlug={projectSlug}
                  specKey={specKey}
                  requirement={r}
                  canSign={canSign}
                />
              )}
              {/* **빈 약속은 눈에 띄어야 한다**(FR-13) — 0 을 회색으로 숨기면 세는 뜻이 없다 */}
              <p
                data-testid={tasks === 0 && evidence === 0 ? 'empty-promise' : undefined}
                className={`text-2xs ${tasks === 0 && evidence === 0 ? 'text-status-danger' : 'text-text-faint'}`}
              >
                {t('spec.requirements.counts', { tasks, evidence })}
              </p>
              {/* **가치 사슬의 첫 고리**(REQ-WEB-147) — 약속에서 일로 가는 문이 화면에 없어,
                웹에서 만든 Task 는 어느 요구사항도 책임지지 않았다(실측 487건 중 214건). */}
              {version !== undefined && version.status === 'approved' ? (
                <Link
                  data-testid="derive-task"
                  to="/p/$proj/tasks"
                  params={{ proj: projectSlug }}
                  search={{
                    from_version: version.id,
                    from_spec: specKey,
                    from_version_no: String(version.versionNo),
                    requirement: String(r['id']),
                  }}
                  className="text-2xs text-link hover:underline"
                >
                  {/* 동사 글자지만 생성 폼으로 가는 이동이다 — ▸ 로 이동임을 보인다(사람 결정 A3) */}
                  {t('spec.requirements.derive_task')} ▸
                </Link>
              ) : (
                version !== undefined && (
                  <span className="text-2xs text-text-faint">
                    {t('spec.requirements.derive_disabled')}
                  </span>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * **다시 검증 필요**(2026-09-26 사람 결정 · spec-workflow §1.3 · REQ-WEB-241). 검증 서명은 그 문장에
 * 대한 것이다 — 새 버전이 문장을 바꾸면 앞선 서명은 지금 문장을 보증하지 않아 검증이 풀린다. 상태가
 * 아니라 표시다: 풀린 까닭을 말하고, 사람이 해제한다.
 *
 * 해제는 둘이다 — 새 테스트 증적에 서명하거나, 앞선 서명이 새 문장에도 맞다고 **영향 없음 확인**을
 * 남긴다. 뒤의 것은 같은 테스트(locator)에 다시 서명하는 것이라 증적과 이벤트로 남는다(EP-REQ-03).
 * 오타 하나로 테스트를 다시 돌리게 하면 이 표시는 곧 무시된다.
 */
function ReverifyLine({
  projectSlug,
  specKey,
  requirement,
  canSign,
}: {
  projectSlug: string;
  specKey: string;
  requirement: Record<string, unknown>;
  canSign: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const ref = String(requirement['ref']);
  const locator =
    typeof requirement['reverify_locator'] === 'string' ? requirement['reverify_locator'] : null;
  const reaffirm = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/requirements/${encodeURIComponent(ref)}/evidence`, {
        method: 'POST',
        body: { kind: 'test', locator },
      }),
    onSuccess: () => {
      pushToast({ tone: 'ok', message: t('spec.requirements.reaffirmed', { ref }) });
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.spec(specKey), 'requirements'],
      });
    },
    onError: onApiError,
  });
  return (
    <div data-testid="reverify-required" className="flex flex-wrap items-center gap-1.5">
      <StatusBadge token="waiting" label={t('spec.requirements.reverify')} />
      <span className="text-2xs text-text-faint">{t('spec.requirements.reverify_hint')}</span>
      {canSign && locator !== null && (
        <ConfirmAction
          label={t('spec.requirements.reaffirm')}
          variant="subtle"
          size="xs"
          testId="reaffirm"
          message={t('spec.requirements.reaffirm_confirm', { locator })}
          confirmLabel={t('spec.requirements.reaffirm')}
          pending={reaffirm.isPending}
          onConfirm={() => reaffirm.mutate()}
        />
      )}
    </div>
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
  projectId: ProjectId | undefined;
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
            <span className="text-2xs text-text-faint">{taskStatusText(t, task['status'])}</span>
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

/**
 * 초안이 요구사항을 무엇을 더하고 · 바꾸고 · 빼는가(2026-09-28 · SPEC-14 · REQ-WEB-278).
 *
 * 승인본이 있으면 **버전 비교(EP-SPEC-06)** 가 답한다 — 서버가 요구사항 델타를 이미 센다. 승인된 적이 없으면 비교할
 * 버전이 없으므로 본문의 요구사항 줄을 센다(`requirementsOf` — 서버와 같은 판정). 둘 다 "승인되면 이 문서의 약속이
 * 어떻게 되나" 에 답한다.
 */
function DraftRequirementDelta({
  projectSlug,
  specKey,
  versionNo,
  approvedNo,
  draftBody,
  onOpenDiff,
}: {
  projectSlug: string;
  specKey: string;
  versionNo: number;
  approvedNo: number | null;
  draftBody: string;
  onOpenDiff?: (from: number, to: number) => void;
}): React.JSX.Element {
  const t = useT();
  const base = approvedNo !== null && approvedNo < versionNo ? approvedNo : null;
  const diff = useSpecDiff(projectSlug, specKey, base, base === null ? null : versionNo);
  const shell = 'rounded-nerv border border-border bg-bg-sunken px-2.5 py-2 text-xs';

  if (base === null) {
    const found = [...requirementsOf(draftBody)];
    return (
      <section data-testid="draft-requirements" className={shell}>
        <p className="font-medium text-text">
          {found.length === 0
            ? t('spec.requirements.draft_none_new')
            : t('spec.requirements.draft_new', { count: found.length })}
        </p>
        {found.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5">
            {found.map(([ref, statement]) => (
              <li key={ref} className="flex gap-2">
                <Mono className="shrink-0">{ref}</Mono>
                <span className="line-clamp-1 min-w-0 text-text-mute">{statement}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (diff.isPending) return <Skeleton rows={1} />;
  const changed = rows(diff.data?.['requirements']).filter((r) => r['delta'] !== 'unchanged');
  const count = (kind: string): number => changed.filter((r) => r['delta'] === kind).length;
  return (
    <section data-testid="draft-requirements" className={shell}>
      <p className="font-medium text-text">
        {t('spec.requirements.draft_delta', { from: base })}{' '}
        <span className="font-normal text-text-mute">
          {changed.length === 0
            ? t('spec.diff.no_requirement_change')
            : t('spec.requirements.draft_counts', {
                added: count('added'),
                modified: count('modified'),
                removed: count('removed'),
              })}
        </span>
      </p>
      {changed.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {changed.map((r) => (
            <li key={String(r['ref'])} className="flex gap-2">
              <span
                className={cn(
                  'w-10 shrink-0 font-mono text-2xs',
                  r['delta'] === 'added' && 'text-status-ok',
                  r['delta'] === 'removed' && 'text-status-danger',
                  r['delta'] === 'modified' && 'text-status-waiting',
                )}
              >
                {t(`spec.diff.${String(r['delta'])}` as 'spec.diff.added')}
              </span>
              <Mono className="shrink-0">{String(r['ref'])}</Mono>
              <span className="line-clamp-1 min-w-0 text-text-mute">
                {String(r['statement_md'] ?? '')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {onOpenDiff !== undefined && (
        <Button
          size="xs"
          variant="subtle"
          data-testid="draft-requirements-diff"
          className="mt-1.5"
          onClick={() => onOpenDiff(base, versionNo)}
        >
          {t('spec.requirements.draft_open_diff', { from: base, to: versionNo })}
        </Button>
      )}
    </section>
  );
}
