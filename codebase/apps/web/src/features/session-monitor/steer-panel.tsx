// steer / stop — 사람이 달리는 세션에 개입하는 유일한 경로 (FR-08 · EP-SES-04)
//
// 두 버튼의 의미가 다르다는 것을 화면이 말해야 한다:
//   steer — 다음 하트비트에 실려 전달된다(즉시가 아니다. 에이전트는 도구 호출 사이에서만 듣는다)
//   stop  — 전달과 **무관하게** 서버가 즉시 클레임을 회수한다. 그래서 죽은 세션에도 듣는다
// 이 구분을 숨기면 사람은 steer 를 누르고 즉시 멈추길 기대하다 다시 누르게 된다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button, Input } from '../../components/ui/primitives.js';
import type { ProjectId } from '../../lib/query-keys.js';

export interface SteerPanelProps {
  projectSlug: string;
  /**
   * 프로젝트 축(`lib/queries.ts` 의 "프로젝트 축" 규약 · 4.5 §1.4). 세션 목록 캐시가
   * 이 축으로 잡히므로, slug 로 무효화하면 **아무 캐시도 맞지 않는다** — steer·stop 뒤에
   * 보드가 그대로 남는다. 실시간이 붙어 있으면 이벤트가 가려 주지만, 끊긴 동안(D-14)에는
   * 사람이 방금 누른 것의 결과를 보지 못한다.
   */
  projectId: ProjectId | undefined;
  sessionId: string;
  state: string;
  /**
   * 세션 소유자이거나 admin 인가 — **서버가 그 둘에게만 이 문을 연다**(EP-SES-04).
   *
   * 화면은 서버가 허용할 것을 미리 말한다(§1.8 · REQ-WEB-003). 이 축이 없던 동안 패널은
   * 누구에게나 활성이었고, 남의 세션에 **중단 사유까지 적은 뒤** 403 을 받았다 —
   * 되돌릴 수 없는 버튼일수록 누르기 전에 말해야 한다.
   */
  canIntervene: boolean;
}

export function SteerPanel({
  projectSlug,
  projectId,
  sessionId,
  state,
  canIntervene,
}: SteerPanelProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const [message, setMessage] = useState('');
  // stop 은 남의 작업을 끊는 행위다 — 확인 단계와 사유를 함께 요구한다(REQ-WEB-021).
  // 사유가 없으면 상대 세션의 사람은 "왜 끊겼는지" 모른 채 다시 시작하게 된다.
  const [confirming, setConfirming] = useState(false);
  const finished = ['complete', 'error'].includes(state);
  // 끝난 세션과 남의 세션은 **막는 이유가 다르다** — 같은 disabled 로 뭉치면 사람은
  // "기다리면 되나" 와 "나는 못 하나" 를 구별할 수 없다. 문구가 그것을 가른다.
  const blocked = finished || !canIntervene;

  const send = useMutation({
    mutationFn: (kind: 'steer' | 'stop') =>
      apiFetch<{ reclaimed: number }>(`/projects/${projectSlug}/sessions/${sessionId}/steer`, {
        method: 'POST',
        body: { kind, message },
        idempotencyKey: `steer-${sessionId}-${kind}-${message.slice(0, 16)}`,
      }),
    onSuccess: (result, kind) => {
      setMessage('');
      setConfirming(false);
      // 축이 없으면 무효화하지 않는다 — 빈 축으로 부르면 아무 캐시에도 닿지 않고,
      // 그 침묵이 정확히 이 표시가 없애려는 결함이다(query-keys.ts `ProjectId`).
      if (projectId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectSessions(projectId) });
      }
      pushToast({
        tone: 'ok',
        message:
          kind === 'stop' ? t('steer.stopped', { count: result.reclaimed }) : t('steer.sent'),
      });
    },
    onError: onApiError,
  });

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('steer.placeholder')}
        disabled={blocked}
        aria-label={t('steer.label')}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={blocked || send.isPending || message.trim() === ''}
          onClick={() => send.mutate('steer')}
          title={t('steer.send_title')}
        >
          {t('steer.send')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid="stop-button"
          disabled={blocked || send.isPending}
          onClick={() => setConfirming(true)}
          title={t('steer.stop_title')}
        >
          {t('steer.stop')}
        </Button>
        {finished && <span className="text-xs text-text-faint">{t('steer.finished')}</span>}
        {!finished && !canIntervene && (
          <span data-testid="steer-forbidden" className="text-xs text-text-faint">
            {t('steer.not_owner')}
          </span>
        )}
      </div>

      {confirming && (
        <div
          role="dialog"
          aria-label={t('steer.confirm_dialog')}
          data-testid="stop-confirm"
          className="rounded-nerv border border-status-danger bg-status-danger-soft p-3 text-sm"
        >
          <p className="font-medium text-status-danger">{t('steer.confirm_title')}</p>
          <p className="mt-1 text-xs text-text-mute">{t('steer.confirm_body')}</p>
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('steer.reason')}
            data-testid="stop-reason"
            aria-label={t('steer.reason_label')}
            className="mt-2"
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              data-testid="stop-confirm-button"
              disabled={message.trim() === '' || send.isPending}
              onClick={() => send.mutate('stop')}
              className="border-transparent bg-status-danger text-white hover:opacity-90"
            >
              {t('steer.confirm_stop')}
            </Button>
            <Button size="sm" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
