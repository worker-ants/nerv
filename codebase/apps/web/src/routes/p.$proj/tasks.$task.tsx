// /p/:proj/tasks/:task — 작업 상세 (screens.md §2.5)
//
// 여기서 done 전이를 한다. **게이트가 요구하는 것을 폼이 먼저 보여준다** — 스펙 영향 선언과
// 증적. 조건 5(스펙 영향)가 clemvion 에서 가장 잘 작동한 규칙의 이식이라, "없음"도 명시적으로
// 고르게 만든다. 빈 선언을 허용하면 규칙이 사라진다 — 그래서 **처음에는 아무것도 골라져 있지
// 않다**(2026-09-24 · REQ-WEB-202). 예전에는 "없음" 이 미리 체크돼 있어 건드리지 않고 완료를
// 눌러도 선언한 것이 됐다.
//
// **머리의 단추는 상태가 정한다**(REQ-WEB-202 · `features/task-board/next-actions.ts`).

import {
  BLOCKED_REASONS,
  EVIDENCE_KINDS,
  TASK_EDIT_ROLES,
  blockedReasonLabelKey,
  isDelegationFilled,
  rolesWithScope,
  scopesForRoles,
  statusLabelKey,
} from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { useTitleDetail } from '../../lib/title-detail.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { StatusBadge } from '../../components/status-badge.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { evidenceTarget, needsRepoUrl } from '../../lib/evidence.js';
import {
  blockedReasonText,
  claimStatusText,
  evidenceKindText,
  reviewKindText,
  reviewStateText,
  taskStatusText,
} from '../../lib/format.js';
import { DelegationForm } from '../../features/task-board/delegation-form.js';
import { nextActions } from '../../features/task-board/next-actions.js';
import type { NextAction, TransitionTarget } from '../../features/task-board/next-actions.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { rows, useMe, useProject, useTask } from '../../lib/queries.js';
import { rolesInProject } from '../../lib/session.js';
import { secondsUntil, useNow } from '../../lib/clock.js';
import { leaseRemaining } from '../../features/session-monitor/format.js';
import { useScope } from '../../lib/scope.js';
import { useRememberVisit } from '../../components/quick-switcher.js';
import { describeApiError, useApiError } from '../../lib/api-errors.js';
import { usePressKey } from '../../lib/press-key.js';
import {
  Button,
  Card,
  Input,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Select,
  Skeleton,
  Textarea,
  Avatar,
} from '../../components/ui/primitives.js';
import { EntityLink } from '../../components/entity-link.js';
import { TaskSheet } from '../../features/task-board/task-sheet.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { ErrorState, NotFoundState, isNotFound } from '../../components/query-state.js';
import type { StatusToken } from '../../components/status-badge.js';
import { asProjectId } from '../../lib/query-keys.js';

export const Route = createFileRoute('/p/$proj/tasks/$task')({ component: TaskDetail });

