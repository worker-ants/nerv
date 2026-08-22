// /notifications — 알림 센터 (screens.md §2.9)
//
// 알림은 event 참조다 — 문구를 행에 굳혀 저장하지 않고 조회 시점에 만든다(D-10).
// 여기서는 "무엇이 · 어디서 · 언제"만 보이면 되고, 자세한 것은 딥링크가 데려간다.

import { createFileRoute } from '@tanstack/react-router';
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

function NotificationScreen(): React.JSX.Element {
  const notifications = useNotifications();
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
              className="flex items-center gap-2 rounded border border-border bg-bg-elev px-3 py-2 text-sm data-[state=read]:opacity-60"
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
                  onClick={() => markRead.mutate(String(n['id']))}
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
