// /notifications — 알림 센터 (screens.md §2.9)
//
// 알림은 event 참조다 — 문구를 행에 굳혀 저장하지 않고 조회 시점에 만든다(D-10).
// 여기서는 "무엇이 · 어디서 · 언제"만 보이면 되고, 자세한 것은 딥링크가 데려간다.

import { eventLabelKey } from '@nerv/schema';
import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { inOrgHref, useScope } from '../lib/scope.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { queryKeys } from '../lib/query-keys.js';
import { rows, useNotificationScopes, useNotifications, useUnreadCount } from '../lib/queries.js';
import { useRealtime } from '../lib/realtime.js';
import { cn } from '../lib/utils.js';
import {
  collapseRepeats,
  eventSubject,
  eventTarget,
  eventType,
  hrefOf,
} from '../lib/event-subject.js';
import type { EventRow, EventTarget } from '../lib/event-subject.js';
import { StatusBadge } from '../components/status-badge.js';
import { InvitationCards } from '../components/invitation-cards.js';
import {
  Button,
  Disclosure,
  EmptyState,
  LoadMore,
  Mono,
  PageBody,
  PageHeader,
  REVEAL_ON_HOVER,
  Segmented,
  Skeleton,
} from '../components/ui/primitives.js';
import { ActorMark } from '../components/actor-mark.js';
import { ScopeBadge } from '../components/scope-badge.js';
import { ScopeRail, scopeName, scopeTotals } from '../features/inbox/scope-rail.js';
import { levelOf, NotificationLevelControl } from '../features/inbox/notification-level.js';
import type { ScopeRailRow, ScopeSelection } from '../features/inbox/scope-rail.js';
import { ErrorState, failedWithoutData } from '../components/query-state.js';

