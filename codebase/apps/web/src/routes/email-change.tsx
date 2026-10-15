// /email-change — 이메일 바꾸기 링크의 결과 (screens.md §2.1 · 2026-10-15 — 사람 결정 · REQ-WEB-314 · REQ-API-310)
//
// 사람은 이 화면에 **API 를 거쳐** 온다: 메일의 링크는 인증 스택의 `GET /api/auth/verify-email` 이고, 그 자리가 토큰을
// 쓰고 여기로 보낸다 — 옛 주소의 승인이면 `?step=approved`, 새 주소의 확인이면 `?step=done`, 쓸 수 없는 링크면
// `&error=<코드>` 가 붙는다. 이 화면은 아무것도 보내지 않고 **어디까지 왔는지와 다음 할 일**만 보인다.
//
// 링크는 로그인하지 않은 브라우저에서도 열린다(메일함을 다른 기기에서 여는 일이 흔하다). 바뀐 뒤 서버는 그 브라우저에
// 세션을 남기지 않으므로, 로그인한 브라우저면 내 계정으로, 아니면 로그인으로 보낸다.

import { EMAIL_VERIFY_TTL_MINUTES } from '@nerv/schema';
import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useT } from '../lib/i18n.js';
import { useMe } from '../lib/queries.js';
import { AUTH_CARD, AuthFrame } from '../components/auth-frame.js';

type Step = 'approved' | 'done';

export const Route = createFileRoute('/email-change')({
  validateSearch: (search: Record<string, unknown>): { step?: Step; error?: string } => ({
    ...(search['step'] === 'approved' || search['step'] === 'done' ? { step: search['step'] } : {}),
    ...(typeof search['error'] === 'string' && search['error'] !== ''
      ? { error: search['error'] }
      : {}),
  }),
  component: EmailChangeScreen,
});

/** 링크 모양의 단추 — 이 화면의 다음 걸음은 모두 다른 화면이다(새 비밀번호 화면과 같다) */
const NEXT_STEP =
  'rounded-nerv border border-transparent bg-status-action px-3 py-2 text-center text-sm font-medium text-on-status hover:opacity-90';

function EmailChangeScreen(): React.JSX.Element {
  const t = useT();
  const search = useSearch({ from: '/email-change' });
  const me = useMe();
  const signedIn = me.data !== undefined;
  const next = signedIn ? (
    <Link to="/settings/account" data-testid="email-change-to-account" className={NEXT_STEP}>
      {t('email_change.to_account')}
    </Link>
  ) : (
    <Link to="/login" data-testid="email-change-to-login" className={NEXT_STEP}>
      {t('email_change.to_login')}
    </Link>
  );

  // 단계를 모르는 주소도 쓸 수 없는 링크로 다룬다 — 빈 화면을 두지 않는다
  if (search.error !== undefined || search.step === undefined) {
    return (
      <AuthFrame lead={t('email_change.lead')}>
        <div
          data-testid="email-change-invalid"
          data-error={search.error}
          role="alert"
          className={AUTH_CARD}
        >
          <p className="text-base font-semibold">{t('email_change.invalid')}</p>
          <p className="text-sm leading-relaxed text-text-mute">
            {search.error === 'INVALID_USER'
              ? t('email_change.other_account')
              : t('email_change.invalid_body', { minutes: EMAIL_VERIFY_TTL_MINUTES })}
          </p>
          {next}
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame lead={t('email_change.lead')}>
      {search.step === 'approved' ? (
        <div data-testid="email-change-approved" className={AUTH_CARD}>
          <p className="text-base font-semibold">✓ {t('email_change.approved')}</p>
          <p className="text-sm leading-relaxed text-text-mute">
            {t('email_change.approved_body', { minutes: EMAIL_VERIFY_TTL_MINUTES })}
          </p>
          {next}
        </div>
      ) : (
        <div data-testid="email-change-done" className={AUTH_CARD}>
          <p className="text-base font-semibold">✓ {t('email_change.done')}</p>
          <p className="text-sm leading-relaxed text-text-mute">
            {t(signedIn ? 'email_change.done_signed_in' : 'email_change.done_signed_out')}
          </p>
          {next}
        </div>
      )}
    </AuthFrame>
  );
}
