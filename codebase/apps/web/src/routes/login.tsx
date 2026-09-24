// /login — 로그인 (screens.md §2.1 · REQ-WEB-005·006)
//
// 실패 사유는 **폼 안**에 있고 비밀번호만 초기화한다. 전역 토스트로 알리면 사용자는 방금 친
// 값과 오류를 동시에 볼 수 없고, 이메일까지 지우면 다시 타이핑하게 만든다.

import { useT } from '../lib/i18n.js';
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  authFailureText,
  landingFor,
  primaryMembership,
  resendVerification,
  signIn,
} from '../lib/session.js';
import { fetchMe } from '../lib/session.js';
import { queryKeys } from '../lib/query-keys.js';
import { Button, Field, Input } from '../components/ui/primitives.js';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    ...(typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {}),
  }),
  component: LoginScreen,
});

function LoginScreen(): React.JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/login' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 미확인 계정이면 다시 보낼 길을 준다 — 비밀번호를 다시 치는 것은 답이 아니다 */
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    const failure = await signIn({ email, password });
    if (failure !== null) {
      setError(authFailureText(t, failure));
      // **자격증명 오류와 갈라 둔다**(2026-09-22): 이 사람이 할 일은 메일함을 여는 것이다
      setUnverified(failure.unverified === true);
      setPassword(''); // 비밀번호 필드만 초기화한다(REQ-WEB-005)
      setBusy(false);
      return;
    }

    // 로그인 직후 착지 규칙: 조직 0개면 온보딩, 아니면 역할별 첫 화면(REQ-WEB-006)
    const me = await fetchMe();
    queryClient.setQueryData(queryKeys.me(), me);
    const target =
      search.redirect ??
      (me.memberships.length === 0
        ? '/onboarding'
        : landingFor(
            primaryMembership(me)?.roles ?? ['viewer'],
            primaryMembership(me)?.project_slug ?? null,
          ));
    void navigate({ to: target });
  }

  return (
    // 로그인은 셸 밖이라 화면 전체가 이 폼 하나다 — 가운데에 두고 나머지는 비운다
    <div className="flex min-h-screen items-center justify-center bg-bg-sunken px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight">
            <span aria-hidden="true" className="text-status-action">
              ⬢
            </span>{' '}
            NERV
          </div>
          <p className="mt-1 text-sm text-text-mute">{t('login.tagline')}</p>
        </div>
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-3 rounded-nerv-lg border border-border bg-bg-elev p-6"
        >
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9"
            />
          </Field>
          {error !== null && (
            <p
              data-testid="login-error"
              role="alert"
              className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
            >
              ⚠ {error}
            </p>
          )}
          {/* 미확인 계정에게 비밀번호를 다시 치라고 하는 것은 아무 도움이 안 된다 —
              할 일은 메일함을 여는 것이고, 메일이 없으면 다시 받는 것이다(REQ-WEB-180) */}
          {unverified && (
            <button
              type="button"
              data-testid="login-resend"
              disabled={resent}
              className="rounded-nerv-sm px-2 py-1 text-left text-sm text-link hover:underline disabled:text-text-mute disabled:no-underline"
              onClick={() => {
                setResent(true);
                // 로그인이 들고 온 자리로 — 없으면 첫 화면이고, 거기서 소속을 보고 가른다(REQ-WEB-188)
                void resendVerification(email, search.redirect ?? '/');
              }}
            >
              {resent ? t('auth.resent') : t('auth.resend')}
            </button>
          )}
          <Button type="submit" variant="primary" disabled={busy} className="mt-1 h-9 w-full">
            {busy ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
        {/* **가입 경로가 화면에 있어야 한다.** 계정이 하나도 없는 서버에서 로그인 화면만
            보이면 무엇을 해야 하는지 알 수 없다(사람 보고 2026-08-27) */}
        <p className="mt-4 text-center text-xs">
          <Link to="/signup" data-testid="signup-link" className="text-link hover:underline">
            {t('login.no_account')}
          </Link>
        </p>
        <p className="mt-1 text-center text-xs text-text-faint">{t('login.invite_note')}</p>
      </div>
    </div>
  );
}
