// 내게 온 초대 — 한 컴포넌트, 세 자리 (screens.md §2.1b)
//
// 홈·온보딩·알림 센터가 **같은 것**을 보인다. 초대받은 사람이 어디로 들어올지는 정해져
// 있지 않기 때문이다: 링크로 오기도 하고, 로그인만 하고 홈을 보기도 하고, 소속이 없어
// 온보딩에 서 있기도 하다. 그중 한 자리에만 두면 나머지 두 길로 온 사람은 초대가 온 줄
// 모른다.
//
// **알림 테이블을 타지 않는다**(queries.ts `useMyInvitations` 주석) — 초대받은 사람은
// 아직 아무 프로젝트의 멤버가 아니라, 프로젝트 스코프 알림 목록은 그에게 늘 비어 있다.

import { useT } from '../lib/i18n.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { apiFetch } from '../lib/api.js';
import { fetchMe } from '../lib/session.js';
import { queryKeys } from '../lib/query-keys.js';
import { rows, useMyInvitations } from '../lib/queries.js';
import { useRealtime } from '../lib/realtime.js';
import { Button, Card } from './ui/primitives.js';

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

  const accept = useMutation({
    // 카드는 **id 로** 수락한다 — 토큰은 해시만 저장되므로 화면이 그것을 알 길이 없다.
    // 이메일 대조는 링크 경로와 같은 자리에서 같은 규칙으로 걸린다(EP-INV-05b).
    mutationFn: (id: string) => apiFetch(`/me/invitations/${id}/accept`, { method: 'POST' }),
    onSuccess: async (result) => {
      const org = String((result as Record<string, unknown>)['org_slug'] ?? '');
      // me 를 다시 읽어야 헤더의 조직 select 가 방금 들어간 조직을 안다
      queryClient.setQueryData(queryKeys.me(), await fetchMe());
      void queryClient.invalidateQueries({ queryKey: ['me', 'invitations'] });
      pushToast({ tone: 'ok', message: t('invite.accepted_toast', { org }) });
      void navigate({ to: '/' });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  const pending = rows(invitations.data);
  // 없으면 자리도 차지하지 않는다 — 빈 제목은 화면에 구멍이다
  if (pending.length === 0) return null;

  return (
    <section data-testid="invitation-cards" className="flex flex-col gap-2">
      {heading && (
        <div className="text-lg font-[650] tracking-[-0.012em]">{t('invite.mine_title')}</div>
      )}
      {pending.map((invite) => (
        <Card key={String(invite['id'])} className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-[1.45] font-medium tracking-[-0.008em]">
              {t('invite.mine_body', {
                org: String(invite['org_name'] ?? invite['org_slug']),
                role: String(invite['role']),
              })}
            </span>
            <span className="mt-0.5 block text-xs text-text-faint">
              {invite['project_slug'] === null
                ? t('invite.scope_org')
                : String(invite['project_slug'])}
              {' · '}
              {String(invite['invited_by'] ?? '')}
            </span>
          </span>
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
