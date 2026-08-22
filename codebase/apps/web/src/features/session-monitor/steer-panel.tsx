// steer / stop — 사람이 달리는 세션에 개입하는 유일한 경로 (FR-08 · EP-SES-04)
//
// 두 버튼의 의미가 다르다는 것을 화면이 말해야 한다:
//   steer — 다음 하트비트에 실려 전달된다(즉시가 아니다. 에이전트는 도구 호출 사이에서만 듣는다)
//   stop  — 전달과 **무관하게** 서버가 즉시 클레임을 회수한다. 그래서 죽은 세션에도 듣는다
// 이 구분을 숨기면 사람은 steer 를 누르고 즉시 멈추길 기대하다 다시 누르게 된다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';

export interface SteerPanelProps {
  projectSlug: string;
  sessionId: string;
  state: string;
}

export function SteerPanel({ projectSlug, sessionId, state }: SteerPanelProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const [message, setMessage] = useState('');
  const finished = ['complete', 'error'].includes(state);

  const send = useMutation({
    mutationFn: (kind: 'steer' | 'stop') =>
      apiFetch<{ reclaimed: number }>(`/projects/${projectSlug}/sessions/${sessionId}/steer`, {
        method: 'POST',
        body: { kind, message: kind === 'stop' && message.trim() === '' ? '중단 요청' : message },
        idempotencyKey: `steer-${sessionId}-${kind}-${message.slice(0, 16)}`,
      }),
    onSuccess: (result, kind) => {
      setMessage('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSessions(projectSlug) });
      pushToast({
        tone: 'ok',
        message:
          kind === 'stop'
            ? `중단 요청 — 클레임 ${result.reclaimed}건을 회수했습니다.`
            : '지시를 보냈습니다. 다음 하트비트에 전달됩니다.',
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  return (
    <div className="flex flex-col gap-2">
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="지시 (예: 스펙 SPC-CWC-007 을 먼저 확인하세요)"
        disabled={finished}
        className="rounded border border-border bg-bg px-2 py-1 text-sm disabled:opacity-50"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={finished || send.isPending || message.trim() === ''}
          onClick={() => send.mutate('steer')}
          className="rounded border border-border px-2 py-1 text-sm disabled:opacity-50"
          title="다음 하트비트에 실려 전달됩니다"
        >
          지시 보내기
        </button>
        <button
          type="button"
          data-testid="stop-button"
          disabled={finished || send.isPending}
          onClick={() => send.mutate('stop')}
          className="rounded border border-status-danger px-2 py-1 text-sm text-status-danger disabled:opacity-50"
          title="즉시 클레임을 회수하고 작업을 ready 로 되돌립니다"
        >
          중단
        </button>
        {finished && <span className="text-xs text-text-faint">종료된 세션입니다</span>}
      </div>
    </div>
  );
}
