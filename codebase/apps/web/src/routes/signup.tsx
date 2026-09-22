// /signup — 가입 (screens.md §2.1)
//
// **처음 켠 서버의 첫 걸음이다.** 계정이 하나도 없는 서버에서 로그인 화면만 보이면
// 무엇을 해야 하는지 알 수 없다(사람 보고 2026-08-27). 가입한 사람은 온보딩에서 조직을
// 만들고 **그 조직의 admin 이 된다** — 최고 관리자를 따로 세우는 절차를 두지 않는 대신,
// 조직을 만든 사람이 그 조직을 책임진다.
//
// 로그인과 같은 규율: 실패 사유는 **폼 안**에 있고 비밀번호만 초기화한다.

import { useT } from '../lib/i18n.js';
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authFailureText, fetchMe, resendVerification, signIn, signUp } from '../lib/session.js';
import { queryKeys } from '../lib/query-keys.js';
import { Button, Field, Input } from '../components/ui/primitives.js';

export const Route = createFileRoute('/signup')({
  // 초대 링크에서 온 사람은 가입이 끝나면 **그 초대로 돌아간다**(REQ-WEB-089)
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    ...(typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {}),
  }),
  component: SignupScreen,
});

function SignupScreen(): React.JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/signup' });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 확인 메일을 기다리는 상태 — 폼 대신 안내가 선다(2026-09-22) */
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const failure = await signUp({ email, password, name });
    if (failure !== null) {
      setError(authFailureText(t, failure));
      setPassword('');
      setBusy(false);
      return;
    }
    // 가입 직후 바로 들어간다 — 방금 정한 비밀번호를 다시 치게 하지 않는다.
    // better-auth 가 이미 세션을 세웠더라도 한 번 더 부르는 편이 확실하다(멱등이다).
    const entry = await signIn({ email, password });
    // **인증을 강제하는 배치에서는 여기서 막힌다**(2026-09-22 · 사람 결정). 그때는 실패가
    // 아니라 다음 단계다 — 폼을 치우고 "메일을 확인하세요" 를 세운다. 서버가 인증을
    // 강제하지 않으면 이 분기는 한 번도 지나가지 않는다(화면이 설정을 알 필요가 없다).
    if (entry?.unverified === true) {
      setPending(true);
      setBusy(false);
      return;
    }
    queryClient.setQueryData(queryKeys.me(), await fetchMe());
    // 초대에서 왔으면 그 자리로 돌아간다. 아니면 소속이 없으므로 온보딩으로 — 거기서
    // 조직을 만든다.
    void navigate({ to: search.redirect ?? '/onboarding' });
  }

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
          <p className="mt-1 text-sm text-text-mute">{t('signup.lead')}</p>
        </div>
        {/* 확인 메일을 기다리는 동안에는 **폼을 치운다** — 같은 값을 다시 칠 일이 없고,
            남겨 두면 사람은 무엇을 더 해야 하는 줄 안다(2026-09-22 · REQ-WEB-180) */}
        {pending ? (
          <div
            data-testid="signup-check-mail"
            className="flex flex-col gap-3 rounded-nerv-lg border border-border bg-bg-elev p-6"
          >
            <p className="text-base font-semibold">✉ {t('signup.check_mail')}</p>
            <p className="text-sm leading-relaxed text-text-mute">
              {t('signup.check_mail_body', { email })}
            </p>
            <Button
              data-testid="signup-resend"
              disabled={resent}
              className="h-9 w-full"
              onClick={() => {
                setResent(true);
                void resendVerification(email);
              }}
            >
              {resent ? t('auth.resent') : t('auth.resend')}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => void submit(e)}
            className="flex flex-col gap-3 rounded-nerv-lg border border-border bg-bg-elev p-6"
          >
            <Field label={t('signup.name')}>
              <Input
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9"
              />
            </Field>
            <Field label={t('login.email')}>
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9"
              />
            </Field>
            <Field label={t('login.password')}>
              <Input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9"
              />
            </Field>
            {error !== null && (
              <p
                data-testid="signup-error"
                role="alert"
                className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
              >
                ⚠ {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy} className="mt-1 h-9 w-full">
              {busy ? t('signup.submitting') : t('signup.submit')}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-xs">
          <Link to="/login" className="text-link hover:underline">
            {t('signup.have_account')}
          </Link>
        </p>
      </div>
    </div>
  );
}
