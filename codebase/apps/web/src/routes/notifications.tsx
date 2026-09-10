// /notifications — 알림 센터 (screens.md §2.9)
//
// 알림은 event 참조다 — 문구를 행에 굳혀 저장하지 않고 조회 시점에 만든다(D-10).
// 여기서는 "무엇이 · 어디서 · 언제"만 보이면 되고, 자세한 것은 딥링크가 데려간다.

import { eventLabelKey, NERV_EVENT } from '@nerv/schema';
import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { queryKeys } from '../lib/query-keys.js';
import { rows, useNotifications, useUnreadCount } from '../lib/queries.js';
import { cn } from '../lib/utils.js';
import { StatusBadge } from '../components/status-badge.js';
import { InvitationCards } from '../components/invitation-cards.js';
import {
  Button,
  EmptyState,
  Mono,
  PageBody,
  PageHeader,
  Skeleton,
} from '../components/ui/primitives.js';

export const Route = createFileRoute('/notifications')({ component: NotificationScreen });

/** 알림이 데려갈 곳 — 경로와 **뷰 상태**(ui-wireframes §1.4: "승인 요청 알림에 그대로 붙는다") */
export interface NotificationTarget {
  to: string;
  search?: Record<string, string>;
}

/**
 * 알림 → 대상. 알림은 event 참조라 **여기서 링크를 만든다**(행에 굳혀 저장하지 않는다).
 * 대상이 사라졌거나 모르는 종류면 프로젝트 개요로 보낸다 — 막다른 길을 만들지 않는다(§1.5).
 *
 * **뷰 상태까지 싣는다**(REQ-WEB-163). ui-wireframes §4.5 는 "무슨 일이 있었다" 만 알리고
 * 끝나는 알림은 만들지 않는다고 적는데, 스펙 알림이 정확히 그랬다 — "v4 가 승인됐다" 를
 * 전하고 1,000줄짜리 본문을 열어, 바뀐 자리는 사람이 눈으로 찾아야 했다. 바뀐 자리를
 * 아는 화면(EP-SPEC-06 · `?diff=`)은 처음부터 있었고 알림만 그 길을 몰랐다.
 */
export function deepLinkFor(n: Record<string, unknown>): NotificationTarget {
  const project = String(n['project_slug'] ?? '');
  if (project === '') return { to: '/' };
  const type = String(n['event_type'] ?? '');
  if (typeof n['spec_key'] === 'string' && n['spec_key'] !== '') {
    return { to: `/p/${project}/specs/${n['spec_key']}`, ...specView(n, type) };
  }
  if (typeof n['task_key'] === 'string' && n['task_key'] !== '') {
    return { to: `/p/${project}/tasks/${n['task_key']}` };
  }
  if (type.startsWith('approval.') || type.startsWith('question.')) return { to: '/inbox' };
  if (type.startsWith('session.') || type.startsWith('claim.')) {
    return { to: `/p/${project}/sessions` };
  }
  return { to: `/p/${project}` };
}

/**
 * 스펙 알림이 열어야 하는 **자리**.
 *
 * `spec.comment_added` 는 **두 곳에서 난다**. 갈라 주는 것은 `subject_type` 이다:
 *   - `spec`         — 본문에 달린 코멘트(`spec_comment` 행이 있다) → 코멘트 레일
 *   - `spec_version` — 리뷰 결정 "코멘트"(문서를 draft 로 되돌린다). **행이 없다** —
 *                      코멘트는 이벤트 payload 에만 있으므로 레일을 열면 **빈 목록**이다.
 *                      그 알림이 데려가야 하는 곳은 되돌아온 문서 자신이다.
 *
 * 그 밖의 스펙 버전 알림(승인·반려)은 직전 버전과의 diff 로 간다. v1 은 이전이 없으니
 * 본문이 곧 그 버전이라 아무것도 붙이지 않는다 — 뜻 없는 인자를 주소에 남기지 않는다.
 * 버전이 없는 알림(재검토 요청은 subject 가 `spec` 이다)도 본문이다.
 */
function specView(n: Record<string, unknown>, type: string): { search?: Record<string, string> } {
  if (type === NERV_EVENT.SPEC_COMMENT_ADDED) {
    return n['subject_type'] === 'spec' ? { search: { rail: 'comments' } } : {};
  }
  const version = Number(n['version_no']);
  if (!Number.isInteger(version) || version < 2) return {};
  return { search: { diff: `v${String(version - 1)}..v${String(version)}` } };
}