function TaskDetail(): React.JSX.Element {
  const t = useT();
  const { proj, task } = Route.useParams();
  const detail = useTask(proj, task);
  const project = useProject(proj);
  // 탭 제목과 헤더 끝이 **이 작업**을 말한다(REQ-WEB-228)
  useTitleDetail({
    key: typeof detail.data?.['key'] === 'string' ? detail.data['key'] : task,
    title: typeof detail.data?.['title'] === 'string' ? detail.data['title'] : null,
  });
  const me = useMe();
  const { orgSlug } = useScope(proj);
  // **연 작업을 최근에 남긴다**(REQ-WEB-223)
  useRememberVisit(
    detail.data === undefined
      ? null
      : {
          key: String(detail.data['key'] ?? task),
          title: String(detail.data['title'] ?? task),
          type: 'task',
          doc_status: null,
          anchor: null,
          kind: 'task',
          project_slug: proj,
          ...(typeof project.data?.['name'] === 'string'
            ? { project_name: project.data['name'] }
            : {}),
          ...(orgSlug === null ? {} : { org_slug: orgSlug }),
        },
  );
  const now = useNow();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();

  /** 스펙 영향 — **고르지 않음이 처음이다**. "없음" 을 미리 골라 두면 그 선택을 화면이 대신한다 */
  const [specImpact, setSpecImpact] = useState<'unset' | 'none' | 'some'>('unset');
  const [specImpactNote, setSpecImpactNote] = useState('');
  /** [완료…]를 눌렀다 — 완료 폼은 진행 중인 작업이나 이것이 켜졌을 때만 편다 */
  const [finishOpen, setFinishOpen] = useState(false);
  /** 위임 명세를 그 자리에서 고친다(REQ-WEB-202) */
  const [editingBrief, setEditingBrief] = useState(false);
  const briefRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const [evidenceKind, setEvidenceKind] = useState('pr');
  const [evidenceLocator, setEvidenceLocator] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  /** 서버가 거부한 사유 — 카드 옆에 남긴다. 토스트는 사라지고 사람은 이유를 잊는다 */
  const [rejection, setRejection] = useState<{ message: string; missing: string[] } | null>(null);

  const data = detail.data ?? {};
  const status = String(data['status'] ?? '');
  const projectId = asProjectId(project.data?.['id']);
  const meId = me.data?.id;
  const evidence = rows(data['evidence']);
  // 증적이 데려갈 곳을 만드는 데 드는 둘 — 저장소 주소와 기준 갈래(REQ-WEB-159).
  // 프로젝트 응답(EP-PRJ-03)이 처음부터 싣고 있었고 이 화면이 읽은 적이 없었다.
  const repoUrl = typeof project.data?.['repo_url'] === 'string' ? project.data['repo_url'] : null;
  const defaultBranch =
    typeof project.data?.['default_branch'] === 'string' ? project.data['default_branch'] : null;
  /** 주소의 모양(REQ-WEB-162) — 어휘 밖이면 `evidenceTarget` 이 기본으로 읽는다 */
  const repoHost =
    typeof project.data?.['repo_host'] === 'string' ? project.data['repo_host'] : null;
  /** 무엇이 되면 풀리는가 — 서버가 파생해 보낸다(REQ-API-118). 막히지 않았으면 null */
  const blocked =
    typeof data['blocked_resolution'] === 'object' && data['blocked_resolution'] !== null
      ? (data['blocked_resolution'] as Record<string, unknown>)
      : null;

  /**
   * 지금 살아 있는 내 클레임 — 있으면 [클레임 해제], 없으면 [클레임] 이다.
   *
   * 상세가 싣는 클레임 이력은 최근 10건이라 **상태를 봐야 한다**: 지나간 `released` 를
   * 살아 있는 것으로 읽으면 잡을 수 있는 작업에 해제 버튼이 붙는다.
   */
  const myClaim = rows(data['claims']).find(
    (c) => c['status'] === 'active' && c['user_id'] === meId,
  );
  // **리스가 지난 클레임은 쥔 것이 아니다** — 서버는 클레임할 때 그것을 먼저 회수한다(`claimInTx`).
  // 살아 있는 것과 지난 것을 가르지 않으면 되찾을 수 있는 작업의 [클레임]이 잠긴다
  const active = rows(data['claims']).filter((c) => c['status'] === 'active');
  // 지금 돌리는 세션 — 머리의 "실행" 이 가리킨다(에이전트 클레임만 · 사람 클레임은 담당이 말한다)
  const runner = active.find((c) => typeof c['agent_session_id'] === 'string');
  const live = active.filter((c) => (secondsUntil(c['lease_expires_at'], now) ?? 0) > 0);
  const heldByOther = live.some((c) => c['user_id'] !== meId);
  const liveClaim: 'none' | 'mine' | 'other' =
    live.length === 0 ? 'none' : live.some((c) => c['user_id'] === meId) ? 'mine' : 'other';
  const expiredClaim = live.length === 0 && active.length > 0;

  /**
   * **완료로 옮길 수 있는 사람은 넷이다**(REQ-API-130 · REQ-WEB-141). 서버가 그렇게 판정하므로
   * 화면은 미리 잠근다 — 숨기지 않고 비활성으로, 사유를 툴팁에 적어서(REQ-WEB-003).
   * 누를 수 없는 단추가 왜 그런지 말하지 않으면 사람은 화면이 고장 났다고 읽는다.
   */
  const roles = rolesInProject(me.data, orgSlug, proj);
  const privileged = roles.some((r) => r === 'planner' || r === 'admin');
  // 위임 명세를 고치는 문(EP-TASK-05)은 planner·developer·admin 만이다 — 서버 가드와 같은 목록
  const canEditBrief = roles.some((r) => (TASK_EDIT_ROLES as readonly string[]).includes(r));
  const canMove = scopesForRoles(roles).has('task:update');
  const isAssignee = data['assignee_user_id'] === meId && meId !== undefined;
  const canFinish = myClaim !== undefined || isAssignee || privileged;

  /**
   * **아무도 쥐지 않은 진행 중** — 임포트가 만든 24건이 그 모양이었다(2026-09-06 실측).
   * `next()` 에도 안 보이고(ready 가 아니라) 잡을 수도 없어서 아무에게도 닿지 않는다.
   * 되돌리는 문은 다음 행동 표가 연다 — 4요소가 차 있으면 `ready`, 임포트 자리표시자처럼
   * 비어 있으면 `backlog` 다(전자를 눌러 봐야 서버가 4요소로 거절한다).
   */
  const delegationFilled = (
    ['goal_md', 'output_format_md', 'tools_sources_md', 'boundaries_md'] as const
  ).every((field) => isDelegationFilled(typeof data[field] === 'string' ? data[field] : null));

  // **누름마다 새 키다**(REQ-WEB-195). `claim-<작업 id>` 로 고정하던 동안, 잡았다 놓고 하루 안에
  // 다시 누르면 서버가 첫 응답을 재생해 새 클레임 없이 "잡았습니다" 가 떴다.
  const claimPress = usePressKey('claim');
  const claim = useMutation({
    // **웹에서도 잡을 수 있어야 한다**(screens.md:903 화면 요소 "사람 클레임").
    // 이 문이 없는 동안 MCP·CLI 를 쓰지 않는 역할에게 보드는 읽기 전용이었다 — 서버는
    // 처음부터 세션 쿠키로도 `task:claim` 을 내주고 있었다(project-access.guard).
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/tasks/${String(data['id'])}/claim`, {
        method: 'POST',
        // 사람 클레임에는 세션이 없다 — 범위는 이 작업의 출처 스펙 하나다.
        // 파일 글롭은 **비운다**: 사람이 무엇을 만질지 서버가 추정하면 안 된다.
        body: {
          scope: {
            spec_ids: typeof data['source_spec_id'] === 'string' ? [data['source_spec_id']] : [],
            file_globs: [],
          },
        },
        idempotencyKey: claimPress.take(),
      }),
    onSettled: claimPress.release,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      pushToast({ tone: 'ok', message: t('task.claim_ok') });
    },
    onError: onApiError,
  });

  const rebrief = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/tasks/${String(data['id'])}`, {
        method: 'PATCH',
        body: { rebrief: true },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      pushToast({ tone: 'ok', message: t('task.basis.rebrief_ok') });
    },
    onError: onApiError,
  });

  const release = useMutation({
    mutationFn: (reason: 'handoff' | 'abandon') =>
      apiFetch<Record<string, unknown>>(
        `/projects/${proj}/claims/${String(myClaim?.['id'])}/release`,
        {
          method: 'POST',
          body: { reason },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      pushToast({ tone: 'ok', message: t('task.release_ok') });
    },
    onError: onApiError,
  });

  const transition = useMutation({
    mutationFn: (next: 'done' | 'blocked' | TransitionTarget) =>
      apiFetch<Record<string, unknown>>(
        `/projects/${proj}/tasks/${String(data['id'])}/transition`,
        {
          method: 'POST',
          body: {
            status: next,
            ...(next === 'done'
              ? {
                  spec_impact:
                    specImpact === 'none' ? { none: true } : { note: specImpactNote.trim() },
                  evidence:
                    evidenceLocator.trim() === ''
                      ? []
                      : [{ kind: evidenceKind, locator: evidenceLocator }],
                }
              : {}),
            ...(next === 'blocked' ? { blocked_reason: blockedReason } : {}),
          },
        },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      if (typeof projectId === 'string') {
        if (projectId !== undefined) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
        }
      }
      pushToast({
        tone: 'ok',
        message: t('task.status_changed', { status: taskStatusText(t, result['status']) }),
      });
      setRejection(null);
      if (result['status'] === 'done') setFinishOpen(false);
    },
    onError: (error: Error) => {
      // 거부는 **화면에 남는다**(REQ-WEB-018). 상태는 그대로이고(낙관적 갱신을 하지 않으므로
      // 되돌릴 것도 없다) 무엇이 빠졌는지가 버튼 옆에 붙는다.
      // `missing` 은 위임 명세 4요소, `pending` 은 끝나지 않은 선행 작업이다(REQ-API-131).
      // 둘 다 "무엇을 하면 되는가" 라서 같은 자리에 남긴다 — 이름만 다르다.
      const details = error instanceof NervApiError ? error.body.details : {};
      const missing = Array.isArray(details['missing'])
        ? (details['missing'] as (string | { label?: string; field?: string })[]).map((m) =>
            typeof m === 'string' ? m : (m.label ?? m.field ?? ''),
          )
        : Array.isArray(details['pending'])
          ? (details['pending'] as string[])
          : [];
      // **한 번만 말한다**(§1.5 · REQ-WEB-196) — 거부는 단추 옆에 남으므로 같은 문장을 토스트로
      // 다시 띄우지 않는다. 문장은 표(§1.5)를 거친다: `error.message` 는 서버 문장뿐이라
      // 부류·재시도 시각·갈 곳이 빠진다.
      setRejection({ message: describeApiError(t, error).message, missing });
    },
  });

  /** 머리의 단추 — 상태가 정한다(REQ-WEB-202) */
  const actions = nextActions(
    {
      status,
      delegationFilled,
      unblockSatisfied: blocked === null ? undefined : (blocked['satisfied'] as boolean | null),
      roles,
      liveClaim,
      expiredClaim,
      canFinish,
    },
    t,
  );
  const run = (action: NextAction): void => {
    if (action.kind === 'claim') claim.mutate();
    else if (action.kind === 'fill_brief') {
      setEditingBrief(true);
      briefRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    } else if (action.kind === 'finish') {
      setFinishOpen(true);
      gateRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    } else if (action.target !== undefined) transition.mutate(action.target);
  };
  /** 완료 폼 — 진행 중인 작업이거나 [완료…]를 눌렀을 때만(backlog·ready 에 늘 펼쳐 두지 않는다) */
  const showGate =
    status !== 'done' &&
    (finishOpen || status === 'claimed' || status === 'in_progress' || status === 'in_review');
  const finishBlock =
    specImpact === 'unset'
      ? t('task.spec_impact_choose')
      : specImpact === 'some' && specImpactNote.trim() === ''
        ? t('task.spec_impact_note_required')
        : null;

  // **받아 오기 전에는 작업을 그리지 않는다**(REQ-WEB-198 · 199). 예전에는 `detail.data ?? {}`
  // 로 그려서, 불러오는 동안 키가 제목 자리에 서고 상태 배지에 카탈로그 키 원문
  // `status.task` 가 떴으며, 없는 키로 들어오면 그 빈 머리가 그대로 남았다.
  if (detail.data === undefined) {
    return (
      <TaskSheet taskKey={task} status={null}>
        <PageBody>
          {detail.isError ? (
            isNotFound(detail.error) ? (
              <NotFoundState
                title={t('state.task_not_found', { key: task })}
                hint={t('state.not_found_item_hint')}
                action={
                  <Link to="/p/$proj/tasks" params={{ proj }} className="text-sm text-link">
                    {t('state.back_to_list')}
                  </Link>
                }
              />
            ) : (
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            )
          ) : (
            <Skeleton rows={4} />
          )}
        </PageBody>
      </TaskSheet>
    );
  }

  // **보드 위 시트다**(2026-09-24 사람 결정 · REQ-WEB-213) — "← 보드로" 가 걸어 둔 필터를 버렸다.
  // 닫기는 시트 머리의 ✕ 와 Esc 이고, 보드의 필터는 주소에 그대로 남는다
  return (
    <TaskSheet taskKey={task} status={status}>
      <PageBody>
        <PageHeader
          title={String(data['title'] ?? task)}
          meta={
            <>
              <Mono>{task}</Mono>
              <StatusBadge
                token={(TASK_TOKEN[status as keyof typeof TASK_TOKEN] ?? 'idle') as StatusToken}
                label={t(statusLabelKey('task', status))}
              />
              {/* **누구의 일이고 누가 돌리는가**(D-08 · REQ-WEB-209) — 담당(책임)과 실행(에이전트 세션)을
                따로 적는다. 머리는 키·상태뿐이라 둘 다 없었다 */}
              {typeof data['assignee_name'] === 'string' && (
                <span
                  data-testid="task-assignee"
                  className="flex items-center gap-1 text-xs text-text-mute"
                >
                  <Avatar name={data['assignee_name']} size="sm" />
                  {t('task.meta.assignee', { name: data['assignee_name'] })}
                </span>
              )}
              {runner !== undefined && typeof runner['agent_session_id'] === 'string' && (
                <EntityLink
                  projectSlug={proj}
                  entity={{ kind: 'session', id: runner['agent_session_id'] }}
                  testId="task-runner"
                  className="text-xs"
                >
                  {t('task.meta.runner', { host: String(runner['hostname'] ?? '') })}
                </EntityLink>
              )}
            </>
          }
          actions={
            actions.length === 0 ? undefined : (
              <div data-testid="next-actions" className="flex flex-wrap items-center gap-2">
                {actions.map((action) => (
                  <Button
                    key={action.kind}
                    data-testid={
                      action.kind === 'claim'
                        ? 'claim-task'
                        : action.kind === 'revert'
                          ? 'revert-task'
                          : `next-${action.kind}`
                    }
                    variant={action.primary ? 'primary' : 'default'}
                    disabled={action.disabled !== null || transition.isPending || claim.isPending}
                    // 못 누르는 까닭은 키보드·터치에도 닿아야 한다(REQ-WEB-003 · SYS-08) — `title` 은 hover 뿐이었다
                    disabledReason={action.disabled ?? undefined}
                    title={action.disabled === null ? action.hint : undefined}
                    requiresOnline
                    onClick={() => run(action)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )
          }
        />
        {/* 머리의 단추가 거절되면 **그 아래에 남는다**(REQ-WEB-018) — 완료 폼이 닫혀 있어도 */}
        {rejection !== null && !showGate && (
          <p
            role="alert"
            data-testid="transition-rejected"
            className="-mt-3 mb-4 rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
          >
            {t('task.transition_rejected', { message: rejection.message })}
            {rejection.missing.length > 0 &&
              t('task.transition_missing', { missing: rejection.missing.join(', ') })}
          </p>
        )}

        <div className="flex flex-col gap-4">
          {/* **"왜 이 작업인가" 가 화면에 있어야 한다**(FR-05 · D-03 · screens.md:900,912,931,934).
            서버는 출처 스펙·기준 버전·의존·재브리핑을 처음부터 실어 보냈고 화면이 그리지
            않았다 — 그 사이 이 화면은 "무엇을 하라" 만 말하고 "무엇에 근거해" 는 말하지
            않았다. 근거 없는 지시가 P1(맥락 유실)의 다른 이름이다. */}
          <Card>
            <SectionTitle>{t('task.basis')}</SectionTitle>
            <div className="grid gap-x-6 gap-y-3 text-sm @2xl:grid-cols-2">
              <Element label={t('task.basis.spec')}>
                {typeof data['spec_key'] === 'string' ? (
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj, spec: String(data['source_spec_id'] ?? data['spec_key']) }}
                    // **적힌 그 버전을 연다**(SPEC-01 · REQ-WEB-214) — "SPEC v3" 이라 적고 링크는 최신
                    // 승인본으로 갔다. 기준이 밀려났으면 그 차이를 보는 것이 이 작업의 재브리핑이다
                    search={
                      data['basis_version_no'] == null
                        ? {}
                        : { v: Number(data['basis_version_no']) }
                    }
                    className="text-link hover:underline"
                  >
                    <Mono>{String(data['spec_key'])}</Mono>
                    {data['basis_version_no'] != null && ` v${String(data['basis_version_no'])}`}
                  </Link>
                ) : (
                  '—'
                )}
                {/* 기준 버전이 밀려났다는 사실은 **링크 옆에** 붙는다 — 별도 카드로 두면
                  근거를 보는 사람과 경고를 보는 사람이 갈린다 */}
                {data['basis_superseded'] === true && (
                  <span data-testid="basis-superseded" className="ml-2 text-xs text-status-danger">
                    {t('task.basis.superseded')}
                  </span>
                )}
              </Element>
              {/* **UUID 는 사람이 아는 이름이 아니다**(2026-09-07 · REQ-WEB-148). 서버가
                고정 ID(REQ-…)와 문장을 함께 실어 준다 — 원문을 그리면 사람은 그것이 무엇을
                가리키는지 알 수 없고, 그래서 근거 칸이 있어도 근거가 되지 않았다. */}
              <Element label={t('task.basis.requirement')}>
                {typeof data['source_requirement_ref'] === 'string' ? (
                  <span data-testid="requirement-ref" className="flex flex-col gap-0.5">
                    {/* 그 요구사항이 적힌 **스펙의 요구사항 탭**으로 간다(REQ-WEB-209) */}
                    {typeof data['spec_key'] === 'string' ? (
                      <EntityLink
                        projectSlug={proj}
                        entity={{ kind: 'spec', key: data['spec_key'], rail: 'requirements' }}
                        testId="requirement-link"
                      >
                        <Mono>{String(data['source_requirement_ref'])}</Mono>
                      </EntityLink>
                    ) : (
                      <Mono>{String(data['source_requirement_ref'])}</Mono>
                    )}
                    {typeof data['source_requirement_statement'] === 'string' && (
                      <span className="line-clamp-2 text-xs text-text-mute">
                        {String(data['source_requirement_statement'])}
                      </span>
                    )}
                  </span>
                ) : typeof data['source_requirement_id'] === 'string' ? (
                  <Mono>{data['source_requirement_id']}</Mono>
                ) : (
                  '—'
                )}
              </Element>
              <Element label={t('task.basis.dependencies')}>
                {rows(data['dependencies']).length === 0
                  ? t('common.none')
                  : rows(data['dependencies']).map((dep) => (
                      <Link
                        key={String(dep['key'])}
                        to="/p/$proj/tasks/$task"
                        params={{ proj, task: String(dep['key']) }}
                        className="mr-2 text-link hover:underline"
                      >
                        <Mono>{String(dep['key'])}</Mono>
                        <span className="ml-1 text-xs text-text-mute">
                          {taskStatusText(t, dep['status'])}
                        </span>
                      </Link>
                    ))}
              </Element>
              <Element label={t('task.basis.rebrief')}>
                {data['rebrief_required_at'] == null ? (
                  t('common.none')
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span data-testid="rebrief-required" className="text-status-waiting">
                      {t('task.basis.rebrief_required')}
                    </span>
                    {/* **배지를 해소하는 문**(2026-09-06 · REQ-API-121). 오래 배지만 있고
                      그것을 끄는 길이 없었다 — 기준을 최신 승인본으로 옮기고 플래그를
                      지운다. "봤다" 표시가 아니라 **기준을 옮기는 것**이 재브리핑의 뜻이다. */}
                    <Button
                      size="sm"
                      data-testid="rebrief"
                      disabled={rebrief.isPending || !canEditBrief}
                      onClick={() => rebrief.mutate()}
                      disabledReason={
                        canEditBrief
                          ? undefined
                          : t('task.next.roles_only', { roles: TASK_EDIT_ROLES.join(' · ') })
                      }
                      title={canEditBrief ? t('task.basis.rebrief_title') : undefined}
                      requiresOnline
                    >
                      {t('task.basis.rebrief_action')}
                    </Button>
                    {/* 기준이 옮겨 가면 지시도 다시 읽어야 한다 — 고칠 곳이 **같은 화면에** 있다 */}
                    {canEditBrief && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid="rebrief-edit"
                        onClick={() => {
                          setEditingBrief(true);
                          briefRef.current?.scrollIntoView?.({
                            block: 'start',
                            behavior: 'smooth',
                          });
                        }}
                      >
                        {t('task.brief.edit')}
                      </Button>
                    )}
                  </span>
                )}
              </Element>
            </div>
          </Card>

          {/* **막힘은 사유만으로 끝나지 않는다.** 정본(3.5 §2)이 "사유 코드와 **해소 조건**을
            필수로 받는다" 고 적는데 해소 조건을 담을 열이 없었다 — 서버가 그것을 **파생**해
            보낸다(REQ-API-118). 화면이 할 일은 "무엇이 되면 풀리는가" 를 그대로 보이는 것과,
            **이미 풀렸다는 사실을 말해 주는 것**이다: `blocked_reason` 은 아무도 자동으로
            지우지 않아서, 의존이 끝나도 사람이 다시 눌러야 풀린다. */}
          {blocked !== null && (
            <Card>
              <SectionTitle>{t('task.blocked.title')}</SectionTitle>
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  {/* **어휘 밖이면 원문 그대로**(2026-09-07 · REQ-WEB-143). 무조건 문구 키를
                    만들어 붙였더니, 어휘가 생기기 전에 저장된 자유 텍스트 사유에서
                    카탈로그에 없는 키가 만들어져 화면에 `blocked.…` 가 그대로 떴다 —
                    사람이 적어 둔 사유가 있는데 그것을 못 보게 하는 모양이다 */}
                  <span data-testid="blocked-reason" className="font-medium">
                    {blockedReasonText(t, blocked['reason'])}
                  </span>
                  {blocked['satisfied'] === true && (
                    <span
                      data-testid="blocked-satisfied"
                      className="ml-2 rounded-nerv-sm bg-status-ok-soft px-1.5 py-0.5 text-xs text-status-ok"
                    >
                      {t('task.blocked.satisfied')}
                    </span>
                  )}
                </p>
                {/* **`null` 은 "아니다" 가 아니라 "서버가 모른다" 다.** 그 둘을 같은 회색으로
                  그리면 사람은 판정이 있었다고 읽는다 */}
                {blocked['satisfied'] === null ? (
                  <p className="text-xs text-text-mute">{t('task.blocked.human_only')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {rows(blocked['pending']).map((item, i) => (
                      <li
                        key={`${String(item['kind'])}-${i}`}
                        className="flex items-center gap-1.5"
                      >
                        {item['kind'] === 'task' ? (
                          <Link
                            to="/p/$proj/tasks/$task"
                            params={{ proj, task: String(item['key']) }}
                            className="text-link hover:underline"
                          >
                            <Mono>{String(item['key'])}</Mono>
                          </Link>
                        ) : item['kind'] === 'question' && typeof item['id'] === 'string' ? (
                          // 질문은 **받은 요청의 그 카드로** 간다(REQ-WEB-208) — id 를 글자로만 적던 자리다
                          <Link
                            to="/inbox"
                            search={{ focus: item['id'] }}
                            data-testid="blocked-question-link"
                            className="text-xs text-link hover:underline"
                          >
                            {t('session.open_in_inbox')}
                          </Link>
                        ) : (
                          <Mono>{String(item['key'] ?? item['id'] ?? '')}</Mono>
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-text-mute">
                          {String(item['title'] ?? '')}
                        </span>
                        <span className="text-2xs text-text-faint">
                          {taskStatusText(t, item['status'])}
                        </span>
                      </li>
                    ))}
                    {rows(blocked['pending']).length === 0 && (
                      <li className="text-xs text-text-faint">
                        {t('task.blocked.nothing_pending')}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </Card>
          )}

          {/* **위임 명세는 여기서 고친다**(2026-09-24 — UI/UX 검토 · REQ-WEB-202). 명세는 "같은
            화면에 고칠 폼이 열려 있다" 고 적었는데 이 카드는 읽기 전용이었다 — 재브리핑 배지가
            "지시를 다시 확인하세요" 라고 해도, ready 작업의 경계를 고치고 싶어도 고칠 곳이 없었다.
            빈 요소와 임포트 자리표시자는 ❌ 로 그린다(§2.5 ③). */}
          <div ref={briefRef}>
            {editingBrief ? (
              <DelegationForm
                projectSlug={proj}
                projectId={projectId}
                taskKey={task}
                onDone={() => setEditingBrief(false)}
              />
            ) : (
              <Card>
                <SectionTitle
                  action={
                    <Button
                      size="sm"
                      data-testid="brief-edit"
                      disabled={!canEditBrief || status === 'done'}
                      disabledReason={
                        canEditBrief
                          ? t('task.brief.done_locked')
                          : t('task.next.roles_only', { roles: TASK_EDIT_ROLES.join(' · ') })
                      }
                      onClick={() => setEditingBrief(true)}
                    >
                      {t('task.brief.edit')}
                    </Button>
                  }
                >
                  {t('task.brief')}
                </SectionTitle>
                <div className="grid gap-x-6 gap-y-3 text-sm @2xl:grid-cols-2">
                  {(
                    [
                      ['goal_md', 'task.brief.goal'],
                      ['output_format_md', 'task.brief.output'],
                      ['tools_sources_md', 'task.brief.tools'],
                      ['boundaries_md', 'task.brief.boundaries'],
                    ] as const
                  ).map(([field, label]) => {
                    const value = typeof data[field] === 'string' ? data[field] : null;
                    return (
                      <Element key={field} label={t(label)}>
                        {isDelegationFilled(value) ? (
                          value
                        ) : (
                          <span data-testid="brief-missing" className="text-status-danger">
                            ❌{' '}
                            {value === null || value.trim() === ''
                              ? t('task.brief.empty')
                              : t('task.brief.placeholder')}
                          </span>
                        )}
                      </Element>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>

          <Card>
            <SectionTitle>{t('task.claims')}</SectionTitle>
            {/* **웹에서도 잡고 놓을 수 있다**(screens.md:903·926). 이 두 버튼이 없는 동안
              MCP·CLI 를 쓰지 않는 역할에게 보드는 읽기 전용이었다 — 서버는 세션 쿠키로도
              `task:claim` 을 내주고 있었으므로 빠져 있던 것은 문뿐이다. */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {myClaim === undefined ? (
                // [클레임]은 머리에 있다 — 잡을 수 있는 상태일 때만(다음 행동 표)
                heldByOther && (
                  <span className="text-xs text-text-faint">{t('task.claim_held')}</span>
                )
              ) : (
                <>
                  {/* 인계와 포기는 **저장에서도 다른 값**이다(마이그레이션 0019) —
                    화면이 하나로 뭉치면 "왜 내려놨나" 가 다시 사라진다 */}
                  <Button
                    data-testid="release-handoff"
                    disabled={release.isPending}
                    onClick={() => release.mutate('handoff')}
                  >
                    {t('task.release_handoff')}
                  </Button>
                  {/* **포기는 한 번 묻는다**(REQ-WEB-200) — danger 색이면서 한 번에 클레임을 놓았다.
                    세션 중단과 같은 성질(일을 내려놓고 ready 로 돌린다)인데 그쪽만 물었다 */}
                  <ConfirmAction
                    label={t('task.release_abandon')}
                    testId="release-abandon"
                    message={t('task.release_abandon_confirm')}
                    detail={t('task.release_abandon_detail')}
                    confirmLabel={t('task.release_abandon')}
                    pending={release.isPending}
                    onConfirm={() => release.mutate('abandon')}
                  />
                </>
              )}
            </div>
            <ul className="flex flex-col gap-1">
              {rows(data['claims']).map((claim) => {
                const remaining =
                  claim['status'] === 'active'
                    ? secondsUntil(claim['lease_expires_at'], now)
                    : null;
                const scope = [
                  ...(Array.isArray(claim['scope_spec_ids'])
                    ? (claim['scope_spec_ids'] as string[])
                    : []),
                  ...(Array.isArray(claim['scope_file_globs'])
                    ? (claim['scope_file_globs'] as string[])
                    : []),
                ];
                return (
                  <li key={String(claim['id'])} className="flex flex-col gap-0.5 text-xs">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{claimStatusText(t, claim['status'])}</span>
                      <span className="font-mono">
                        {String(claim['hostname'] ?? t('task.claim_human'))}
                      </span>
                      <span className="text-text-mute">{String(claim['agent_type'] ?? '')}</span>
                      <Mono>{String(claim['external_session_id'] ?? '')}</Mono>
                      {/* 이 작업을 쥔 세션이 **지금 무엇을 하는지** 보러 간다(명세 그림의 [세션 보기 ▸]) */}
                      {typeof claim['agent_session_id'] === 'string' && (
                        <EntityLink
                          projectSlug={proj}
                          entity={{ kind: 'session', id: claim['agent_session_id'] }}
                          testId="claim-session-link"
                        >
                          {t('task.claim_session_link')}
                        </EntityLink>
                      )}
                      {/* **리스는 흐른다**(SCR-06) — 만료 시각에서 매초 다시 센다 */}
                      {remaining !== null && (
                        <span data-testid="claim-lease" className="text-text-faint">
                          {t('task.claim_lease', { remaining: leaseRemaining(t, remaining) })}
                        </span>
                      )}
                    </span>
                    {/* 선언한 범위 — 겹침 판정이 보는 것이 무엇인지 사람도 봐야 한다 */}
                    {scope.length > 0 && (
                      <span data-testid="claim-scope" className="text-2xs text-text-faint">
                        {t('task.claim_scope')}: {scope.join(' · ')}
                      </span>
                    )}
                  </li>
                );
              })}
              {rows(data['claims']).length === 0 && (
                <li className="text-sm text-text-faint">{t('common.none')}</li>
              )}
            </ul>
          </Card>

          {showGate && (
            <div ref={gateRef}>
              <Card data-testid="done-gate">
                <SectionTitle>{t('task.done_gate')}</SectionTitle>
                <div className="flex flex-col gap-3">
                  <fieldset className="flex flex-col gap-1.5 text-sm">
                    <legend className="mb-1 text-xs font-medium text-text-mute">
                      {t('task.spec_impact')}
                      <span className="ml-1 font-normal text-text-faint">
                        — {t('task.spec_impact_note')}
                      </span>
                    </legend>
                    {(['none', 'some'] as const).map((choice) => (
                      <label key={choice} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="spec-impact"
                          data-testid={`spec-impact-${choice}`}
                          checked={specImpact === choice}
                          onChange={() => setSpecImpact(choice)}
                        />
                        {t(choice === 'none' ? 'task.spec_impact_none' : 'task.spec_impact_some')}
                      </label>
                    ))}
                  </fieldset>
                  {specImpact === 'some' && (
                    <Textarea
                      data-testid="spec-impact-note"
                      value={specImpactNote}
                      onChange={(e) => setSpecImpactNote(e.target.value)}
                      placeholder={t('task.spec_impact_placeholder')}
                      rows={2}
                    />
                  )}
                  <div className="flex gap-2">
                    {/* **어휘는 `@nerv/schema` 가 정본이다**(2026-09-10 · REQ-WEB-160 · REQ-CB-006).
                  여섯 중 넷을 여기 손으로 적어 두어 `review`·`user_guide` 증적은 웹에서
                  붙일 길이 없었다 — 서버는 처음부터 여섯을 받는데. 손으로 적은 목록은
                  어휘가 늘어도 함께 늘지 않는다. */}
                    <Select value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)}>
                      {EVIDENCE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {evidenceKindText(t, k)}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={evidenceLocator}
                      onChange={(e) => setEvidenceLocator(e.target.value)}
                      placeholder={t('task.evidence_placeholder')}
                      className="min-w-0 flex-1"
                    />
                  </div>
                  {/* 붙은 증적이 없으면 **누르기 전에** 말한다 — 게이트가 거절한 뒤에 알면 늦다 */}
                  {evidence.length === 0 && evidenceLocator.trim() === '' && (
                    <p data-testid="evidence-none-yet" className="text-xs text-status-waiting">
                      {t('task.evidence_none_yet')}
                    </p>
                  )}
                  {rejection !== null && (
                    <p
                      role="alert"
                      data-testid="transition-rejected"
                      className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
                    >
                      {t('task.transition_rejected', { message: rejection.message })}
                      {rejection.missing.length > 0 &&
                        t('task.transition_missing', { missing: rejection.missing.join(', ') })}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <Button
                      variant="primary"
                      data-testid="to-done"
                      disabled={
                        status === 'done' ||
                        transition.isPending ||
                        !canFinish ||
                        finishBlock !== null
                      }
                      onClick={() => transition.mutate('done')}
                      disabledReason={
                        !canFinish ? t('task.done_needs_claim') : (finishBlock ?? undefined)
                      }
                      title={
                        canFinish && finishBlock === null && rejection !== null
                          ? t('task.last_rejection', { message: rejection.message })
                          : undefined
                      }
                    >
                      {t('task.to_done')}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* 막힘 표시 — 끝나지도 막히지도 않은 작업에만. 완료 폼과 섞어 두면 backlog·ready 에서도
            완료 폼이 통째로 펼쳐져 있어야 했다 */}
          {status !== 'done' && status !== 'blocked' && (
            <Card>
              <SectionTitle>{t('task.mark_blocked')}</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                {/* **자유 텍스트가 아니라 어휘 4종이다**(2026-09-06 · REQ-API-117). 예전에는
                  아무 문장이나 받아 서버에 그대로 실었고, 그러면 막힘 필터가 그 순간부터
                  사실을 못 센다 — 같은 뜻을 사람마다 다른 문자열로 적기 때문이다.
                  고르는 것으로 바꾸면 화면이 서버가 받을 것만 보인다(§1.8). */}
                <Select
                  value={blockedReason}
                  onChange={(e) => setBlockedReason(e.target.value)}
                  aria-label={t('task.blocked_reason')}
                  className="w-56"
                >
                  <option value="">{t('task.blocked_reason')}</option>
                  {BLOCKED_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {t(blockedReasonLabelKey(reason))}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="danger"
                  data-testid="to-blocked"
                  disabled={blockedReason.trim() === '' || transition.isPending || !canMove}
                  onClick={() => transition.mutate('blocked')}
                  disabledReason={
                    canMove
                      ? undefined
                      : t('task.next.roles_only', {
                          roles: rolesWithScope('task:update').join(' · '),
                        })
                  }
                  title={canMove ? t('task.blocked_reason_title') : undefined}
                  requiresOnline
                >
                  {t('task.to_blocked')}
                </Button>
              </div>
            </Card>
          )}

          {/* **증적은 보러 갈 수 있어야 한다**(2026-09-10 — 사람 지시 · REQ-WEB-159). 명세
            §2.5 (6) 은 처음부터 "PR·커밋 링크" 라고 적었는데 화면은 종류와 위치를 글자로만
            그렸다 — 증적은 "보일 것을 붙였다" 는 약속이고, 그것을 확인하는 길이 없으면
            약속이 절반만 지켜진다. **새 탭으로 연다**: 여기서 done 전이를 하는 중이라
            같은 탭에서 나가면 채워 둔 폼(스펙 영향·증적)이 사라진다. */}
          <Card>
            <SectionTitle>{t('task.evidence')}</SectionTitle>
            <ul className="flex flex-col">
              {evidence.map((e) => {
                const target = evidenceTarget({
                  kind: String(e['kind']),
                  locator: String(e['locator']),
                  repoUrl,
                  defaultBranch,
                  repoHost,
                  // 이 증적이 선 저장소가 따로 있으면 그것이 이긴다(REQ-API-157)
                  repo: typeof e['repo'] === 'string' ? e['repo'] : null,
                  projectSlug: proj,
                });
                return (
                  <li
                    key={String(e['id'])}
                    data-testid="task-evidence"
                    className="flex gap-2 border-b border-border py-1.5 text-xs last:border-0"
                  >
                    <span className="w-24 shrink-0 text-text-faint">
                      {evidenceKindText(t, e['kind'])}
                    </span>
                    {target === null ? (
                      <span className="truncate">{String(e['locator'])}</span>
                    ) : (
                      <a
                        href={target.href}
                        target="_blank"
                        rel="noreferrer"
                        data-testid="evidence-link"
                        title={t('task.evidence_open')}
                        className="truncate text-link hover:underline"
                      >
                        {String(e['locator'])}
                      </a>
                    )}
                  </li>
                );
              })}
              {evidence.length === 0 && (
                <li className="text-sm text-text-faint">{t('common.not_yet')}</li>
              )}
            </ul>
            {/* 링크가 아닌 이유 중 사람이 고칠 수 있는 것 하나는 화면이 말한다 — 빈칸은
              "링크 없는 증적" 으로 읽히지 "설정이 비었다" 로 읽히지 않는다(§1.5) */}
            {needsRepoUrl(
              evidence.map((e) => ({ kind: String(e['kind']) })),
              repoUrl,
            ) && (
              <p data-testid="evidence-no-repo" className="mt-2 text-2xs text-text-faint">
                {t('task.evidence_no_repo')}
              </p>
            )}
          </Card>

          {/* **리뷰는 Task 에서도 보인다**(2026-09-07 · REQ-WEB-148 · FR-13 양방향 드릴다운).
            리뷰 → Task 방향만 있어서, 작업 상세에서 "이 작업이 리뷰를 지났는가" 를 알 길이
            없었다 — done 게이트가 그것을 조건으로 삼는데도 그랬다. */}
          <Card>
            <SectionTitle>{t('task.reviews')}</SectionTitle>
            <ul className="flex flex-col">
              {rows(data['reviews']).map((r) => (
                <li
                  key={String(r['id'])}
                  data-testid="task-review"
                  className="flex flex-wrap items-center gap-2 border-b border-border py-1.5 text-xs last:border-0"
                >
                  {/* 그 브랜치의 **발견으로** 간다 — "열린 critical 2건" 을 붉게 적고 그 발견들로 가는 길이 없었다 */}
                  <EntityLink
                    projectSlug={proj}
                    entity={{ kind: 'findings', branch: String(r['branch']) }}
                    testId="review-branch-link"
                  >
                    <Mono>{String(r['branch'])}</Mono>
                  </EntityLink>
                  <span className="text-text-faint">
                    {reviewKindText(t, r['kind'])} · R{String(r['round_no'])} ·{' '}
                    {reviewStateText(t, r['state'])}
                  </span>
                  {Number(r['open_critical'] ?? 0) > 0 && (
                    <span data-testid="review-open-critical" className="text-status-danger">
                      {t('task.reviews.open_critical', { n: Number(r['open_critical']) })}
                    </span>
                  )}
                </li>
              ))}
              {rows(data['reviews']).length === 0 && (
                <li className="text-sm text-text-faint">{t('task.reviews.none')}</li>
              )}
            </ul>
          </Card>
        </div>
      </PageBody>
    </TaskSheet>
  );
}

/** 위임 명세 한 요소 — 라벨은 작게, 본문은 그대로. 4요소가 나란히 보여야 빈 칸이 눈에 띈다 */
function Element({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-0.5 text-2xs font-medium tracking-wide text-text-faint uppercase">
        {label}
      </div>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}
