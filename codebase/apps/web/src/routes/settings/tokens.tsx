// /settings/tokens — S8 에이전트 토큰 (FR-14 · D-08)
//
// **원문은 발급 응답에서 한 번만 보인다.** 다시 볼 수 없다는 사실을 화면이 분명히 말해야
// 하고(그러지 않으면 사람은 창을 닫고 다시 찾는다), 목록에는 prefix 만 남는다.
//
// 스코프는 **사람 권한의 부분집합**을 넘지 못한다(D-08). 사람 전용 스코프(`spec:approve` 등)는
// 목록에 아예 없다 — 고를 수 있게 두고 서버가 거절하는 것보다, 고를 수 없게 하는 편이 낫다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AGENT_SCOPES, HUMAN_ONLY_SCOPES } from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { rows, useTokens } from '../../lib/queries.js';
import { useScope } from '../../lib/scope.js';
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
  const t = useT();
  const tokens = useTokens();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  // 발급 대상 프로젝트는 **헤더에서 고른 프로젝트**다. 예전에는 멤버십 한 행의
  // `project_slug` 를 썼고, 조직 단위 멤버십만 가진 admin 은 그 값이 `null` 이라
  // 발급 버튼이 영영 비활성이었다(실측 2026-08-24).
  const { projectSlug } = useScope();

  const [name, setName] = useState(t('settings.tokens.default_name'));
  const [scopes, setScopes] = useState<string[]>(['spec:read', 'task:claim']);
  const [issued, setIssued] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string; prefix: string }>('/me/tokens', {
        method: 'POST',
        body: { project: projectSlug ?? '', name, scopes },
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
      pushToast({ tone: 'ok', message: t('settings.tokens.revoke_done') });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('settings.tab.tokens')} description={t('settings.tokens.lead')} />
      <Card>
        <SectionTitle>{t('settings.tokens.new')}</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-56"
            aria-label={t('settings.tokens.name')}
          />
          <Button
            variant="primary"
            disabled={issue.isPending || projectSlug === null}
            onClick={() => issue.mutate()}
          >
            {t('settings.tokens.issue')}
          </Button>
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <legend className="sr-only">{t('settings.members.scope')}</legend>
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
              title={t('settings.tokens.human_only_title')}
              className="flex cursor-not-allowed items-center gap-1.5 opacity-50"
            >
              <input type="checkbox" disabled checked={false} readOnly />
              <code className="font-mono">{scope}</code>
              <span className="text-text-faint">{t('settings.tokens.human_only')}</span>
            </label>
          ))}
        </fieldset>
        {issued !== null && (
          <div
            data-testid="issued-token"
            className="mt-3 rounded-nerv border border-status-ok bg-status-ok-soft p-3"
          >
            <p className="text-sm font-medium text-status-ok">{t('settings.tokens.copy_now')}</p>
            <code className="mt-2 block rounded-nerv-sm bg-code-bg p-2 font-mono text-xs break-all text-code-text">
              {issued}
            </code>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setIssued(null)}>
              {t('common.close')}
            </Button>
          </div>
        )}
      </Card>

      <div>
        <SectionTitle>{t('settings.tokens.issued')}</SectionTitle>
        {rows(tokens.data).length === 0 ? (
          <EmptyState
            icon="🔑"
            title={t('settings.tokens.empty')}
            hint={t('settings.tokens.empty_hint')}
          />
        ) : (
          <Table
            head={
              <>
                <Th>{t('settings.members.name')}</Th>
                <Th>prefix</Th>
                <Th>{t('settings.members.scope')}</Th>
                <Th>{t('settings.tokens.last_used')}</Th>
                <Th>{t('settings.tokens.last_host')}</Th>
                <Th />
              </>
            }
          >
            {rows(tokens.data).map((token) => (
              <Tr key={String(token['id'])}>
                <Td className="font-medium">{String(token['name'])}</Td>
                <Td className="font-mono text-xs">{String(token['prefix'])}…</Td>
                <Td className="text-xs text-text-mute">
                  {(token['scopes'] as string[] | undefined)?.join(' · ')}
                </Td>
                <Td className="text-xs text-text-mute">
                  {token['last_used_at'] === null
                    ? t('settings.tokens.unused')
                    : String(token['last_used_at']).slice(0, 10)}
                </Td>
                {/* 어느 머신이 이 토큰을 쓰는가 — 유출 판단의 첫 단서다(NFR-03) */}
                <Td className="font-mono text-xs text-text-mute">
                  {token['last_used_hostname'] === null || token['last_used_hostname'] === undefined
                    ? '—'
                    : String(token['last_used_hostname'])}
                </Td>
                <Td className="text-right">
                  {token['revoked_at'] === null ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => revoke.mutate(String(token['id']))}
                    >
                      {t('settings.tokens.revoke')}
                    </Button>
                  ) : (
                    <span className="text-xs text-text-faint">{t('settings.tokens.revoked')}</span>
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