function NotificationScreen(): React.JSX.Element {
  const t = useT();
  /**
   * **등급으로 나눠 본다**(2026-09-07 · REQ-WEB-149 · FR-12). 실측 unread 767건 중 결정이
   * 필요한 것은 99건이다 — 한 줄에 섞으면 그 99건은 배경 활동에 묻힌다.
   */
  const [onlyImmediate, setOnlyImmediate] = useState(false);
  const notifications = useNotifications(onlyImmediate ? 'immediate' : undefined);
  const unreadCount = useUnreadCount();
  const navigate = useNavigate();
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
    mutationFn: () => apiFetch('/me/notifications/read-all', { method: 'POST' }),
    // 배지 키가 알림 키의 하위라(`[...myNotifications(), 'unread']`) 상위 하나면 둘 다 간다
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myNotifications() }),
  });

  // 받아 온 쪽들을 이어 붙인다 — 커서가 있으므로 목록은 50 에서 끝나지 않는다
  const items = (notifications.data?.pages ?? []).flatMap((page) => rows(page.items));
  // **배지는 받아 온 것이 아니라 진짜 수를 센다**(2026-09-03). 예전에는 로드된 50건 안에서
  // 세어 "읽지 않음 50" 을 보이면서 헤더는 479 를 보였다 — 같은 화면이 두 수를 말했다.
  const unread = unreadCount.data?.count ?? 0;
  const immediate = unreadCount.data?.immediate ?? 0;

  return (
    <PageBody>
      <PageHeader
        title={t('notif.title')}
        meta={
          unread > 0 ? (
            <span className="flex items-center gap-2">
              <StatusBadge token="waiting" label={t('notif.unread_badge', { count: unread })} />
              {/* 결정이 필요한 수는 따로 센다 — 그것이 배지가 세는 값이다 */}
              {immediate > 0 && (
                <StatusBadge
                  token="danger"
                  label={t('notif.immediate_badge', { count: immediate })}
                />
              )}
              <Button
                size="sm"
                variant={onlyImmediate ? 'primary' : 'ghost'}
                data-testid="filter-immediate"
                onClick={() => setOnlyImmediate((v) => !v)}
              >
                {onlyImmediate ? t('notif.filter.all') : t('notif.filter.immediate')}
              </Button>
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
      {!notifications.isLoading && items.length === 0 && (
        <EmptyState icon="○" title={t('notif.empty')} hint={t('notif.empty_hint')} />
      )}
      <ul className="flex flex-col">
        {items.map((n) => {
          const type = String(n['event_type'] ?? '');
          const key = String(n['spec_key'] ?? n['task_key'] ?? '');
          return (
            <li
              key={String(n['id'])}
              data-state={String(n['state'])}
              data-testid="notification-row"
              // 행 전체가 클릭 대상이다 — 읽음 처리와 이동이 한 동작이어야 한다(REQ-WEB-034).
              // 따로 두면 사람은 링크만 누르고 배지는 영원히 줄지 않는다.
              onClick={() => {
                if (n['state'] === 'unread') markRead.mutate(String(n['id']));
                void navigate(deepLinkFor(n));
              }}
              className="group flex cursor-pointer items-center gap-3 border-b border-border px-2 py-2.5 text-sm last:border-0 hover:bg-bg-hover data-[state=read]:text-text-mute"
            >
              {/* 읽지 않음은 점 하나로 — 행 전체를 굵게 하면 목록이 소란스러워진다.
                  점만으로 구분하지 않도록 aria-label 을 붙인다(REQ-WEB-033) */}
              <span
                aria-label={n['state'] === 'unread' ? t('notif.unread') : t('notif.read')}
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  n['state'] === 'unread' ? 'bg-status-action' : 'bg-transparent',
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-text">{t(eventLabelKey(type))}</span>
                {key !== '' && <Mono className="ml-2">{key}</Mono>}
              </span>
              <span className="hidden shrink-0 text-xs text-text-mute sm:inline">
                {String(n['project_slug'] ?? '')}
              </span>
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
                {n['state'] === 'unread' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation(); // 이동 없이 읽음만 처리하는 경로도 남긴다
                      markRead.mutate(String(n['id']));
                    }}
                  >
                    {t('notif.read')}
                  </Button>
                )}
              </span>
            </li>
          );
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
