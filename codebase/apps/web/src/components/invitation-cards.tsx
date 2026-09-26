// 내게 온 초대 — 한 컴포넌트, 세 자리 (screens.md §2.1b)
//
// 홈·온보딩·알림 센터가 **같은 것**을 보인다. 초대받은 사람이 어디로 들어올지는 정해져
// 있지 않기 때문이다: 링크로 오기도 하고, 로그인만 하고 홈을 보기도 하고, 소속이 없어
// 온보딩에 서 있기도 하다. 그중 한 자리에만 두면 나머지 두 길로 온 사람은 초대가 온 줄
// 모른다.
//
// **알림 테이블을 타지 않는다**(queries.ts `useMyInvitations` 주석) — 초대받은 사람은
// 아직 아무 프로젝트의 멤버가 아니라, 프로젝트 소속 알림 목록은 그에게 늘 비어 있다.

import { useT } from '../lib/i18n.js';
import { useApiError } from '../lib/api-errors.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { apiFetch } from '../lib/api.js';
import { fetchMe } from '../lib/session.js';
import type { Me } from '../lib/session.js';
import { queryKeys } from '../lib/query-keys.js';
import { rows, useMyInvitations } from '../lib/queries.js';
import { useRealtime } from '../lib/realtime.js';
import { Button, Card } from './ui/primitives.js';
import { ConfirmAction } from './ui/confirm-action.js';
import type { Translator } from '@nerv/schema';

export interface InvitationCardsProps {
  /** 온보딩처럼 이미 제목이 있는 자리에서는 머리글을 숨긴다 */
  heading?: boolean | undefined;
}

