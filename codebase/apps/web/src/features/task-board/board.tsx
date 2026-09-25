// S4 작업 보드 (ui-wireframes §2.4 · screens.md §2.5) — 레이아웃 라우트 `routes/p.$proj/tasks.tsx` 가 그린다
//
// **보드는 작업 상세 뒤에 남는다**(2026-09-24 사람 결정 · NAV-08 · WORK-05 · REQ-WEB-213). 상세가 보드를
// 통째로 갈아 끼우는 페이지였을 때는 "← 보드로" 한 번에 걸어 둔 필터와 펼친 레인이 사라졌다 — 명세는
// 처음부터 "보드 위 오버레이" 였다. 그래서 보드가 라우트 파일이 아니라 여기 산다: 상세는 이 보드
// 위에 시트로 열리고, 보드는 언마운트되지 않는다.
//
// **`ready` 로 직접 만들 수 없다**는 규칙이 이 화면의 형태를 정한다(FR-05). 미완성 항목은
// backlog 칸에 "무엇이 비었는지"와 [채우기]로 남고, 4요소가 다 찬 backlog 카드에는
// **[준비됨으로 올리기]** 가 선다 — 사람이 누르면 서버가 4요소·의존을 판정해 큐에 넣는다.
// 클레임 가능한 작업 = 지시가 완결된 작업이라는 등식이 여기서 눈에 보여야 한다.
//
// 2026-09-24 까지는 그 단추가 없었다(REQ-WEB-202). 생성은 언제나 backlog 인데 [채우기]는 4요소가
// 빈 카드에만 섰고 옆의 "ready 전이" 단추는 늘 잠겨 있어서, 웹에서 4요소를 다 채워 만든 작업은
// 에이전트의 큐에 영영 닿지 않았다.

import {
  statusLabelKey,
  rolesWithScope,
  scopesForRoles,
  TASK_CREATE_ROLES,
  TASK_DONE_WINDOW_DAYS,
  TASK_EDIT_ROLES,
} from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { DelegationForm } from './delegation-form.js';
import { leaseRemaining, relativeTime } from '../session-monitor/format.js';
import { blockedReasonText } from '../../lib/format.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { useMe, useProject, useTaskLane } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';
import {
  Avatar,
  Button,
  PageBody,
  PageHeader,
  Skeleton,
  SummaryStrip,
} from '../../components/ui/primitives.js';
import { EntityLink } from '../../components/entity-link.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import type { SummaryMetric } from '../../components/ui/primitives.js';
import { asProjectId } from '../../lib/query-keys.js';
import type { ProjectId } from '../../lib/query-keys.js';
import { boardFilters } from './board-search.js';
import type { TaskBoardSearch } from './board-search.js';

/**
 * 레인 — screens.md §2.5.
 *
 * `blocked` 는 원래 **하단 접이식**이었는데 가로줄 **맨 앞**으로 옮겼다(2026-08-23, 사람 판단).
 * 아래에 두면 보드를 다 지나 스크롤해야 닿고, 흐름 끝에 두면 여섯 번째 칸이라 1440px
 * 화면에서도 잘린다 — 둘 다 "있긴 한데 안 보인다"이다. 막힌 일은 **가장 먼저 보여야
 * 하는 것**이지 각주가 아니라서 흐름(ready→done) 앞에 세운다: "이것부터 풀고 나머지를
 * 보라"가 이 보드가 할 말이다. `backlog` 는 여전히 필터이지만 **기본이 켜짐**이다
 * (2026-09-08) — 끄면 방금 만든 Task 가 어느 레인에도 없다.
 */
/** 레인 하나가 처음 그리는 카드 수 — 시안은 4장 + "+N개 더" 다 */
const LANE_CAP = 8;

const LANES = ['blocked', 'ready', 'claimed', 'in_progress', 'in_review', 'done'] as const;

/**
 * "내 담당" 이 세는 범위 — 끝나지 않은 것 전부다(`done` 은 뺀다).
 *
 * 전표는 상태를 쉼표로 받는다(EP-TASK-01). 한 상태로 좁히면 라벨과 값이 어긋난다.
 */
const MINE_LANES = 'ready,claimed,in_progress,in_review,blocked';

