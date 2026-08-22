// /notifications — 알림 센터 (screens.md §2.9)
//
// 알림은 event 참조다 — 문구를 행에 굳혀 저장하지 않고 조회 시점에 만든다(D-10).
// 여기서는 "무엇이 · 어디서 · 언제"만 보이면 되고, 자세한 것은 딥링크가 데려간다.

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { NERV_EVENT } from '@nerv/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api.js';
import { queryKeys } from '../lib/query-keys.js';
import { rows, useNotifications } from '../lib/queries.js';

export const Route = createFileRoute('/notifications')({ component: NotificationScreen });

// 이벤트 이름은 하드코딩하지 않는다 — 카탈로그가 정본이고 이름이 바뀌면 여기가 먼저 깨진다(REQ-CB-006).
const EVENT_LABEL: Record<string, string> = {
  [NERV_EVENT.SPEC_SUBMITTED]: '스펙 검토 요청',
  [NERV_EVENT.SPEC_APPROVED]: '스펙 승인됨',
  [NERV_EVENT.SPEC_REJECTED]: '스펙 거절됨',
  [NERV_EVENT.SPEC_RECHECK_REQUESTED]: '참조 문서 재확인 요청',
  [NERV_EVENT.TASK_REBRIEF_REQUIRED]: '기준 버전이 바뀌어 재브리핑 필요',
  [NERV_EVENT.TASK_BLOCKED]: '작업이 막힘',
  [NERV_EVENT.TASK_DONE]: '작업 완료',
  [NERV_EVENT.APPROVAL_REQUESTED]: '승인 요청',
  [NERV_EVENT.QUESTION_CREATED]: '에이전트 질문',
  [NERV_EVENT.CLAIM_CONFLICT_WARN]: '범위 겹침 경고',
};

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
  const notifications = useNotifications();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.myNotifications() }),
  });

  const items = rows(notifications.data);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-3 text-lg font-semibold">알림</h1>
      {items.length === 0 && (
        <div className="rounded-md border border-border bg-bg-elev p-6 text-center text-sm text-text-mute">
          알림이 없습니다.
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((n) => {
          const type = String(n['event_type'] ?? '');
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
              className="flex cursor-pointer items-center gap-2 rounded border border-border bg-bg-elev px-3 py-2 text-sm hover:border-border-strong data-[state=read]:opacity-60"
            >
              <span className="font-medium">{EVENT_LABEL[type] ?? type}</span>
              <span className="font-mono text-xs text-text-faint">
                {String(n['spec_key'] ?? n['task_key'] ?? '')}
              </span>
              <span className="text-xs text-text-mute">{String(n['project_slug'] ?? '')}</span>
              <span className="ml-auto text-xs text-text-faint">
                {String(n['actor_name'] ?? '')}
                {n['is_agent'] === true ? ' 🤖' : ''}
              </span>
              {n['state'] === 'unread' && (
                <button
                  type="button"
                  className="text-xs text-link underline"
                  onClick={(e) => {
                    e.stopPropagation(); // 이동 없이 읽음만 처리하는 경로도 남긴다
                    markRead.mutate(String(n['id']));
                  }}
                >
                  읽음
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
