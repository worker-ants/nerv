// /notifications — 알림 센터 (screens.md §2.9)
//
// 알림은 event 참조다 — 문구를 행에 굳혀 저장하지 않고 조회 시점에 만든다(D-10).
// 여기서는 "무엇이 · 어디서 · 언제"만 보이면 되고, 자세한 것은 딥링크가 데려간다.

import { eventLabelKey } from '@nerv/schema';
import { useT } from '../lib/i18n.js';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { queryKeys } from '../lib/query-keys.js';
import { rows, useNotifications } from '../lib/queries.js';
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

/**
 * 알림 → 대상 경로. 알림은 event 참조라 **여기서 링크를 만든다**(행에 굳혀 저장하지 않는다).
 * 대상이 사라졌거나 모르는 종류면 프로젝트 개요로 보낸다 — 막다른 길을 만들지 않는다(§1.5).
 */
export function deepLinkFor(n: Record<string, unknown>): string {
  const project = String(n['project_slug'] ?? '');
  if (project === '') return '/';
  if (typeof n['spec_key'] === 'string' && n['spec_key'] !== '') {
    return `/p/${project}/specs/${n['spec_key']}`;
  }
  if (typeof n['task_key'] === 'string' && n['task_key'] !== '') {
    return `/p/${project}/tasks/${n['task_key']}`;
  }
  const type = String(n['event_type'] ?? '');
  if (type.startsWith('approval.') || type.startsWith('question.')) return '/inbox';
  if (type.startsWith('session.') || type.startsWith('claim.')) return `/p/${project}/sessions`;
  return `/p/${project}`;
}

function NotificationScreen(): React.JSX.Element {
  const t = useT();
  const notifications = useNotifications();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myNotifications() }),
  });

  const items = rows(notifications.data);
  const unread = items.filter((n) => n['state'] === 'unread').length;

  return (
    <PageBody>
      <PageHeader
        title={t('notif.title')}
        meta={
          unread > 0 ? (
            <StatusBadge token="waiting" label={t('notif.unread_badge', { count: unread })} />
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
                void navigate({ to: deepLinkFor(n) });
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
            </li>
          );
        })}
      </ul>
    </PageBody>
  );
}