export function InvitationCards({
  heading = true,
}: InvitationCardsProps): React.JSX.Element | null {
  const t = useT();
  const invitations = useMyInvitations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();

  const accept = useMutation({
    // 카드는 **id 로** 수락한다 — 토큰은 해시만 저장되므로 화면이 그것을 알 길이 없다.
    // 이메일 대조는 링크 경로와 같은 자리에서 같은 규칙으로 걸린다(EP-INV-05b).
    mutationFn: (id: string) => apiFetch(`/me/invitations/${id}/accept`, { method: 'POST' }),
    onSuccess: async (result) => {
      const accepted = result as Record<string, unknown>;
      const org = String(accepted['org_slug'] ?? '');
      const project = accepted['project_slug'];
      // **첫 소속이면 온보딩의 ②③ 으로 간다**(2026-09-24 · REQ-WEB-205). 곧장 조직으로 떠나면 역할
      // 설명과 에이전트 연결 안내를 한 번도 보지 못했다 — 그 카드는 처음 들어온 사람을 위한 것이다
      const first = (queryClient.getQueryData<Me>(queryKeys.me())?.memberships.length ?? 0) === 0;
      // me 를 다시 읽어야 헤더의 조직 select 가 방금 들어간 조직을 안다
      queryClient.setQueryData(queryKeys.me(), await fetchMe());
      void queryClient.invalidateQueries({ queryKey: ['me', 'invitations'] });
      pushToast({ tone: 'ok', message: t('invite.accepted_toast', { org }) });
      // **들어간 조직으로 옮겨 간다**(2026-09-24 · REQ-WEB-190). `/` 로만 보내던 동안 이미 다른
      // 조직에 속한 사람은 옛 조직의 홈에 섰고 수락이 됐는지 알 수 없었다. 프로젝트 초대면
      // 그 프로젝트가 착지점이다.
      void navigate(first ? { to: '/onboarding' } : acceptedLanding(org, project));
    },
    onError: onApiError,
  });

  // **거절할 수 있다**(2026-09-24 · 사람 결정 · REQ-API-178). 원치 않는 초대가 만료(7일)까지 홈과
  // 알림 맨 위에 서 있었다 — 치울 길이 없었다. 되돌릴 수 없으므로(다시 오려면 새 초대가 필요하다) 묻는다
  const decline = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/invitations/${id}/decline`, { method: 'POST' }),
    onSuccess: (_result, id) => {
      const invite = rows(invitations.data).find((i) => String(i['id']) === id);
      void queryClient.invalidateQueries({ queryKey: ['me', 'invitations'] });
      pushToast({
        tone: 'ok',
        message: t('invite.declined_toast', {
          org: String(invite?.['org_name'] ?? invite?.['org_slug'] ?? ''),
        }),
      });
    },
    onError: onApiError,
  });

  const pending = rows(invitations.data);
  // 없으면 자리도 차지하지 않는다 — 빈 제목은 화면에 구멍이다
  if (pending.length === 0) return null;

  return (
    <section data-testid="invitation-cards" className="flex flex-col gap-2">
      {heading && (
        <div className="text-lg font-strong tracking-heading">{t('invite.mine_title')}</div>
      )}
      {pending.map((invite) => (
        <Card key={String(invite['id'])} className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-snug font-medium tracking-heading">
              {/* **어디로 부르는지가 문장 안에 있다**(REQ-WEB-192) — 흐린 둘째 줄의 slug 로만 말하던
                  동안 프로젝트 초대가 조직 전체 역할처럼 읽혔다 */}
              {invitationSentence(t, invite)}
            </span>
            <span className="mt-0.5 block text-xs text-text-faint">
              {t('invite.invited_by', { name: String(invite['invited_by'] ?? '') })}
              {/* 언제까지 기다려 주는지 — 7일이 지나면 다시 불러야 한다 */}
              {expiryLabel(t, invite['expires_at']) !== null && (
                <span data-testid="invite-expiry"> · {expiryLabel(t, invite['expires_at'])}</span>
              )}
            </span>
          </span>
          <ConfirmAction
            label={t('invite.decline')}
            variant="ghost"
            testId="invite-decline"
            message={t('invite.decline_confirm')}
            confirmLabel={t('invite.decline')}
            pending={decline.isPending}
            onConfirm={() => decline.mutate(String(invite['id']))}
          />
          <Button
            variant="primary"
            data-testid="invite-accept"
            disabled={accept.isPending}
            onClick={() => accept.mutate(String(invite['id']))}
          >
            {accept.isPending ? t('invite.accepting') : t('invite.accept')}
          </Button>
        </Card>
      ))}
    </section>
  );
}

/** "3일 뒤 만료" · "오늘 만료" — 값이 없거나 읽을 수 없으면 말하지 않는다 */
export function expiryLabel(t: Translator, expiresAt: unknown): string | null {
  if (typeof expiresAt !== 'string') return null;
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms)) return null;
  const days = Math.floor(ms / 86_400_000);
  return days < 1 ? t('invite.expires_today') : t('invite.expires_in', { days });
}

/** 수락한 초대의 착지점 — 조직 전환(`/o/:org`)을 거쳐, 프로젝트 초대면 그 프로젝트로 */
export function acceptedLanding(
  org: string,
  project: unknown,
): { to: '/o/$org'; params: { org: string }; search: { next?: string } } {
  return {
    to: '/o/$org',
    params: { org },
    search: typeof project === 'string' && project !== '' ? { next: `/p/${project}` } : {},
  };
}

/** 초대 한 건의 문장 — 조직 전체와 프로젝트를 문장이 가른다(카드와 `/invite/$token` 이 같이 쓴다) */
export function invitationSentence(
  t: ReturnType<typeof useT>,
  invite: Record<string, unknown>,
): string {
  const org = String(invite['org_name'] ?? invite['org_slug'] ?? '');
  const role = String(invite['role'] ?? '');
  const project = invite['project_slug'];
  if (typeof project !== 'string' || project === '') {
    return t('invite.mine_body', { org, role });
  }
  const name = invite['project_name'];
  return t('invite.mine_body_project', {
    org,
    project: typeof name === 'string' && name !== '' ? name : project,
    role,
  });
}