/** 레인 이름은 `task_status` 어휘다 — 토큰·라벨 표를 그대로 색인한다 */
type Lane = keyof typeof TASK_TOKEN;

/**
 * 레인 점 색 — **§4.2 상태 토큰의 진한 쪽**을 그대로 쓴다(새 색을 만들지 않는다).
 * 배지는 soft 배경 + 같은 계열 글자였는데, 맨 점은 배경이 없으니 진한 값이 필요하다.
 */
const LANE_DOT: Record<Lane, string> = {
  backlog: 'bg-status-idle-text',
  ready: 'bg-status-action',
  claimed: 'bg-status-agent',
  in_progress: 'bg-status-progress',
  in_review: 'bg-status-waiting',
  done: 'bg-status-done',
  blocked: 'bg-status-danger',
};

/** 만료까지 남은 초 — 음수면 이미 만료다(회수는 워커가 한다). */
function leaseSeconds(expiresAt: string): number {
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
}

export function TaskBoard(): React.JSX.Element {
  const t = useT();
  const { proj } = useParams({ from: '/p/$proj/tasks' });
  const project = useProject(proj);
  const me = useMe();
  const projectId = project.data?.['id'];
  const [editing, setEditing] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const { orgSlug } = useScope(proj);
  // **역할이 문을 정한다**(REQ-WEB-203). 서버 가드와 같은 목록(`@nerv/schema`)을 본다 — 예전에는
  // [+ 새 작업]·[채우기]가 누구에게나 켜져 있어, designer 는 폼을 다 채우고 저장한 뒤에야 403 을 받았다
  const roles = rolesInProject(me.data, orgSlug, proj);
  const hasRole = (list: readonly string[]): boolean => roles.some((r) => list.includes(r));
  const rolesOnly = (list: readonly string[]): string =>
    t('task.next.roles_only', { roles: list.join(' · ') });
  const canCreate = hasRole(TASK_CREATE_ROLES);
  // 보관은 **끄고 시작한다** — 스펙 아카이브(REQ-API-022)와 같은 규약이다.
  //
  // **백로그는 켜고 시작한다**(2026-09-08, 사람 판단). 생성은 언제나 `backlog` 이므로
  // (EP-TASK-03 · FR-05) 방금 만든 Task 는 승격 전까지 이 레인에만 있다 — 기본이 꺼짐이면
  // 만든 사람에게는 "티켓이 사라진" 것으로 보인다. 주소에는 **끈 상태만** 남는다(`?backlog=0`).
  const {
    spec,
    assignee,
    ai: agentOnly = false,
    backlog: backlogParam,
    archived: showArchived = false,
    from_version: fromVersion,
    from_spec: fromSpec,
    from_version_no: fromVersionNo,
    requirement: fromRequirement,
  } = useSearch({ from: '/p/$proj/tasks' });
  const showBacklog = backlogParam ?? true;
  /**
   * **S3 에서 온 파생**(REQ-WEB-147). 스펙 상세의 "이 버전에서 파생" 이 주소로 보낸 값이
   * 그대로 폼의 초기값이 된다 — 그래야 링크를 공유해도 같은 화면이 열린다(D-09).
   */
  const derived =
    fromVersion === undefined || fromSpec === undefined
      ? null
      : {
          specKey: fromSpec,
          versionId: fromVersion,
          versionNo: Number(fromVersionNo ?? 0),
          ...(fromRequirement === undefined ? {} : { requirementId: fromRequirement }),
        };
  const id = asProjectId(projectId);
  const filters = {
    ...(spec === undefined ? {} : { spec }),
    ...(agentOnly ? { ai: true } : {}),
  };
  /** 뷰 상태는 서로를 지우지 않는다 — 하나를 바꿀 때 나머지를 그대로 싣는다 */
  const searchWith = (patch: {
    backlog?: boolean;
    archived?: boolean;
    ai?: boolean;
  }): { spec?: string; assignee?: string; ai?: true; backlog?: false; archived?: true } => ({
    ...(spec === undefined ? {} : { spec }),
    ...(assignee === undefined ? {} : { assignee }),
    ...((patch.ai ?? agentOnly) ? { ai: true as const } : {}),
    ...((patch.backlog ?? showBacklog) ? {} : { backlog: false as const }),
    ...((patch.archived ?? showArchived) ? { archived: true as const } : {}),
  });
  const toBoard = (search: ReturnType<typeof searchWith>): void =>
    void navigate({ to: '/p/$proj/tasks', params: { proj }, search });

  const lanes = [...(showBacklog ? (['backlog'] as const) : []), ...LANES];

  // 요약 숫자 — **레인과 같은 쿼리 키를 쓴다.** React Query 가 같은 키를 합쳐 주므로
  // 레인이 이미 부른 것을 다시 부르지 않는다. 한 페이지를 채웠으면 `+` 를 붙인다:
  // 그냥 30 이라고 적으면 사람은 그것이 전부라고 읽는다.
  const inProgress = useTaskLane(proj, id, 'in_progress', filters);
  const ready = useTaskLane(proj, id, 'ready', filters);
  const blocked = useTaskLane(proj, id, 'blocked', filters);
  // **"내 담당"이 없으면 이 줄은 절반만 답한다** — 조직 전체가 몇 개를 돌리는지는
  // 알려 주는데 "그중 내가 쥔 것"은 카드를 뒤져야 나온다(시안 대조 2026-08-23).
  const meId = typeof me.data?.id === 'string' ? me.data.id : undefined;
  // **"내 담당" 은 상태가 아니라 사람이다**(2026-09-03 정정). 예전에는 `in_progress` 로 못
  // 박아 두어서, 담당이 지정된 Task 가 `ready`·`blocked` 면 그 사람의 "내 담당" 이 0 이었다 —
  // 실측: 담당이 있는 Task 3건(ready 2 · blocked 1)이 세 사람 모두에게 0으로 보였다.
  // 라벨이 "내 담당" 인데 값이 "내가 지금 붙잡고 있는 것" 이면 둘은 다른 질문이다.
  const mine = useTaskLane(proj, meId === undefined ? undefined : id, MINE_LANES, {
    ...filters,
    ...(meId === undefined ? {} : { assignee: meId }),
  });
  const count = (q: ReturnType<typeof useTaskLane>): string => {
    const items = q.data?.items ?? [];
    return `${items.length}${q.data?.next_cursor != null ? '+' : ''}`;
  };
  const summary: SummaryMetric[] = [
    { label: t('tasks.summary.in_progress'), value: count(inProgress), tone: 'progress' },
    { label: t('tasks.summary.ready'), value: count(ready) },
    { label: t('tasks.summary.blocked'), value: count(blocked), tone: 'danger' },
    { label: t('tasks.summary.mine'), value: count(mine) },
  ];

  /**
   * **[준비됨으로 올리기]** — 4요소가 다 찬 backlog 카드의 문(REQ-WEB-202). 서버가 4요소·선행
   * 의존을 판정하고(전이 `ready` · REQ-API-131), 거절이면 그 사유를 기본 처리기가 말한다.
   * 생성을 곧장 ready 로 잇지 않는 이유는 규칙(FR-05 "생성은 언제나 backlog")이다 — 사람이 누른다.
   */
  const toReady = useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/tasks/${taskId}/transition`, {
        method: 'POST',
        body: { status: 'ready' },
      }),
    onSuccess: () => {
      if (id !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(id) });
      }
      pushToast({ tone: 'ok', message: t('tasks.to_ready_done') });
    },
    onError: onApiError,
  });
  const controls: CardControls = {
    onEdit: setEditing,
    onToReady: (taskId) => toReady.mutate(taskId),
    pending: toReady.isPending,
    editBlock: hasRole(TASK_EDIT_ROLES) ? null : rolesOnly(TASK_EDIT_ROLES),
    moveBlock: scopesForRoles(roles).has('task:update')
      ? null
      : rolesOnly(rolesWithScope('task:update')),
  };

  return (
    <PageBody wide>
      <PageHeader
        title={t('tasks.title')}
        actions={
          <Button
            variant="primary"
            data-testid="task-new"
            disabled={!canCreate}
            title={canCreate ? undefined : rolesOnly(TASK_CREATE_ROLES)}
            onClick={() => setEditing('new')}
          >
            {t('tasks.new')}
          </Button>
        }
      />

      {(editing !== null || derived !== null) && (
        <div className="mb-4">
          <DelegationForm
            projectSlug={proj}
            projectId={id}
            taskKey={editing === 'new' || editing === null ? null : editing}
            {...(derived === null ? {} : { initial: derived })}
            onDone={() => {
              setEditing(null);
              // 폼을 닫으면 주소도 닫는다 — 남겨 두면 새로고침이 같은 폼을 다시 연다
              // 파생 인자만 털어 낸다 — 나머지 뷰 상태(필터·토글)는 그대로 둔다
              if (derived !== null) toBoard(searchWith({}));
            }}
          />
        </div>
      )}

      {/* **요약이 먼저다**(2026-08-23 재검토). 목록부터 그리면 사람은 카드를 세면서
          전체를 짐작해야 하고, 그 짐작이 화면을 볼 때마다 반복된다. 필터는 그 줄
          오른쪽에 붙는다 — 보드 위에 두는 이유는 레인 머리에 붙이면 어느 레인의
          설정인지 헷갈리기 때문이고, `보관 보기`는 done 만 바꾸지만 `백로그 보기`는
          레인 자체를 늘린다 */}
      <SummaryStrip
        className="mb-5"
        metrics={summary}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FilterToggle
              testId="filter-backlog"
              on={showBacklog}
              onClick={() => toBoard(searchWith({ backlog: !showBacklog }))}
              label={t('tasks.filter.backlog')}
            />
            <FilterToggle
              testId="filter-ai"
              on={agentOnly}
              onClick={() => toBoard(searchWith({ ai: !agentOnly }))}
              label={t('tasks.filter.ai')}
              title={t('tasks.filter.ai_title')}
            />
            <FilterToggle
              testId="filter-archived"
              on={showArchived}
              onClick={() => toBoard(searchWith({ archived: !showArchived }))}
              label={t('tasks.filter.archived')}
              title={t('tasks.filter.archived_title', { days: TASK_DONE_WINDOW_DAYS })}
            />
          </div>
        }
      />

      {/* 레인을 화면 폭에 욱여넣지 않는다 — 좁으면 가로로 민다. 억지로 접으면 순서
          (ready → … → done)가 깨지고, 그 순서가 이 보드의 의미 전부다 */}
      <div className="-mx-6 flex gap-[22px] overflow-x-auto px-6 pb-2">
        {lanes.map((lane) => (
          <Lane
            key={lane}
            proj={proj}
            projectId={id}
            lane={lane}
            includeArchived={showArchived}
            filters={filters}
            assignee={assignee}
            controls={controls}
          />
        ))}
      </div>
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

/** 레인 하나 — **자기 질의를 자기가 갖는다**(queries.ts `useTaskLane` 주석) */
function Lane({
  proj,
  projectId,
  lane,
  includeArchived,
  filters,
  assignee,
  controls,
}: {
  proj: string;
  projectId: ProjectId | undefined;
  lane: Lane;
  includeArchived: boolean;
  filters: { spec?: string; ai?: boolean };
  assignee: string | undefined;
  controls: CardControls;
}): React.JSX.Element {
  const t = useT();
  // 창은 done 에만 의미가 있다 — 다른 레인에 실어 보내면 쿼리 키만 둘로 갈라진다
  const query = useTaskLane(proj, projectId, lane, {
    ...filters,
    ...(assignee === undefined ? {} : { assignee }),
    includeArchived: lane === 'done' && includeArchived,
  });
  // 막힘은 **흐르지 않는 일**이다 — 같은 가로줄에 있되 레인 자체가 그렇게 보여야 한다
  const halted = lane === 'blocked';
  // 레인 접기(시안) — 머리 전체가 토글이다. 접힌 레인은 이름과 수만 남는다.
  const [collapsed, setCollapsed] = useState(false);
  // **레인은 잘라 그린다**(시안 "+N개 더"). 진행 중 24장을 다 세우면 보드가 세로
  // 2,600px 가 되고(실측 2026-08-24), 그때 다른 레인은 화면 밖의 소문이 된다.
  const [cap, setCap] = useState(LANE_CAP);
  const all = query.data?.items ?? [];
  const items = collapsed ? [] : all.slice(0, cap);
  const hidden = all.length - items.length;
  const more = query.data?.next_cursor !== null && query.data?.next_cursor !== undefined;

  // **레인에 배경을 두지 않는다**(시안 대조 2026-08-23). 가라앉은 상자를 다섯 개
  // 세우면 화면이 다시 격자가 되고, 카드에서 걷어낸 테두리가 레인 단위로 되살아난
  // 꼴이 된다. 카드는 페이지 위에 뜬다 — 레인을 나누는 것은 상자가 아니라 **간격과
  // 머리글**이다. 막힘만 예외다: 성질이 다른 레인이라 바탕을 아주 옅게 깐다.
  return (
    <section
      data-testid={`column-${lane}`}
      className={cn(
        'flex w-[268px] shrink-0 flex-col',
        halted && 'rounded-nerv bg-status-danger-soft/30 p-2',
      )}
    >
      {/* **알약이 아니라 맨 점이다**(시안 대조 2026-08-23). 배지는 배경을 깔아
                  그 자체가 하나의 요소가 되는데, 레인 머리는 요소가 아니라 이름표다.
                  점은 색만 나르고 이름은 글자가 나른다 — REQ-WEB-033 은 그대로다.
                  머리 전체가 접기 토글이다(시안) — 지금 안 보는 레인은 이름만 남긴다. */}
      <h2>
        <button
          type="button"
          data-testid={`lane-toggle-${lane}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-[7px] px-1 pb-2.5 text-left"
        >
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', LANE_DOT[lane])}
          />
          {/* `statusLabelKey` 는 **키**를 준다 — 번역을 거치지 않으면 화면에
                      `status.task.ready` 가 그대로 찍힌다(실측 2026-08-23) */}
          <span className="text-sm font-semibold tracking-[-0.005em] text-text">
            {t(statusLabelKey('task', lane))}
          </span>
          {/* 한 페이지를 채웠으면 **뒤에 더 있다**는 뜻이다 — 그냥 30 이라고
                      적으면 사람은 그것이 전부라고 읽는다 */}
          <span className="text-xs tabular-nums text-text-faint">
            {all.length}
            {more ? '+' : ''}
          </span>
          <span aria-hidden="true" className="ml-auto text-[10px] text-text-ghost">
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
      </h2>
      {/* 로딩은 화면 골격으로 — 스피너 단독 금지(§1.5). 레인마다 따로 부르므로
                  빠른 레인이 먼저 차고 느린 레인만 골격으로 남는다 */}
      {query.isLoading && !collapsed && <Skeleton rows={3} className="[&>div]:h-12" />}
      {/* **실패는 빈 레인이 아니다**(REQ-WEB-198) — "비어 있음" 을 그리면 사람은 그 레인에
          일이 없다고 읽는다. 레인마다 따로 부르므로 실패도 그 레인 하나만 말한다 */}
      {!collapsed && failedWithoutData(query) && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}
      {!collapsed && (
        <ul className="flex flex-col gap-1">
          {items.map((task) => (
            <li key={String(task['id'])}>
              <TaskCard proj={proj} task={task} lane={lane} controls={controls} />
            </li>
          ))}
          {all.length === 0 && query.data !== undefined && (
            // 시안의 빈 레인: 점선 상자 — "없는 것"과 "아직 안 온 것"을 가른다
            <li className="rounded-[7px] border border-dashed border-border p-3 text-center text-sm text-text-ghost">
              {t('tasks.empty_column')}
            </li>
          )}
        </ul>
      )}
      {!collapsed && hidden > 0 && (
        <button
          type="button"
          data-testid={`lane-more-${lane}`}
          onClick={() => setCap(cap + LANE_CAP)}
          className="px-3 py-2 text-left text-sm text-text-faint hover:text-text"
        >
          {t('tasks.lane_more', { count: hidden })}
        </button>
      )}
    </section>
  );
}

