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

import { acceptedLanding, invitationSentence } from '../components/invitation-cards.js';
import { useT } from '../lib/i18n.js';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, NervApiError } from '../lib/api.js';
import { describeApiError } from '../lib/api-errors.js';
import { fetchMe, signOut } from '../lib/session.js';
import { ConfirmAction } from '../components/ui/confirm-action.js';
import { queryKeys } from '../lib/query-keys.js';
import { useMe } from '../lib/queries.js';
import { Button, Skeleton } from '../components/ui/primitives.js';

export const Route = createFileRoute('/invite/$token')({ component: InviteScreen });

interface Preview extends Record<string, unknown> {
  org_name: string;
  org_slug: string;
  project_slug: string | null;
  project_name?: string | null;
  role: string;
  email_hint: string;
  state: 'pending' | 'accepted' | 'revoked' | 'declined' | 'expired';
  /** 로그인한 채 열었을 때만 — 이 초대가 지금 계정의 것인가(REQ-API-178). 모르면 `null` */
  matches_me?: boolean | null;
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
    onSuccess: async (result) => {
      // 첫 소속이면 온보딩의 ②③ 으로 — 카드에서 수락한 것과 같은 규칙이다(REQ-WEB-205)
      const first = (me.data?.memberships.length ?? 0) === 0;
      queryClient.setQueryData(queryKeys.me(), await fetchMe());
      // 카드에서 수락한 것과 같은 착지점이다 — 들어간 조직으로 옮겨 간다(REQ-WEB-190)
      const accepted = result as Record<string, unknown>;
      void navigate(
        first
          ? { to: '/onboarding' }
          : acceptedLanding(String(accepted['org_slug'] ?? ''), accepted['project_slug']),
      );
    },
    // 셸 밖 화면이라 토스트가 설 자리가 없다 — 실패는 단추 아래에서 말한다
    meta: { inlineError: true },
  });

  // 거절 — 카드와 같은 자물쇠(초대받은 계정만 · REQ-API-178). 끝나면 미리보기를 다시 읽어 "거절됨" 을 보인다
  const decline = useMutation({
    mutationFn: () => apiFetch(`/invitations/${token}/decline`, { method: 'POST' }),
    onSuccess: () => void preview.refetch(),
    meta: { inlineError: true },
  });

  const signedIn = me.data !== undefined;
  const invite = preview.data;
  // **다른 계정이면 수락 단추를 세우지 않는다**(SET-11). 예전에는 [참여하기]를 누른 뒤에야 서버 오류를
  // 봤고, 셸 밖 화면이라 로그아웃할 자리도 없어 메일에서 링크를 다시 찾아야 했다
  const wrongAccount = signedIn && invite?.matches_me === false;

  /** 막다른 길을 만들지 않는다(§1.5) — 끝난 초대·없는 링크 뒤에는 다음 걸음을 둔다 */
  const nextStep = (
    <div className="mt-3 flex flex-col gap-2" data-testid="invite-next">
      <p className="text-sm text-text-mute">{t('invite.ask_new_link')}</p>
      <Link
        to={signedIn ? '/' : '/login'}
        className="rounded-nerv border border-border px-3 py-2 text-center text-sm"
      >
        {t('invite.go_nerv')}
      </Link>
    </div>
  );

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
          {preview.isError && nextStep}

          {invite !== undefined && (
            <>
              {/* 카드와 **같은 문장**이다 — 어디로 부르는지가 문장 안에 있다(REQ-WEB-192) */}
              <p className="text-base leading-[1.45] font-medium tracking-[-0.008em]">
                {invitationSentence(t, invite)}
              </p>
              {/* 이메일은 서버가 가려서 준다 — 토큰을 주운 사람에게 초대받은 사람이
                  누구인지 알려 줄 이유가 없다(EP-INV-04) */}
              <p className="mt-3 text-xs text-text-mute">
                {t('invite.for_email', { email: invite.email_hint })}
              </p>
              {/* **지금 누구로 들어와 있는지** 말한다 — 초대받은 주소는 가려도 내 주소는 가릴 까닭이 없다 */}
              {signedIn && (
                <p data-testid="invite-signed-in-as" className="mt-1 text-xs text-text-mute">
                  {t('invite.signed_in_as', { email: me.data.email })}
                </p>
              )}

              {invite.state !== 'pending' && (
                <>
                  <p data-testid="invite-state" className="mt-3 text-sm text-status-waiting">
                    {t(`invite.${invite.state}` as never)}
                  </p>
                  {invite.state !== 'accepted' && nextStep}
                </>
              )}

              {invite.state === 'pending' && wrongAccount && (
                <div className="mt-4 flex flex-col gap-2" data-testid="invite-wrong-account">
                  <p className="text-sm text-status-waiting">{t('invite.wrong_account')}</p>
                  <Button
                    data-testid="invite-switch-account"
                    className="h-9 w-full"
                    onClick={() => {
                      // 로그아웃한 뒤 **이 링크로 돌아오는** 로그인으로 — 메일에서 링크를 다시 찾지 않게
                      void signOut().then(() => {
                        queryClient.removeQueries({ queryKey: queryKeys.me() });
                        void navigate({ to: '/login', search: { redirect: `/invite/${token}` } });
                      });
                    }}
                  >
                    {t('invite.switch_account')}
                  </Button>
                </div>
              )}

              {invite.state === 'pending' &&
                !wrongAccount &&
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
                        ⚠ {describeApiError(t, accept.error).message}
                      </p>
                    )}
                    <ConfirmAction
                      label={t('invite.decline')}
                      variant="ghost"
                      testId="invite-decline"
                      className="mt-2"
                      message={t('invite.decline_confirm')}
                      confirmLabel={t('invite.decline')}
                      pending={decline.isPending}
                      onConfirm={() => decline.mutate()}
                    />
                    {decline.isError && (
                      <p role="alert" className="mt-2 text-sm text-status-danger">
                        ⚠ {describeApiError(t, decline.error).message}
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