/** 알림 센터의 주소 — 거르는 칸과 범위가 여기 산다(REQ-WEB-218 · REQ-WEB-253) */
export interface NotificationSearch {
  filter?: 'important' | 'unread';
  /** 조직 slug — `project` 없이 오면 그 조직의 프로젝트 전부다 */
  org?: string;
  /** 프로젝트 slug — `org` 가 그 조직을 정한다(slug 는 조직 안에서만 유일하다) */
  project?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export const Route = createFileRoute('/notifications')({
  validateSearch: (search: Record<string, unknown>): NotificationSearch => {
    const org = text(search['org']);
    const project = text(search['project']);
    return {
      ...(search['filter'] === 'important' || search['filter'] === 'unread'
        ? { filter: search['filter'] }
        : {}),
      ...(org === undefined ? {} : { org }),
      ...(project === undefined ? {} : { project }),
    };
  },
  component: NotificationScreen,
});

/** 범위와 거름을 주소로 — 칸의 링크와 필터가 같은 모양을 쓴다 */
function searchOf(scope: ScopeSelection, filter?: 'important' | 'unread'): NotificationSearch {
  return {
    ...(filter === undefined ? {} : { filter }),
    ...(scope.org === undefined ? {} : { org: scope.org }),
    ...(scope.project === undefined ? {} : { project: scope.project }),
  };
}

/** 묶음 줄의 원인 한 건(2026-09-27 · api.md REQ-API-224) */
interface BatchCause {
  event_id: string;
  occurred_at: string | null;
  actor_name: string | null;
  is_agent: boolean | null;
  /** 재검토 요청이면 바뀐 문서의 키 */
  because_key: string | null;
  /** 작업 준비면 그 작업의 키 */
  task_key: string | null;
}

/**
 * **서버가 센 묶음의 크기**(2026-09-27 · 사람 결정 G2 · REQ-WEB-262). 보통 알림은 같은 대상이면 서버가
 * 읽을 때까지 한 줄에 더한다 — 화면이 불러온 줄 안에서 세던 수가 아니라 전체 수다. 묶지 않은 줄은 1
 */
const batchSize = (n: EventRow): number =>
  typeof n['batch_key'] === 'string' && typeof n['batch_size'] === 'number' ? n['batch_size'] : 1;

const batchCauses = (n: EventRow): BatchCause[] =>
  Array.isArray(n['batch_causes']) ? (n['batch_causes'] as BatchCause[]) : [];

/**
 * 원인 한 건의 이름 — 재검토면 바뀐 문서, 작업 준비면 그 작업, 그 밖(코멘트)이면 남긴 사람. 글자만 이어지는 줄이라
 * 에이전트는 이름 뒤에 "(AI)" — 다른 자리의 AI 칸과 같은 낱말이다(REQ-WEB-277)
 */
const causeName = (c: BatchCause): string =>
  c.because_key ?? c.task_key ?? `${c.actor_name ?? '—'}${c.is_agent === true ? ' (AI)' : ''}`;

/** 줄에 붙는 한 줄 — 서로 다른 이름을 셋까지 적고, 더 있으면 "등" 을 붙인다 */
function causeLine(t: ReturnType<typeof useT>, n: EventRow): string | null {
  if (batchSize(n) <= 1) return null;
  const names = [...new Set(batchCauses(n).map(causeName))];
  if (names.length === 0) return null;
  const list = names.slice(0, 3).join(' · ');
  return names.length > 3 || batchSize(n) > batchCauses(n).length
    ? t('notif.batch.more', { list })
    : list;
}

function hrefOfSearch(search: NotificationSearch): string {
  const params = new URLSearchParams();
  if (search.filter !== undefined) params.set('filter', search.filter);
  if (search.org !== undefined) params.set('org', search.org);
  if (search.project !== undefined) params.set('project', search.project);
  const query = params.toString();
  return `/notifications${query === '' ? '' : `?${query}`}`;
}

/** 알림이 데려갈 곳 — 경로와 **뷰 상태**(피드와 같은 모양이다 · lib/event-subject.ts) */
export type NotificationTarget = EventTarget;

/**
 * 알림 → 대상. 알림은 event 참조라 **여기서 링크를 만든다**(행에 굳혀 저장하지 않는다). 규칙은
 * 활동 피드와 한 곳에 있다(`eventTarget`) — 다른 점은 하나, 알림은 **내게 온 요청**이라 결재·질문이
 * 그 카드로 간다는 것이다(REQ-WEB-204). 이제 결재 알림도 스펙 키를 싣기 때문에(REQ-API-181) 그
 * 규칙이 스펙보다 먼저 선다 — 순서를 바꾸면 "승인 요청" 이 결재할 카드가 아니라 문서로 간다.
 */
export function deepLinkFor(n: EventRow): NotificationTarget {
  return eventTarget(n, 'inbox');
}

/** 요청이 닫힌 방식 — 결재 결정 셋과 질문의 답변·취소 */
function resolutionLabel(t: ReturnType<typeof useT>, value: string): string {
  switch (value) {
    case 'approve':
      return t('inbox.decision.approve');
    case 'reject':
      return t('inbox.decision.reject');
    case 'comment':
      return t('inbox.decision.comment');
    case 'cancelled':
      return t('notif.resolution.cancelled');
    default:
      return t('notif.resolution.answered');
  }
}

function NotificationScreen(): React.JSX.Element {
  const t = useT();
  /**
   * **등급으로 나눠 본다**(2026-09-07 · REQ-WEB-149 · FR-12). 실측 unread 767건 중 결정이
   * 필요한 것은 99건이다 — 한 줄에 섞으면 그 99건은 배경 활동에 묻힌다.
   *
   * **거르는 칸은 늘 보이고 주소에 산다**(2026-09-25 · REQ-WEB-218). 토글이 "안 읽은 것이 있을
   * 때만" 서는 머리 안에 있던 동안, 거른 채 [모두 읽음]을 누르면 토글째 사라지고 목록은 걸러진
   * 채 갇혔다 — 돌아갈 단추도, 걸려 있다는 표시도 없었다(HUB-X3).
   */
  const { filter, org, project } = Route.useSearch();
  /**
   * **범위**(2026-09-27 · 사람 결정 N1 · REQ-WEB-253). 목록은 하나이고, 칸이 그 목록을 조직 · 프로젝트
   * 하나로 좁힌다. 헤더 배지는 그대로 모든 조직을 센다(REQ-WEB-193).
   */
  const scope: ScopeSelection = {
    ...(org === undefined ? {} : { org }),
    ...(project === undefined ? {} : { project }),
  };
  const scoped = org !== undefined || project !== undefined;
  const notifications = useNotifications(filter, scope);
  const unreadCount = useUnreadCount();
  const scopes = useNotificationScopes();
  const railRows: ScopeRailRow[] = (scopes.data?.items ?? []).map((r) => {
    const level = levelOf(r.level);
    return {
      ...r,
      urgent: r.immediate,
      count: r.unread,
      // 기본(모두)이 아니면 이름 옆에 적는다 — 수가 적은 까닭이 수준 때문일 수 있다(REQ-WEB-259)
      ...(level === 'all' ? {} : { tag: t(`notif.level.${level}`) }),
    };
  });
  const scopeLabel = scopeName(railRows, scope);
  // 프로젝트 하나로 좁혔을 때 그 프로젝트의 줄 — 받는 수준을 여기서 고른다(REQ-WEB-259)
  const scopedRow =
    project === undefined
      ? undefined
      : scopes.data?.items.find(
          (r) => r.project_slug === project && (org === undefined || r.org_slug === org),
        );
  const navigate = useNavigate();
  const { pushToast } = useRealtime();
  const router = useRouter();
  const { orgSlug } = useScope();
  const queryClient = useQueryClient();

  // 받아 온 쪽들을 이어 붙인다 — 커서가 있으므로 목록은 50 에서 끝나지 않는다
  const items = (notifications.data?.pages ?? []).flatMap((page) => rows(page.items));
  // 목록은 새것부터다 — 맨 앞이 이 화면이 본 가장 새 알림이다([모두 읽음]의 기준 시각). 순서는
  // **마지막으로 더해진 시각**이라(2026-09-27 · REQ-API-224) 기준도 그 값이다
  const head = items[0];
  const newestSeen =
    typeof head?.['last_at'] === 'string'
      ? head['last_at']
      : typeof head?.['created_at'] === 'string'
        ? head['created_at']
        : null;

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myNotifications() }),
  });

  /**
   * 일괄 읽음(REQ-WEB-137). 한 건씩 지우는 것이 유일한 길이면 **지울 수 없는 배지**가
   * 되고, 지울 수 없는 배지는 곧 읽지 않는 배지가 된다 — 실측 2026-09-04: 695건.
   */
  /**
   * **보이는 범위만 읽음으로 바꾼다**(2026-09-27 · 사람 결정 N4 · REQ-WEB-254). 범위와 "중요" 거름을
   * 함께 보내고, 받아 온 가장 새 알림의 시각을 기준으로 둔다 — 누르는 사이에 온 알림은 본 적이
   * 없으므로 그대로 남는다. 모든 조직 · 전체에서 누르면 예전과 같다.
   */
  const markAllRead = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; marked: number }>('/me/notifications/read-all', {
        method: 'POST',
        body: {
          ...scope,
          ...(filter === 'important' ? { importance: 'immediate' } : {}),
          ...(newestSeen === null ? {} : { until: newestSeen }),
        },
      }),
    onSuccess: (result) => {
      // 배지 키가 알림 키의 하위라(`[...myNotifications(), 'unread']`) 상위 하나면 둘 다 간다
      void queryClient.invalidateQueries({ queryKey: queryKeys.myNotifications() });
      // **몇 건을 지웠는지 말한다**(HUB-09) — 서버는 처음부터 `marked` 를 줬고 매뉴얼도 그렇게
      // 약속했는데, 화면은 목록만 조용히 흐려졌다
      pushToast({
        tone: 'ok',
        message: t('notif.read_all_done', { count: Number(result.marked ?? 0) }),
      });
    },
  });

  /**
   * **잇달아 같은 알림은 한 줄로 접는다**(2026-09-24 · HUB-08 · REQ-WEB-210). 같은 문서의 재확인
   * 요청이나 코멘트가 연달아 오면 똑같은 줄이 여러 번 쌓였다 — "×N" 을 누르면 펼쳐진다.
   */
  // 서버가 묶은 줄(REQ-WEB-262)은 이웃과 접지 않는다 — 그 줄이 이미 묶음이고, 읽은 묶음과 새 묶음은
  // 따로 읽는 두 줄이다
  const groups = collapseRepeats(items, (n) =>
    typeof n['batch_key'] === 'string'
      ? `batch|${String(n['id'])}`
      : `${eventType(n)}|${String(n['subject_id'] ?? '')}`,
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (
    n: EventRow,
    members: EventRow[],
    expanded: boolean,
    nested = false,
  ): React.JSX.Element => {
    const type = eventType(n);
    const subject = eventSubject(n);
    const unreadIds = members.filter((m) => m['state'] === 'unread').map((m) => String(m['id']));
    // 서버가 묶은 줄은 그 수를, 화면이 접은 무리는 무리의 줄 수를 보인다
    const batched = typeof n['batch_key'] === 'string';
    const repeat = batched ? batchSize(n) : members.length;
    const repeatLabel = batched
      ? t('notif.batch.label', { count: repeat })
      : t('feed.repeat_label', { count: repeat });
    const state = unreadIds.length > 0 ? 'unread' : 'read';
    const target = deepLinkFor(n);
    const href = hrefOf(target);
    const routed = inOrgHref(n['org_slug'], href, orgSlug);
    const open = (): void => {
      for (const id of unreadIds) markRead.mutate(id);
      // 다른 조직의 알림이면 조직을 바꾸고 그 자리로 간다(REQ-WEB-199)
      if (routed !== href) router.history.push(routed);
      else void navigate(target);
    };
    return (
      <li
        key={String(n['id'])}
        data-state={state}
        data-testid="notification-row"
        // 행 전체가 클릭 대상이다 — 읽음 처리와 이동이 한 동작이어야 한다(REQ-WEB-034).
        // 따로 두면 사람은 링크만 누르고 배지는 영원히 줄지 않는다.
        onClick={open}
        className={cn(
          'group flex cursor-pointer items-center gap-3 border-b border-border px-2 py-2.5 text-sm last:border-0 hover:bg-bg-hover data-[state=read]:text-text-mute',
          nested && 'pl-7',
        )}
      >
        {/* 읽지 않음은 점 하나로 — 행 전체를 굵게 하면 목록이 소란스러워진다.
            점만으로 구분하지 않도록 aria-label 을 붙인다(REQ-WEB-033) */}
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            state === 'unread' ? 'bg-status-action' : 'bg-transparent',
          )}
        />
        {/* **키보드로도 연다**(2026-09-25 — UI/UX 검토 HUB-X1 · REQ-WEB-224). 행이 `<li onClick>` 뿐이라 Tab 으로
            닿지 않았고 Enter 로 열 수 없었다 — 본문이 링크다(주소도 싣는다). 누르면 행과 같은 일을 한다 */}
        <a
          href={routed}
          data-testid="notification-link"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            open();
          }}
          className="min-w-0 flex-1 truncate"
        >
          {/* role 없는 점의 aria-label 은 읽히지 않는다 — 안 읽음은 글자로 말한다 */}
          {state === 'unread' && <span className="sr-only">{t('notif.unread')}: </span>}
          <span className="font-medium text-text">{t(eventLabelKey(type))}</span>
          {/* **무엇에 대한 알림인가**(REQ-WEB-210 · REQ-API-181) — 키와 버전, 그리고 제목. 결재·질문
              알림은 키도 제목도 없이 "승인 요청" 만 반복했다 */}
          {subject.key !== null && (
            <Mono className="ml-2">
              {subject.key}
              {subject.version !== null && ` v${String(subject.version)}`}
            </Mono>
          )}
          {subject.title !== null && (
            <span data-testid="notification-title" className="ml-2 text-text-mute">
              {subject.title}
            </span>
          )}
          {/* **처리된 요청은 그렇다고 말한다**(REQ-WEB-204 · REQ-API-176). 누가 먼저 처리해도
              행은 여전히 "승인 요청" 이라, 누르면 이미 없는 카드를 찾아갔다 */}
          {/* **무엇 때문에**(2026-09-27 · REQ-WEB-262) — 묶음에 든 원인(바뀐 문서 · 준비된 작업 · 남긴 사람) */}
          {causeLine(t, n) !== null && (
            <span data-testid="notification-causes" className="ml-2 text-xs text-text-faint">
              {causeLine(t, n)}
            </span>
          )}
          {typeof n['resolution'] === 'string' && (
            <span data-testid="notification-resolved" className="ml-2 text-xs text-text-faint">
              {t('notif.resolved', {
                what: resolutionLabel(t, n['resolution']),
                who: String(n['resolved_by'] ?? '—'),
              })}
            </span>
          )}
        </a>
        {repeat > 1 && (
          // 흐린 "×3" 은 개수 표시로 읽혔다 — 펼치기 한 벌(REQ-WEB-276)
          <Disclosure
            expanded={expanded}
            label={repeatLabel}
            testId="notification-repeat"
            className="shrink-0 tabular-nums"
            onToggle={(e) => {
              e.stopPropagation(); // 펼치기는 이동이 아니다
              toggle(String(n['id']));
            }}
          >
            {t('feed.repeat', { count: repeat })}
          </Disclosure>
        )}
        {/* 좁은 화면에서도 남긴다 — 어느 프로젝트의 알림인지는 줄의 절반이다(REQ-WEB-192).
            프로젝트 하나로 좁혔으면 모든 줄이 같으므로 빼고, 그 이름은 머리가 한 번 말한다(REQ-WEB-253) */}
        {project === undefined && (
          <ScopeBadge
            className="max-w-[40%] shrink-0"
            orgSlug={n['org_slug']}
            orgName={n['org_name']}
            projectSlug={n['project_slug']}
            projectName={n['project_name']}
          />
        )}
        {/* 행위자 표기 한 벌 — 사람은 머리글자 원, 에이전트는 AI 칸(REQ-WEB-277) */}
        <span className="hidden w-28 shrink-0 items-center justify-end gap-1 text-xs text-text-faint md:flex">
          <ActorMark
            size="sm"
            name={typeof n['actor_name'] === 'string' ? n['actor_name'] : null}
            agent={n['is_agent'] === true}
          />
          <span className="truncate">{String(n['actor_name'] ?? '')}</span>
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-text-faint">
          {relativeTime(t, typeof n['occurred_at'] === 'string' ? n['occurred_at'] : null)}
        </span>
        {/* **동작 칸은 모든 행에 있다**(2026-09-04 · 사람 보고). 예전에는 안 읽은
            행에만 단추를 그렸는데, `opacity-0` 이어도 **자리는 차지한다** — 그래서
            읽은 행과 안 읽은 행의 열이 어긋나 목록이 두 벌처럼 보였다. 보이지
            않는 것과 자리를 차지하지 않는 것은 다르다. */}
        <span className="flex w-14 shrink-0 justify-end">
          {state === 'unread' && (
            <Button
              size="xs"
              variant="subtle"
              // 키보드 포커스·터치에서도 보인다 — 투명한 채 포커스를 받으면 고리까지 함께 사라졌다.
              // 드러날 때는 단추로 보인다 — 옆의 시각과 같은 회색 글자였다(REQ-WEB-271)
              className={REVEAL_ON_HOVER}
              onClick={(e) => {
                e.stopPropagation(); // 이동 없이 읽음만 처리하는 경로도 남긴다
                for (const id of unreadIds) markRead.mutate(id);
              }}
            >
              {t('notif.read')}
            </Button>
          )}
        </span>
      </li>
    );
  };
  // **배지는 받아 온 것이 아니라 진짜 수를 센다**(2026-09-03). 예전에는 로드된 50건 안에서
  // 세어 "읽지 않음 50" 을 보이면서 헤더는 479 를 보였다 — 같은 화면이 두 수를 말했다.
  const global = {
    count: unreadCount.data?.count ?? 0,
    immediate: unreadCount.data?.immediate ?? 0,
  };
  // 범위 안의 수 — 모든 조직이면 배지와 같은 수, 좁혔으면 칸의 줄을 더한 수다(둘 다 서버가 센다)
  const inside = scoped ? scopeTotals(railRows, scope) : null;
  const unread = inside === null ? global.count : inside.count;
  const immediate = inside === null ? global.immediate : inside.urgent;
  // 좁혀 보는 동안 다른 범위의 중요 알림을 놓치지 않게 한 줄로 알린다(REQ-WEB-255)
  const elsewhere = inside === null ? 0 : Math.max(0, global.immediate - inside.urgent);
  // 버튼이 바꿀 수 — 보이는 것과 같아야 한다(N4)
  const clearable = filter === 'important' ? immediate : unread;
  const readAllLabel =
    scopeLabel === null
      ? filter === 'important'
        ? t('notif.read_all_important', { count: clearable })
        : t('notif.read_all')
      : filter === 'important'
        ? t('notif.read_all_scoped_important', { scope: scopeLabel, count: clearable })
        : t('notif.read_all_scoped', { scope: scopeLabel, count: clearable });

  return (
    <PageBody>
      <PageHeader
        title={t('notif.title')}
        description={
          scopeLabel === null ? t('notif.scope_all') : t('notif.scope_one', { scope: scopeLabel })
        }
        actions={
          <Segmented
            label={t('notif.filter.label')}
            value={filter ?? 'all'}
            options={[
              { value: 'all', label: t('notif.filter.all') },
              { value: 'important', label: t('notif.filter.immediate') },
              { value: 'unread', label: t('notif.filter.unread') },
            ]}
            onChange={(value) =>
              void navigate({
                to: '/notifications',
                // 범위는 그대로 둔다 — 거름과 범위는 따로 고르는 두 칸이다
                search: searchOf(scope, value === 'all' ? undefined : value),
                replace: true,
              })
            }
            testIdPrefix="notif-filter"
          />
        }
        meta={
          clearable > 0 || unread > 0 ? (
            <span className="flex items-center gap-2">
              <StatusBadge token="waiting" label={t('notif.unread_badge', { count: unread })} />
              {/* **중요**한 수는 따로 센다 — 그것이 헤더 배지가 세는 값이다(REQ-WEB-149). 이름은
                  '결정 대기' 였는데, 그 등급에는 스펙 승인됨·세션 무응답처럼 결정이 아닌 것이 대부분이라
                  바로 아래의 한 줄("결정은 받은 요청에")과 부딪쳤다(2026-09-24 사람 결정 D3) */}
              {immediate > 0 && (
                <StatusBadge
                  token="danger"
                  label={t('notif.immediate_badge', { count: immediate })}
                />
              )}
              {/* 수 바로 옆이다 — 그 수를 보고 누르는 단추라 목록 밖에 두면 찾지 못한다 */}
              {clearable > 0 && (
                <Button
                  size="sm"
                  variant="subtle"
                  data-testid="mark-all-read"
                  disabled={markAllRead.isPending}
                  onClick={() => markAllRead.mutate()}
                >
                  {readAllLabel}
                </Button>
              )}
            </span>
          ) : undefined
        }
      />

      {/* 초대는 알림 테이블을 타지 않는다(초대받은 사람은 아직 아무 프로젝트의 멤버가
          아니다) — 그래도 **알림이라 불리는 화면**에는 보여야 한다 */}
      <div className="mb-4">
        <InvitationCards heading={false} />
      </div>
      {/* **범위 칸 | 목록**(2026-09-27 · 사람 결정 N1 · REQ-WEB-253). 좁은 폭에서는 칸이 목록 위의
          칩 줄이 된다. 내가 속한 프로젝트가 하나도 없으면(초대만 받은 사람) 칸을 그리지 않는다 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {railRows.length > 0 && (
          <ScopeRail
            rows={railRows}
            selected={scope}
            heading={t('notif.scope.heading')}
            allLabel={t('notif.scope.all')}
            urgentTitle={(count) => t('notif.immediate_badge', { count })}
            countTitle={(count) => t('notif.unread_badge', { count })}
            hrefFor={(next) => hrefOfSearch(searchOf(next, filter))}
            onSelect={(next) =>
              void navigate({ to: '/notifications', search: searchOf(next, filter) })
            }
          />
        )}
        <div className="min-w-0 flex-1">
          {/* **이 프로젝트의 알림을 얼마나 받을지**(2026-09-27 · 사람 결정 N3 · REQ-WEB-259). 좁혀 본 그
              자리에서 고른다 — 설정 화면까지 가지 않아도 된다. 받은 요청에는 닿지 않는다 */}
          {scopedRow !== undefined && scopeLabel !== null && (
            <div
              data-testid="notif-level"
              className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            >
              <span className="text-text-mute">{t('notif.level.label')}</span>
              <NotificationLevelControl
                org={scopedRow.org_slug}
                project={scopedRow.project_slug}
                scope={scopeLabel}
                level={levelOf(scopedRow.level)}
                testIdPrefix="notif-level"
              />
              <span className="text-2xs text-text-faint">{t('notif.level.hint')}</span>
            </div>
          )}
          {/* 이 한 줄이 알림과 받은 요청의 경계다 — 목록 옆에 두어야 목록을 보며 읽는다 */}
          <p className="mb-1.5 text-2xs text-text-faint">{t('notif.lead')}</p>
          {elsewhere > 0 && (
            <p className="mb-1.5 text-xs">
              <Link
                to="/notifications"
                search={searchOf({}, 'important')}
                data-testid="notif-elsewhere"
                className="text-link hover:underline"
              >
                {t('notif.elsewhere_important', { count: elsewhere })} ▸
              </Link>
            </p>
          )}
          {notifications.isLoading && <Skeleton rows={5} />}
          {failedWithoutData(notifications) && (
            <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
          )}
          {notifications.data !== undefined && items.length === 0 && (
            <EmptyState
              icon="○"
              title={t(
                filter === 'important'
                  ? 'notif.empty_important'
                  : filter === 'unread'
                    ? 'notif.empty_unread'
                    : 'notif.empty',
              )}
              hint={t('notif.empty_hint')}
              action={
                <Link to="/inbox" className="text-sm text-link hover:underline">
                  {t('notif.empty_action')} ▸
                </Link>
              }
            />
          )}
          <ul className="flex flex-col">
            {groups.map((group) => {
              const headId = String(group.head['id']);
              const expanded = open.has(headId);
              // 머리 줄은 **무리 전체**를 대표한다 — 읽음도 이동도 묶음 단위다(HUB-08).
              // 펼친 뒤의 나머지 줄은 저마다 한 건이다
              // 서버가 묶은 줄은 펼치면 **원인**을 보인다(최근 10건) — 줄은 하나이고 읽음도 하나다
              if (typeof group.head['batch_key'] === 'string') {
                const causes = batchCauses(group.head);
                const older = batchSize(group.head) - causes.length;
                return [
                  renderRow(group.head, group.rows, expanded),
                  ...(expanded
                    ? [
                        ...causes.map((c) => (
                          <li
                            key={`${headId}:${c.event_id}`}
                            data-testid="notification-cause"
                            className="flex items-center gap-3 border-b border-border py-1.5 pr-2 pl-7 text-xs text-text-mute"
                          >
                            <span className="min-w-0 flex-1 truncate">{causeName(c)}</span>
                            <span className="w-16 shrink-0 text-right text-text-faint">
                              {relativeTime(t, c.occurred_at)}
                            </span>
                          </li>
                        )),
                        ...(older > 0
                          ? [
                              <li
                                key={`${headId}:older`}
                                data-testid="notification-cause-older"
                                className="border-b border-border py-1.5 pr-2 pl-7 text-xs text-text-faint"
                              >
                                {t('notif.batch.older', { count: older })}
                              </li>,
                            ]
                          : []),
                      ]
                    : []),
                ];
              }
              return [
                renderRow(group.head, group.rows, expanded),
                ...(expanded ? group.rows.slice(1).map((n) => renderRow(n, [n], false, true)) : []),
              ];
            })}
          </ul>
          {notifications.hasNextPage === true && (
            <LoadMore
              className="mt-3"
              testId="notif-more"
              pending={notifications.isFetchingNextPage}
              onClick={() => void notifications.fetchNextPage()}
              label={t('tasks.more')}
              pendingLabel={t('common.loading')}
            />
          )}
        </div>
      </div>
    </PageBody>
  );
}
