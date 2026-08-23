// steer / stop — 사람이 달리는 세션에 개입하는 유일한 경로 (FR-08 · EP-SES-04)
//
// 두 버튼의 의미가 다르다는 것을 화면이 말해야 한다:
//   steer — 다음 하트비트에 실려 전달된다(즉시가 아니다. 에이전트는 도구 호출 사이에서만 듣는다)
//   stop  — 전달과 **무관하게** 서버가 즉시 클레임을 회수한다. 그래서 죽은 세션에도 듣는다
// 이 구분을 숨기면 사람은 steer 를 누르고 즉시 멈추길 기대하다 다시 누르게 된다.

import { useT } from '../../lib/i18n.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button, Input } from '../../components/ui/primitives.js';

export interface SteerPanelProps {
  projectSlug: string;
  sessionId: string;
  state: string;
}

export function SteerPanel({ projectSlug, sessionId, state }: SteerPanelProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const [message, setMessage] = useState('');
  // stop 은 남의 작업을 끊는 행위다 — 확인 단계와 사유를 함께 요구한다(REQ-WEB-021).
  // 사유가 없으면 상대 세션의 사람은 "왜 끊겼는지" 모른 채 다시 시작하게 된다.
  const [confirming, setConfirming] = useState(false);
  const finished = ['complete', 'error'].includes(state);

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
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSessions(projectSlug) });
      pushToast({
        tone: 'ok',
        message:
          kind === 'stop' ? t('steer.stopped', { count: result.reclaimed }) : t('steer.sent'),
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('steer.placeholder')}
        disabled={finished}
        aria-label={t('steer.label')}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={finished || send.isPending || message.trim() === ''}
          onClick={() => send.mutate('steer')}
          title={t('steer.send_title')}
        >
          {t('steer.send')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid="stop-button"
          disabled={finished || send.isPending}
          onClick={() => setConfirming(true)}
          title={t('steer.stop_title')}
        >
          {t('steer.stop')}
        </Button>
        {finished && <span className="text-xs text-text-faint">{t('steer.finished')}</span>}
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
