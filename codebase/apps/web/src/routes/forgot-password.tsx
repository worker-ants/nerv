// /forgot-password — 비밀번호를 잊었을 때 (screens.md §2.1 · 2026-09-25 — 사람 결정 D10 · REQ-WEB-231)
//
// 내 계정의 [비밀번호 바꾸기]는 **지금 비밀번호를 아는 사람**의 문이다. 잊은 사람에게는 길이 없었다 — 로그인
// 화면에 "비밀번호를 잊었나요?" 가 없어서, 같은 주소로 다시 가입할 수도 없는 사람은 누군가에게 DB 를 고쳐 달라고
// 해야 했다(UI/UX 검토 SET-13).
//
// **보냈다와 계정이 없다를 가르지 않는다** — 서버가 같은 답을 하고 화면도 같은 문장으로 말한다. 가르는 것은
// 사람이 할 일이 달라지는 둘뿐이다: 메일이 꺼진 배치(기다려도 오지 않는다 — 운영자에게)와 한도.

import { PASSWORD_RESET_TTL_MINUTES } from '@nerv/schema';
import { createFileRoute, Link, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { authFailureText, requestPasswordReset } from '../lib/session.js';
import { AUTH_CARD, AuthFrame } from '../components/auth-frame.js';
import { Button, Field, Input } from '../components/ui/primitives.js';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordScreen });

function ForgotPasswordScreen(): React.JSX.Element {
  const t = useT();
  // 로그인에서 친 이메일 — 주소가 아니라 히스토리 상태로 온다(`main.tsx` HistoryState)
  const carried = useRouterState({ select: (s) => s.location.state.email });
  const [email, setEmail] = useState(carried ?? '');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'disabled' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await requestPasswordReset(email.trim());
    setBusy(false);
    if (result === 'sent' || result === 'disabled') {
      setOutcome(result);
      return;
    }
    setError(authFailureText(t, result));
  }

  return (
    <AuthFrame lead={t('forgot.lead')}>
      {/* 보낸 뒤에는 **폼을 치운다** — 가입 확인과 같은 까닭이다(REQ-WEB-180): 남겨 두면 무엇을 더 해야 하는 줄 안다 */}
      {outcome === 'sent' ? (
        <div data-testid="forgot-sent" className={AUTH_CARD}>
          <p className="text-base font-semibold">✉ {t('forgot.sent')}</p>
          <p className="text-sm leading-relaxed text-text-mute">
            {t('forgot.sent_body', { email: email.trim(), minutes: PASSWORD_RESET_TTL_MINUTES })}
          </p>
        </div>
      ) : outcome === 'disabled' ? (
        <div data-testid="forgot-disabled" role="alert" className={AUTH_CARD}>
          <p className="text-sm leading-relaxed">{t('forgot.disabled')}</p>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className={AUTH_CARD}>
          <Field label={t('login.email')}>
            <Input
              type="email"
              required
              autoComplete="email"
              data-testid="forgot-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9"
            />
          </Field>
          {error !== null && (
            <p
              data-testid="forgot-error"
              role="alert"
              className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
            >
              ⚠ {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            data-testid="forgot-submit"
            disabled={busy}
            className="mt-1 h-9 w-full"
          >
            {busy ? t('forgot.submitting') : t('forgot.submit')}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-xs">
        <Link to="/login" data-testid="forgot-back" className="text-link hover:underline">
          {t('forgot.back')}
        </Link>
      </p>
    </AuthFrame>
  );
}
