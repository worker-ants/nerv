// 토큰 표의 공용 조각 — 내 토큰(`/settings/tokens`)과 조직 전체 토큰(`/settings/org-tokens`)이 같이 쓴다
//
// 라우트 파일끼리는 함수를 주고받지 않는다(자동 코드 분할 — 공용은 여기). 2026-09-25 에 조직 전체 표가 토큰 탭에서
// 조직 묶음의 자기 화면으로 나가면서(REQ-WEB-227) 두 화면이 나눠 쓰게 됐다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { AGENT_SCOPES, HUMAN_ONLY_SCOPES } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { apiFetch } from '../../lib/api.js';
import { useRealtime } from '../../lib/realtime.js';
import { ScopeBadge } from '../../components/scope-badge.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';

/** 만료가 이미 지났는가 — 서버의 검증(`verifyPat`)과 같은 판정이다. */
export function isExpired(value: unknown): boolean {
  return typeof value === 'string' && new Date(value).getTime() <= Date.now();
}

/** 표의 날짜 칸 — 시각까지 적으면 열이 읽히지 않는다. 없으면 "없음" 이라고 말한다. */
export function day(value: unknown, absent: string): string {
  return typeof value === 'string' && value !== '' ? value.slice(0, 10) : absent;
}

/**
 * **권한 칸** — 발급 폼과 고치기 줄이 같은 것을 쓴다(2026-10-11 · REQ-WEB-306). 잠그는 규칙이 두 벌이면
 * 한쪽만 역할 밖 권한을 열어 두는 날이 온다.
 *
 * - 내 역할에 없는 권한은 **보이되 잠긴다** — 목록에서 빼면 "왜 이건 못 주지" 가 화면 밖에 남는다.
 *   단 `keep` 에 있는 것(이미 토큰에 담긴 것)은 풀어 둔다: 빼는 것은 언제나 안전하고, 역할이 좁아진 뒤에
 *   남은 권한을 사람이 치울 길이 있어야 한다.
 * - 사람 전용 권한은 **숨기지 않고 비활성으로 보인다**(REQ-WEB-027 · D-08). 보이되 고를 수 없는 것이 규칙을
 *   가르친다.
 * - 권한마다 **무엇을 허락하는지** 한 줄을 붙인다(SET-14) — 코드는 그대로 둔다: 스킬 · 매뉴얼이 그 이름으로 부른다.
 */
export function ScopeChecklist({
  myScopes,
  checked,
  editable,
  keep = [],
  onToggle,
  testId = 'token-scope',
  humanOnlyTestId = 'human-only-scope',
}: {
  /** 그 프로젝트에서 내 역할이 가진 권한 */
  myScopes: ReadonlySet<string>;
  checked: readonly string[];
  /** 거짓이면 보여 주기만 한다(발급 폼의 [권장]) */
  editable: boolean;
  /** 역할 밖이어도 뺄 수 있게 풀어 둘 권한 — 고치기 줄이 그 토큰의 지금 권한을 넘긴다 */
  keep?: readonly string[];
  onToggle: (scope: string, on: boolean) => void;
  testId?: string;
  humanOnlyTestId?: string;
}): React.JSX.Element {
  const t = useT();
  return (
    <fieldset className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
      <legend className="sr-only">{t('settings.tokens.scopes')}</legend>
      {AGENT_SCOPES.map((scope) => {
        const mineScope = myScopes.has(scope);
        const open = mineScope || keep.includes(scope);
        return (
          <label
            key={scope}
            data-testid={testId}
            className={
              open
                ? 'flex cursor-pointer items-start gap-1.5'
                : 'flex items-start gap-1.5 opacity-45'
            }
            title={mineScope ? undefined : t('settings.tokens.out_of_role')}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={checked.includes(scope)}
              disabled={!open || !editable}
              onChange={(e) => onToggle(scope, e.target.checked)}
            />
            <span className="flex flex-col">
              <code className="font-mono">{scope}</code>
              <span className="text-text-faint">{t(`scope.desc.${scope}`)}</span>
            </span>
          </label>
        );
      })}
      {HUMAN_ONLY_SCOPES.map((scope) => (
        <label
          key={scope}
          data-testid={humanOnlyTestId}
          title={t('settings.tokens.human_only_title')}
          className="flex cursor-not-allowed items-start gap-1.5 opacity-50"
        >
          <input type="checkbox" className="mt-0.5" disabled checked={false} readOnly />
          <span className="flex flex-col">
            <span>
              <code className="font-mono">{scope}</code>{' '}
              <span className="text-text-faint">{t('settings.tokens.human_only')}</span>
            </span>
            <span className="text-text-faint">{t(`scope.desc.${scope}`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * 고치기 — 내 토큰의 이름과 권한(EP-TOK-05 · REQ-API-292). 주인만 고치므로 내 표에만 있다(조직 전체 표는 폐기만).
 * 바뀐 권한은 그 토큰의 다음 호출부터 적용된다 — 토스트가 그 사실을 말한다.
 */
export function useUpdateToken(
  orgSlug: string | null,
): UseMutationResult<
  { changed?: boolean },
  Error,
  { id: string; name?: string; scopes?: readonly string[] }
> {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; scopes?: readonly string[] }) =>
      apiFetch<{ changed?: boolean }>(`/me/tokens/${id}`, { method: 'PATCH', body }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'tokens'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'tokens'] });
      pushToast(
        result.changed === false
          ? { tone: 'info', message: t('settings.tokens.edit_no_change') }
          : { tone: 'ok', message: t('settings.tokens.edit_done') },
      );
    },
  });
}

