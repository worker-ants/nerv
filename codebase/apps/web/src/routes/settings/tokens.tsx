// /settings/tokens — S8 에이전트 토큰 (FR-14 · D-08)
//
// **원문은 발급 응답에서 한 번만 보인다.** 다시 볼 수 없다는 사실을 화면이 분명히 말해야
// 하고(그러지 않으면 사람은 창을 닫고 다시 찾는다), 목록에는 prefix 만 남는다.
//
// 스코프는 **사람 권한의 부분집합**을 넘지 못한다(D-08). 두 종류가 잠긴다.
//   ① 사람 전용(`spec:approve`·`approval:decide`) — 누구도 토큰에 실을 수 없다
//   ② **내 역할 밖** — 예를 들어 developer 의 `review:resolve`(2026-09-02 사람 결정)
//
// ②가 오래 열려 있었다. 발급은 되는데 검증 시점 교집합에서 잘려 **켜 놓고 쓸 수 없는**
// 토큰이 나왔고, 사람은 그 이유를 화면 어디에서도 볼 수 없었다. 발급 시점에 잘라 저장하지
// 않는 것은 그대로 둔다 — 나중에 역할이 넓어지면 이미 발급된 토큰이 그 순간 따라가야 한다.
// 화면이 말해 주는 것과 저장을 좁히는 것은 다른 일이다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AGENT_SCOPES, HUMAN_ONLY_SCOPES, scopesForRoles } from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useTokens } from '../../lib/queries.js';
import { rolesInProject } from '../../lib/session.js';
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
  const { orgSlug, projectSlug } = useScope();
  // 역할은 겸직의 합집합이다 — 서버의 `assertMembership` 과 같은 규칙(session.ts)
  const myScopes = scopesForRoles(rolesInProject(useMe().data, orgSlug, projectSlug));

  const [name, setName] = useState(t('settings.tokens.default_name'));
  const [scopes, setScopes] = useState<string[]>(['spec:read', 'task:claim']);
  const [issued, setIssued] = useState<string | null>(null);

  // **화면이 보여준 것과 발급되는 것이 같아야 한다**(2026-09-04 · 실측).
  // 초기값이 상수라, 역할에 `task:claim` 이 없는 사람에게는 그 칸이 잠긴 채 **체크 해제로**
  // 보이는데 본문에는 실려 갔다. 사용 시점에 역할과 교집합을 내므로 권한이 새지는 않았지만,
  // 발급된 토큰의 스코프 표는 그 사람이 고른 적 없는 값을 보여줬다.
  const granted = scopes.filter((scope) => myScopes.has(scope as never));

  const issue = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string; prefix: string }>('/me/tokens', {
        method: 'POST',
        body: { project: projectSlug ?? '', name, scopes: granted },
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
      <PageHeader title={t('settings.tab.tokens')} />
      <Card>
        <SectionTitle>{t('settings.tokens.new')}</SectionTitle>
        {/* 한 번만 보인다는 사실은 **누르기 전에** 읽혀야 한다 — 화면 머리에 있으면
            발급 버튼까지 눈이 내려간 뒤라 이미 늦다 */}
        <p className="mb-2.5 text-xs text-text-mute">{t('settings.tokens.lead')}</p>
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
          {AGENT_SCOPES.map((scope) => {
            // 내 역할에 없는 스코프는 **보이되 잠긴다**. 사람 전용 스코프와 같은 규율이다 —
            // 목록에서 빼면 "왜 이건 못 주지"가 화면 밖에 남는다.
            const mine = myScopes.has(scope);
            return (
              <label
                key={scope}
                className={
                  mine
                    ? 'flex cursor-pointer items-center gap-1.5'
                    : 'flex items-center gap-1.5 opacity-45'
                }
                title={mine ? undefined : t('settings.tokens.out_of_role')}
              >
                <input
                  type="checkbox"
                  checked={granted.includes(scope)}
                  disabled={!mine}
                  onChange={(e) =>
                    setScopes((prev) =>
                      e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                    )
                  }
                />
                <code className="font-mono">{scope}</code>
              </label>
            );
          })}
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
