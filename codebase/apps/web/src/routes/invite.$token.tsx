// /invite/:token — 초대 링크 (screens.md §2.1b)
//
// **기존 사용자와 신규 사용자를 분기하지 않는다.** 초대하는 쪽은 상대가 이미 계정을
// 가졌는지 모르고, 알 필요도 없다 — 이 한 장이 셋 다 처리한다.
//
//   로그인 안 함        → 가입/로그인으로 보내되 **돌아올 자리를 들려 보낸다**
//   로그인 · 이메일 일치 → 여기서 수락
//   로그인 · 이메일 불일치 → 거절하고 그 사실을 말한다(수락은 서버가 막는다)
//
// 셸 밖이다 — 아직 이 조직의 멤버가 아니라서 헤더의 두 select 가 가리킬 것이 없다.

import { useT } from '../lib/i18n.js';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, NervApiError } from '../lib/api.js';
import { fetchMe } from '../lib/session.js';
import { queryKeys } from '../lib/query-keys.js';
import { useMe } from '../lib/queries.js';
import { Button, Skeleton } from '../components/ui/primitives.js';

export const Route = createFileRoute('/invite/$token')({ component: InviteScreen });

interface Preview {
  org_name: string;
  org_slug: string;
  project_slug: string | null;
  role: string;
  email_hint: string;
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
}

function InviteScreen(): React.JSX.Element {
  const t = useT();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiFetch<Preview>(`/invitations/${token}`),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => apiFetch(`/invitations/${token}/accept`, { method: 'POST' }),
    onSuccess: async () => {
      queryClient.setQueryData(queryKeys.me(), await fetchMe());
      void navigate({ to: '/' });
    },
  });

  const signedIn = me.data !== undefined;
  const invite = preview.data;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight">
            <span aria-hidden="true" className="text-status-action">
              ⬢
            </span>{' '}
            NERV
          </div>
          <p className="mt-1 text-sm text-text-mute">{t('invite.page_title')}</p>
        </div>

        <div className="rounded-nerv-lg border border-border bg-bg-elev p-6">
          {preview.isLoading && <Skeleton rows={3} />}

          {preview.isError && (
            <p role="alert" data-testid="invite-error" className="text-sm text-status-danger">
              ⚠{' '}
              {preview.error instanceof NervApiError
                ? preview.error.message
                : String(preview.error)}
            </p>
          )}

          {invite !== undefined && (
            <>
              <p className="text-base leading-[1.45] font-medium tracking-[-0.008em]">
                {t('invite.mine_body', { org: invite.org_name, role: invite.role })}
              </p>
              <p className="mt-1 text-xs text-text-faint">
                {invite.project_slug === null ? t('invite.scope_org') : invite.project_slug}
              </p>
              {/* 이메일은 서버가 가려서 준다 — 토큰을 주운 사람에게 초대받은 사람이
                  누구인지 알려 줄 이유가 없다(EP-INV-04) */}
              <p className="mt-3 text-xs text-text-mute">
                {t('invite.for_email', { email: invite.email_hint })}
              </p>

              {invite.state !== 'pending' && (
                <p className="mt-3 text-sm text-status-waiting">
                  {t(`invite.${invite.state}` as never)}
                </p>
              )}

              {invite.state === 'pending' &&
                (signedIn ? (
                  <>
                    <Button
                      variant="primary"
                      data-testid="invite-accept"
                      disabled={accept.isPending}
                      onClick={() => accept.mutate()}
                      className="mt-4 h-9 w-full"
                    >
                      {accept.isPending ? t('invite.accepting') : t('invite.accept')}
                    </Button>
                    {accept.isError && (
                      <p role="alert" className="mt-2 text-sm text-status-danger">
                        ⚠{' '}
                        {accept.error instanceof NervApiError
                          ? accept.error.message
                          : String(accept.error)}
                      </p>
                    )}
                  </>
                ) : (
                  // **돌아올 자리를 들려 보낸다.** 가입·로그인이 끝나면 이 주소로 돌아온다
                  <div className="mt-4 flex flex-col gap-2">
                    <p className="text-sm text-text-mute">{t('invite.page_signin')}</p>
                    <Link
                      to="/signup"
                      search={{ redirect: `/invite/${token}` }}
                      data-testid="invite-signup"
                      className="rounded-nerv border border-transparent bg-status-action px-3 py-2 text-center text-sm font-medium text-white"
                    >
                      {t('signup.submit')}
                    </Link>
                    <Link
                      to="/login"
                      search={{ redirect: `/invite/${token}` }}
                      className="rounded-nerv border border-border px-3 py-2 text-center text-sm"
                    >
                      {t('login.submit')}
                    </Link>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
