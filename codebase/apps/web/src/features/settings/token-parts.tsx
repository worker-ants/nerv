// 토큰 표의 공용 조각 — 내 토큰(`/settings/tokens`)과 조직 전체 토큰(`/settings/org-tokens`)이 같이 쓴다
//
// 라우트 파일끼리는 함수를 주고받지 않는다(자동 코드 분할 — 공용은 여기). 2026-09-25 에 조직 전체 표가 토큰 탭에서
// 조직 묶음의 자기 화면으로 나가면서(REQ-WEB-227) 두 화면이 나눠 쓰게 됐다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
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