/**
 * 폐기 — 내 표와 조직 전체 표가 같은 것을 쓴다(EP-TOK-03 은 본인 또는 조직 admin · REQ-API-173).
 * 실패는 기본 처리기가 말한다(REQ-WEB-196).
 */
export function useRevoke(orgSlug: string | null): UseMutationResult<unknown, Error, string> {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  return useMutation<unknown, Error, string>({
    mutationFn: (id: string) => apiFetch(`/me/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'tokens'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'tokens'] });
      pushToast({ tone: 'ok', message: t('settings.tokens.revoke_done') });
    },
  });
}

/**
 * **폐기는 되돌릴 수 없다**(REQ-WEB-200). 예전에는 한 번 누르면 끝이었고, 그 토큰을 쓰던
 * 기계의 에이전트는 작업 도중 다음 호출부터 401 을 받았다. 확인은 **누가 끊기는지**를 말한다 —
 * 마지막으로 쓴 기계가 유출 판단과 폐기 판단의 첫 단서다(NFR-03).
 */
export function RevokeButton({
  token,
  revoke,
}: {
  token: Record<string, unknown>;
  revoke: ReturnType<typeof useRevoke>;
}): React.JSX.Element {
  const t = useT();
  const host = token['last_used_hostname'];
  return (
    <ConfirmAction
      label={t('settings.tokens.revoke')}
      testId="token-revoke"
      message={t('settings.tokens.revoke_confirm', { name: String(token['name']) })}
      detail={
        token['last_used_at'] === null || token['last_used_at'] === undefined
          ? t('settings.tokens.revoke_detail_unused')
          : typeof host === 'string' && host !== ''
            ? t('settings.tokens.revoke_detail_host', { host })
            : t('settings.tokens.revoke_detail_used')
      }
      confirmLabel={t('settings.tokens.revoke')}
      pending={revoke.isPending}
      onConfirm={() => revoke.mutate(String(token['id']))}
    />
  );
}

/**
 * 프로젝트 칸 — 이름으로 읽고 slug 로 대조한다(설정 파일에 적는 것은 slug 다).
 *
 * **내 토큰은 모든 조직의 것이다**(REQ-WEB-192) — 조직이 둘 이상이면 조직이 앞에 선다.
 * 조직 전체 표(`OrgTokens`)는 한 조직의 것이라 조직을 넘기지 않는다.
 */
export function ProjectCell({ token }: { token: Record<string, unknown> }): React.JSX.Element {
  return (
    <ScopeBadge
      className="text-sm text-text"
      orgSlug={token['org_slug']}
      orgName={token['org_name']}
      projectSlug={token['project_slug'] ?? ''}
      projectName={token['project_name']}
      withSlug
    />
  );
}