/**
 * 작업 카드. 레인이 이미 상태를 말하므로 카드에 상태 배지를 또 붙이지 않는다 —
 * 붙이면 한 레인에 같은 배지가 열 개 세로로 늘어선다.
 */
/** 카드가 부르는 문 — 역할 판정은 보드가 한 번 하고 카드는 그 결과를 쓴다 */
interface CardControls {
  onEdit: (key: string) => void;
  onToReady: (taskId: string) => void;
  pending: boolean;
  /** 위임 명세를 고칠 수 없는 이유(EP-TASK-05 의 역할) — 없으면 `null` */
  editBlock: string | null;
  /** 상태를 옮길 수 없는 이유(`task:update`) — 없으면 `null` */
  moveBlock: string | null;
}

function TaskCard({
  proj,
  task,
  lane,
  controls,
}: {
  proj: string;
  task: Record<string, unknown>;
  lane: Lane;
  controls: CardControls;
}): React.JSX.Element {
  const t = useT();
  // 주의가 필요한 것 = 기준 버전이 지나갔거나 재브리핑이 걸렸거나 막힌 것
  const needsAttention =
    task['basis_superseded'] === true ||
    (task['rebrief_required_at'] !== null && task['rebrief_required_at'] !== undefined) ||
    lane === 'blocked';
  return (
    // **테두리를 걷어냈다**(2026-08-23 재검토). 칸마다 같은 상자가 스무 개 서면 화면이
    // 표가 되고, 그때 눈은 어느 것도 붙잡지 못한다. 평소에는 배경 없이 두고 hover 로
    // 만져지는 것만 알린다 — 주의가 필요한 카드만 왼쪽 2px 룰로 스스로 튄다.
    <article
      className={cn(
        'group rounded-[7px] border-l-2 py-2.5 pr-[11px] pl-2.5 transition-colors hover:bg-bg-sunken',
        needsAttention ? 'border-l-status-waiting' : 'border-l-transparent',
      )}
    >
      {/* 칸이 이미 상태를 말한다 — 카드마다 같은 배지를 또 붙이면
          칸 하나에 같은 배지 열 개가 세로로 늘어선다 */}
      <div className="flex items-start gap-2">
        <Link
          to="/p/$proj/tasks/$task"
          params={{ proj, task: String(task['key']) }}
          // 걸어 둔 필터를 **물고 간다** — 시트 뒤의 보드가 같은 모양으로 남는다(REQ-WEB-213)
          search={(prev: TaskBoardSearch) => boardFilters(prev)}
          className="min-w-0 flex-1 text-base leading-[1.42] font-medium tracking-[-0.008em] hover:text-link"
        >
          {String(task['title'])}
        </Link>
        {/* 만져지는 카드라는 표시 — 평소에는 없다가 hover 에서만 뜬다 */}
        <span
          aria-hidden="true"
          className="shrink-0 leading-none text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
        >
          ⋯
        </span>
      </div>
      {task['basis_superseded'] === true && (
        // 기준 버전이 지나갔다 — 재브리핑 신호(agent-integration §2.4).
        // 메타 줄에 섞어 두면 흐린 글자 사이에 묻힌다 — 제 줄을 준다.
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-nerv-sm bg-status-waiting-soft px-1.5 py-0.5 text-2xs font-medium text-status-waiting">
          <span aria-hidden="true">↑</span>
          {t('tasks.basis_superseded')}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-text-faint">
        {/* **누구 것인가를 읽지 않고 알아보게 한다** — 이름을 글자로 늘어놓으면
            줄마다 같은 굵기의 텍스트가 하나 더 늘 뿐이다 */}
        {typeof task['assignee_name'] === 'string' && (
          // 이니셜만 서는 자리라 **이름을 툴팁·스크린리더로** 준다(REQ-WEB-209) — 같은 이니셜 둘을 가를 수
          // 없었고 읽는 도구에는 아무것도 읽히지 않았다. 글자로 늘어놓지는 않는다(§2.4d)
          <Avatar
            name={task['assignee_name']}
            size="sm"
            label={t('task.meta.assignee', { name: task['assignee_name'] })}
          />
        )}
        {/* **에이전트가 돌리고 있다** — 세션으로 가는 작은 표식(D-08 사람 담당·에이전트 위임 분리 · REQ-WEB-209) */}
        {typeof task['claim_session_id'] === 'string' &&
          typeof task['claim_hostname'] === 'string' && (
            <EntityLink
              projectSlug={proj}
              entity={{ kind: 'session', id: task['claim_session_id'] }}
              testId="task-card-runner"
              title={t('tasks.card_runner', {
                host: task['claim_hostname'],
                agent: String(task['claim_agent_type'] ?? ''),
              })}
              className="rounded-nerv-sm bg-status-agent-soft px-1 text-2xs font-medium text-status-agent hover:no-underline"
            >
              AI
            </EntityLink>
          )}
        {/* 우선순위는 레인의 정렬 기준이다 — **급한 둘만** 작게 보인다(다 보이면 신호가 아니다) */}
        {(task['priority'] === 'P0' || task['priority'] === 'P1') && (
          <span
            data-testid="task-card-priority"
            className={cn(
              'rounded-nerv-sm px-1 text-2xs font-medium',
              task['priority'] === 'P0'
                ? 'bg-status-danger-soft text-status-danger'
                : 'bg-status-waiting-soft text-status-waiting',
            )}
          >
            {String(task['priority'])}
          </span>
        )}
        <span className="font-mono tracking-[-0.02em] text-text-ghost">{String(task['key'])}</span>
        {/* 어느 스펙에서 나온 일인가 — 흐리게, 누르면 그 스펙으로 */}
        {typeof task['spec_key'] === 'string' && (
          <EntityLink
            projectSlug={proj}
            entity={{ kind: 'spec', key: task['spec_key'] }}
            testId="task-card-spec"
            className="font-mono text-text-ghost hover:text-link"
          />
        )}
        {/* **경과 시간은 오른쪽 끝에 붙는다**(시안 대조 2026-08-23). 카드가 스무 장
            늘어선 칸에서 "얼마나 묵었나"는 세로로 훑히는 값이라 열이 맞아야 읽힌다 —
            메타 줄 가운데에 섞어 두면 카드마다 위치가 달라 매번 찾아야 한다. */}
        <span className="ml-auto shrink-0 tabular-nums">
          {relativeTime(t, String(task['updated_at'] ?? ''))}
        </span>
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
      {task['rebrief_required_at'] !== null && task['rebrief_required_at'] !== undefined && (
        // 036 — 기준 버전이 지나갔다는 사실과 어디로 가야 하는지를 함께 준다
        <Link
          to="/p/$proj/tasks/$task"
          params={{ proj, task: String(task['key']) }}
          // 걸어 둔 필터를 **물고 간다** — 시트 뒤의 보드가 같은 모양으로 남는다(REQ-WEB-213)
          search={(prev: TaskBoardSearch) => boardFilters(prev)}
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
          {/* 절대 눌리지 않던 "ready 전이" 단추는 걷었다 — [채우기]가 이 카드의 주 행동이다 */}
          <Button
            size="sm"
            data-testid="card-fill"
            className="mt-1"
            disabled={controls.editBlock !== null}
            title={controls.editBlock ?? t('tasks.ready_blocked_title')}
            onClick={() => controls.onEdit(String(task['key']))}
          >
            {t('tasks.fill_brief')}
          </Button>
        </div>
      )}
      {lane === 'backlog' && task['delegation_complete'] === true && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <Button
            size="sm"
            data-testid="card-to-ready"
            disabled={controls.moveBlock !== null || controls.pending}
            title={controls.moveBlock ?? t('task.next.to_ready_hint')}
            onClick={() => controls.onToReady(String(task['id']))}
          >
            {t('task.next.to_ready')}
          </Button>
        </div>
      )}
      {/* **식별자가 아니라 사람 말이다**(2026-09-07 · REQ-WEB-143). 카드가 코드의 이름을
          그대로 찍고 있었다 — `awaiting_answer` 는 어휘의 값이지 읽으라고 만든 문장이
          아니다. 어휘 밖의 값(옛 자유 텍스트)은 원문 그대로 보인다 */}
      {lane === 'blocked' && (
        <p
          data-testid="card-blocked-reason"
          className="mt-1.5 rounded-nerv-sm bg-status-danger-soft px-1.5 py-1 text-2xs text-status-danger"
        >
          {blockedReasonText(t, task['blocked_reason'])}
        </p>
      )}
    </article>
  );
}
