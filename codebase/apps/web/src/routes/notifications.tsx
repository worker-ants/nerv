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
import { rows, useNotifications, useUnreadCount } from '../lib/queries.js';
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
  EmptyState,
  Mono,
  PageBody,
  PageHeader,
  Segmented,
  Skeleton,
} from '../components/ui/primitives.js';
import { ScopeBadge } from '../components/scope-badge.js';
import { ErrorState, failedWithoutData } from '../components/query-state.js';

/** 알림 센터의 주소 — 거르는 칸이 여기 산다(REQ-WEB-218) */
export interface NotificationSearch {
  filter?: 'important' | 'unread';
}

export const Route = createFileRoute('/notifications')({
  validateSearch: (search: Record<string, unknown>): NotificationSearch =>
    search['filter'] === 'important' || search['filter'] === 'unread'
      ? { filter: search['filter'] }
      : {},
  component: NotificationScreen,
});

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
  const { filter } = Route.useSearch();
  const notifications = useNotifications(filter);
  const unreadCount = useUnreadCount();
  const navigate = useNavigate();
  const { pushToast } = useRealtime();
  const router = useRouter();
  const { orgSlug } = useScope();
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myNotifications() }),
  });

  /**
   * 일괄 읽음(REQ-WEB-137). 한 건씩 지우는 것이 유일한 길이면 **지울 수 없는 배지**가
   * 되고, 지울 수 없는 배지는 곧 읽지 않는 배지가 된다 — 실측 2026-09-04: 695건.
   */
  const markAllRead = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; marked: number }>('/me/notifications/read-all', { method: 'POST' }),
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

  // 받아 온 쪽들을 이어 붙인다 — 커서가 있으므로 목록은 50 에서 끝나지 않는다
  const items = (notifications.data?.pages ?? []).flatMap((page) => rows(page.items));
  /**
   * **잇달아 같은 알림은 한 줄로 접는다**(2026-09-24 · HUB-08 · REQ-WEB-210). 같은 문서의 재확인
   * 요청이나 코멘트가 연달아 오면 똑같은 줄이 여러 번 쌓였다 — "×N" 을 누르면 펼쳐진다.
   */
  const groups = collapseRepeats(items, (n) => `${eventType(n)}|${String(n['subject_id'] ?? '')}`);
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
    const state = unreadIds.length > 0 ? 'unread' : 'read';
    return (
      <li
        key={String(n['id'])}
        data-state={state}
        data-testid="notification-row"
        // 행 전체가 클릭 대상이다 — 읽음 처리와 이동이 한 동작이어야 한다(REQ-WEB-034).
        // 따로 두면 사람은 링크만 누르고 배지는 영원히 줄지 않는다.
        onClick={() => {
          for (const id of unreadIds) markRead.mutate(id);
          const target = deepLinkFor(n);
          const href = hrefOf(target);
          const routed = inOrgHref(n['org_slug'], href, orgSlug);
          // 다른 조직의 알림이면 조직을 바꾸고 그 자리로 간다(REQ-WEB-199)
          if (routed !== href) router.history.push(routed);
          else void navigate(target);
        }}
        className={cn(
          'group flex cursor-pointer items-center gap-3 border-b border-border px-2 py-2.5 text-sm last:border-0 hover:bg-bg-hover data-[state=read]:text-text-mute',
          nested && 'pl-7',
        )}
      >
        {/* 읽지 않음은 점 하나로 — 행 전체를 굵게 하면 목록이 소란스러워진다.
            점만으로 구분하지 않도록 aria-label 을 붙인다(REQ-WEB-033) */}
        <span
          aria-label={state === 'unread' ? t('notif.unread') : t('notif.read')}
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            state === 'unread' ? 'bg-status-action' : 'bg-transparent',
          )}
        />
        <span className="min-w-0 flex-1 truncate">
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
          {typeof n['resolution'] === 'string' && (
            <span data-testid="notification-resolved" className="ml-2 text-xs text-text-faint">
              {t('notif.resolved', {
                what: resolutionLabel(t, n['resolution']),
                who: String(n['resolved_by'] ?? '—'),
              })}
            </span>
          )}
        </span>
        {members.length > 1 && (
          <button
            type="button"
            data-testid="notification-repeat"
            aria-expanded={expanded}
            aria-label={t('feed.repeat_label', { count: members.length })}
            title={t('feed.repeat_label', { count: members.length })}
            onClick={(e) => {
              e.stopPropagation(); // 펼치기는 이동이 아니다
              toggle(String(n['id']));
            }}
            className="shrink-0 rounded-nerv-sm px-1 text-xs text-text-faint tabular-nums hover:bg-bg-active hover:text-text"
          >
            {t('feed.repeat', { count: members.length })}
          </button>
        )}
        {/* 좁은 화면에서도 남긴다 — 어느 프로젝트의 알림인지는 줄의 절반이다(REQ-WEB-192) */}
        <ScopeBadge
          className="max-w-[40%] shrink-0"
          orgSlug={n['org_slug']}
          orgName={n['org_name']}
          projectSlug={n['project_slug']}
          projectName={n['project_name']}
        />
        <span className="hidden w-28 shrink-0 truncate text-right text-xs text-text-faint md:inline">
          {String(n['actor_name'] ?? '')}
          {n['is_agent'] === true ? ' 🤖' : ''}
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
              size="sm"
              variant="ghost"
              className="opacity-0 group-hover:opacity-100"
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
  const unread = unreadCount.data?.count ?? 0;
  const immediate = unreadCount.data?.immediate ?? 0;

  return (
    <PageBody>
      <PageHeader
        title={t('notif.title')}
        description={t('notif.scope_all')}
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
                search: value === 'all' ? {} : { filter: value },
                replace: true,
              })
            }
            testIdPrefix="notif-filter"
          />
        }
        meta={
          unread > 0 ? (
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
              <Button
                size="sm"
                variant="ghost"
                data-testid="mark-all-read"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
              >
                {t('notif.read_all')}
              </Button>
            </span>
          ) : undefined
        }
      />

      {/* 초대는 알림 테이블을 타지 않는다(초대받은 사람은 아직 아무 프로젝트의 멤버가
          아니다) — 그래도 **알림이라 불리는 화면**에는 보여야 한다 */}
      <div className="mb-4">
        <InvitationCards heading={false} />
      </div>
      {/* 이 한 줄이 알림과 받은 요청의 경계다 — 목록 옆에 두어야 목록을 보며 읽는다 */}
      <p className="mb-1.5 text-2xs text-text-faint">{t('notif.lead')}</p>
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
          return [
            renderRow(group.head, group.rows, expanded),
            ...(expanded ? group.rows.slice(1).map((n) => renderRow(n, [n], false, true)) : []),
          ];
        })}
      </ul>
      {notifications.hasNextPage === true && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            data-testid="notif-more"
            disabled={notifications.isFetchingNextPage}
            onClick={() => void notifications.fetchNextPage()}
          >
            {t('tasks.more')}
          </Button>
        </div>
      )}
    </PageBody>
  );
}
