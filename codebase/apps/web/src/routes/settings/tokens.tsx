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
import { AGENT_SCOPES, HUMAN_ONLY_SCOPES } from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useTokens } from '../../lib/queries.js';
import { primaryMembership } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SectionTitle,
  Table,
  Td,
  Th,
  Tr,
} from '../../components/ui/primitives.js';

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="에이전트 토큰"
        description="원문은 발급 직후 한 번만 보입니다 — 목록에는 prefix 만 남습니다."
      />
      <Card>
        <SectionTitle>새 토큰 발급</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-56"
            aria-label="토큰 이름"
          />
          <Button
            variant="primary"
            disabled={issue.isPending || membership?.project_slug == null}
            onClick={() => issue.mutate()}
          >
            발급
          </Button>
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <legend className="sr-only">스코프</legend>
          {AGENT_SCOPES.map((scope) => (
            <label key={scope} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes((prev) =>
                    e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                  )
                }
              />
              <code className="font-mono">{scope}</code>
            </label>
          ))}
          {/* 사람 전용 스코프는 **숨기지 않고 비활성으로 보인다**(REQ-WEB-027 · D-08).
              목록에서 빼버리면 "왜 승인 권한을 토큰에 못 주지?"라는 질문이 화면 밖에 남고,
              그 답이 어디에도 없다. 보이되 고를 수 없는 것이 규칙을 가르친다. */}
          {HUMAN_ONLY_SCOPES.map((scope) => (
            <label
              key={scope}
              data-testid="human-only-scope"
              title="사람 전용 스코프 — 토큰에 부여할 수 없습니다(D-08)"
              className="flex cursor-not-allowed items-center gap-1.5 opacity-50"
            >
              <input type="checkbox" disabled checked={false} readOnly />
              <code className="font-mono">{scope}</code>
              <span className="text-text-faint">사람 전용</span>
            </label>
          ))}
        </fieldset>
        {issued !== null && (
          <div
            data-testid="issued-token"
            className="mt-3 rounded-nerv border border-status-ok bg-status-ok-soft p-3"
          >
            <p className="text-sm font-medium text-status-ok">
              이 값은 다시 볼 수 없습니다 — 지금 복사하세요.
            </p>
            <code className="mt-2 block rounded-nerv-sm bg-code-bg p-2 font-mono text-xs break-all text-code-text">
              {issued}
            </code>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setIssued(null)}>
              닫기
            </Button>
          </div>
        )}
      </Card>

      <div>
        <SectionTitle>발급된 토큰</SectionTitle>
        {rows(tokens.data).length === 0 ? (
          <EmptyState
            icon="🔑"
            title="아직 토큰이 없습니다."
            hint="발급 후 플러그인 설치로 이어집니다."
          />
        ) : (
          <Table
            head={
              <>
                <Th>이름</Th>
                <Th>prefix</Th>
                <Th>스코프</Th>
                <Th>마지막 사용</Th>
                <Th>마지막 호스트</Th>
                <Th />
              </>
            }
          >
            {rows(tokens.data).map((t) => (
              <Tr key={String(t['id'])}>
                <Td className="font-medium">{String(t['name'])}</Td>
                <Td className="font-mono text-xs">{String(t['prefix'])}…</Td>
                <Td className="text-xs text-text-mute">
                  {(t['scopes'] as string[] | undefined)?.join(' · ')}
                </Td>
                <Td className="text-xs text-text-mute">
                  {t['last_used_at'] === null ? '미사용' : String(t['last_used_at']).slice(0, 10)}
                </Td>
                {/* 어느 머신이 이 토큰을 쓰는가 — 유출 판단의 첫 단서다(NFR-03) */}
                <Td className="font-mono text-xs text-text-mute">
                  {t['last_used_hostname'] === null || t['last_used_hostname'] === undefined
                    ? '—'
                    : String(t['last_used_hostname'])}
                </Td>
                <Td className="text-right">
                  {t['revoked_at'] === null ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => revoke.mutate(String(t['id']))}
                    >
                      폐기
                    </Button>
                  ) : (
                    <span className="text-xs text-text-faint">폐기됨</span>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}
