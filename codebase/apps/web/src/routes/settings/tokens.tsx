// /settings/tokens — S8 에이전트 토큰 (FR-14 · D-08)
//
// **원문은 발급 응답에서 한 번만 보인다.** 다시 볼 수 없다는 사실을 화면이 분명히 말해야
// 하고(그러지 않으면 사람은 창을 닫고 다시 찾는다), 목록에는 prefix 만 남는다.
//
// 스코프는 **사람 권한의 부분집합**을 넘지 못한다(D-08). 사람 전용 스코프(`spec:approve` 등)는
// 목록에 아예 없다 — 고를 수 있게 두고 서버가 거절하는 것보다, 고를 수 없게 하는 편이 낫다.

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AGENT_SCOPES } from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useTokens } from '../../lib/queries.js';
import { primaryMembership } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';

export const Route = createFileRoute('/settings/tokens')({ component: TokensTab });

function TokensTab(): React.JSX.Element {
  const me = useMe();
  const tokens = useTokens();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const membership = me.data === undefined ? null : primaryMembership(me.data);

  const [name, setName] = useState('내 에이전트');
  const [scopes, setScopes] = useState<string[]>(['spec:read', 'task:claim']);
  const [issued, setIssued] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string; prefix: string }>('/me/tokens', {
        method: 'POST',
        body: { project: membership?.project_slug ?? '', name, scopes },
      }),
    onSuccess: (result) => {
      setIssued(result.token);
      void queryClient.invalidateQueries({ queryKey: ['me', 'tokens'] });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'tokens'] });
      pushToast({ tone: 'ok', message: '토큰을 폐기했습니다 — 즉시 무효입니다.' });
    },
  });

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">에이전트 토큰</h1>

      <div className="rounded-md border border-border bg-bg-elev p-3">
        <h2 className="mb-2 text-sm font-semibold text-text-mute">새 토큰 발급</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={issue.isPending || membership?.project_slug == null}
            onClick={() => issue.mutate()}
            className="rounded bg-status-action px-2 py-1 text-sm text-white disabled:opacity-50"
          >
            발급
          </button>
        </div>
        <fieldset className="mt-2 flex flex-wrap gap-2 text-xs">
          {AGENT_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes((prev) =>
                    e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                  )
                }
              />
              <code>{scope}</code>
            </label>
          ))}
        </fieldset>
        {issued !== null && (
          <div
            data-testid="issued-token"
            className="mt-2 rounded border border-status-ok p-2 text-sm"
          >
            <p className="font-medium text-status-ok">
              이 값은 다시 볼 수 없습니다 — 지금 복사하세요.
            </p>
            <code className="mt-1 block break-all rounded bg-code-bg p-2 text-xs text-code-text">
              {issued}
            </code>
            <button
              type="button"
              className="mt-1 text-xs text-link underline"
              onClick={() => setIssued(null)}
            >
              닫기
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-text-mute">발급된 토큰</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-text-mute">
            <tr>
              <th className="py-1">이름</th>
              <th>prefix</th>
              <th>스코프</th>
              <th>마지막 사용</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows(tokens.data).map((t) => (
              <tr key={String(t['id'])} className="border-t border-border">
                <td className="py-1">{String(t['name'])}</td>
                <td className="font-mono text-xs">{String(t['prefix'])}…</td>
                <td className="text-xs text-text-mute">
                  {(t['scopes'] as string[] | undefined)?.join(' · ')}
                </td>
                <td className="text-xs text-text-mute">
                  {t['last_used_at'] === null ? '미사용' : String(t['last_used_at']).slice(0, 10)}
                </td>
                <td>
                  {t['revoked_at'] === null ? (
                    <button
                      type="button"
                      onClick={() => revoke.mutate(String(t['id']))}
                      className="text-xs text-status-danger underline"
                    >
                      폐기
                    </button>
                  ) : (
                    <span className="text-xs text-text-faint">폐기됨</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows(tokens.data).length === 0 && (
          <p className="mt-2 text-sm text-text-mute">
            아직 토큰이 없습니다. 발급 후 플러그인 설치로 이어집니다.
          </p>
        )}
      </div>
    </section>
  );
}
