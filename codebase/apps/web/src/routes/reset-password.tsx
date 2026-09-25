// /reset-password — 메일의 링크로 새 비밀번호를 정한다 (screens.md §2.1 · 2026-09-25 — 사람 결정 D10 · REQ-WEB-231)
//
// 사람은 이 화면에 **API 를 거쳐** 온다: 메일의 링크는 인증 스택의 `GET /api/auth/reset-password/<토큰>` 이고,
// 그 자리가 토큰이 살아 있는지 보고 여기로 보낸다 — 살아 있으면 `?token=`, 아니면 `?error=INVALID_TOKEN`
// (REQ-API-187). 그래서 만료된 링크를 연 사람은 새 비밀번호를 두 번 치기 **전에** 그 사실을 본다.
//
// 정하고 나면 서버가 이 사람의 **모든** 세션을 끊는다 — 여기서 로그인시키지 않고 로그인으로 보낸다.

import { PASSWORD_MIN_LENGTH, PASSWORD_RESET_TTL_MINUTES } from '@nerv/schema';
import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { authFailureText, resetPassword } from '../lib/session.js';
import { AUTH_CARD, AuthFrame } from '../components/auth-frame.js';
import { Button, Field, Input } from '../components/ui/primitives.js';

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof search['token'] === 'string' && search['token'] !== ''
      ? { token: search['token'] }
      : {}),
    ...(typeof search['error'] === 'string' ? { error: search['error'] } : {}),
  }),
  component: ResetPasswordScreen,
});

/** 링크 모양의 단추 — 이 화면의 다음 걸음은 모두 다른 화면이다 */
const NEXT_STEP = 'rounded-nerv border px-3 py-2 text-center text-sm font-medium';

function ResetPasswordScreen(): React.JSX.Element {
  const t = useT();
  const search = useSearch({ from: '/reset-password' });
  const token = search.error === undefined ? search.token : undefined;
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  /** 서버가 링크를 받지 않았다 — 만료됐거나 이미 썼다 */
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 두 칸이 다르면 **보내기 전에** 말한다 — 서버는 확인 칸을 모른다(내 계정과 같다)
  const mismatch = confirm !== '' && next !== confirm;
  const ready = next.length >= PASSWORD_MIN_LENGTH && next === confirm && !busy;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!ready || token === undefined) return;
    setBusy(true);
    setError(null);
    const result = await resetPassword({ token, next });
    setBusy(false);
    if (result === 'ok') {
      setDone(true);
      return;
    }
    if (result === 'invalid') {
      setRejected(true);
      return;
    }
    setError(authFailureText(t, result));
  }

  return (
    <AuthFrame lead={t('reset.lead')}>
      {done ? (
        <div data-testid="reset-done" className={AUTH_CARD}>
          <p className="text-base font-semibold">✓ {t('reset.done')}</p>
          <p className="text-sm leading-relaxed text-text-mute">{t('reset.done_body')}</p>
          <Link
            to="/login"
            data-testid="reset-to-login"
            className={`${NEXT_STEP} border-transparent bg-status-action text-on-status hover:opacity-90`}
          >
            {t('reset.to_login')}
          </Link>
        </div>
      ) : token === undefined || rejected ? (
        // 비밀번호를 다시 치는 것이 답이 아니다 — 새 링크가 답이다. 막다른 길을 만들지 않는다(§1.5)
        <div data-testid="reset-invalid" role="alert" className={AUTH_CARD}>
          <p className="text-base font-semibold">{t('reset.invalid')}</p>
          <p className="text-sm leading-relaxed text-text-mute">
            {t('reset.invalid_body', { minutes: PASSWORD_RESET_TTL_MINUTES })}
          </p>
          <Link
            to="/forgot-password"
            data-testid="reset-request-again"
            className={`${NEXT_STEP} border-border hover:bg-bg-hover`}
          >
            {t('reset.request_again')}
          </Link>
        </div>
      ) : (
        <form data-testid="reset-form" onSubmit={(e) => void submit(e)} className={AUTH_CARD}>
          <Field
            label={t('account.password_new')}
            hint={t('account.password_hint', { n: PASSWORD_MIN_LENGTH })}
          >
            <Input
              type="password"
              data-testid="reset-new"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="h-9"
            />
          </Field>
          <Field
            label={t('account.password_confirm')}
            error={mismatch ? t('account.password_mismatch') : undefined}
          >
            <Input
              type="password"
              data-testid="reset-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-9"
              aria-invalid={mismatch}
            />
          </Field>
          {error !== null && (
            <p
              data-testid="reset-error"
              role="alert"
              className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
            >
              ⚠ {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            data-testid="reset-submit"
            disabled={!ready}
            className="mt-1 h-9 w-full"
          >
            {busy ? t('reset.submitting') : t('reset.submit')}
          </Button>
        </form>
      )}
      {!done && (
        <p className="mt-4 text-center text-xs">
          <Link to="/login" className="text-link hover:underline">
            {t('forgot.back')}
          </Link>
        </p>
      )}
    </AuthFrame>
  );
}
