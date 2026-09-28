// /unsubscribe/$token — 메일 요약을 로그인 없이 끈다 (screens.md §2.1 · 2026-09-28 — 사람 결정 EM8 · REQ-WEB-270)
//
// 메일 본문의 링크가 여기로 온다. **여는 것만으로는 끄지 않는다** — 메일 보안 검사기가 링크를 미리 열어 보기
// 때문이다. 사람이 단추를 누르면 API 에 POST 한다. 메일 앱의 [구독 취소] 단추는 이 화면을 거치지 않고 같은
// 주소에 곧바로 POST 한다(RFC 8058 · REQ-API-234).
//
// 링크는 보낸 메일 행에 붙어 있어서 7일 뒤 그 행과 함께 사라진다(REQ-DB-033). 그 뒤에 누르면 만료를 말하고
// 내 계정으로 가는 길을 보여 준다 — 막다른 길을 만들지 않는다(§1.5).

import { NERV_ERROR, SENT_MAIL_RETENTION_DAYS } from '@nerv/schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, NervApiError } from '../lib/api.js';
import { describeApiError } from '../lib/api-errors.js';
import { useT } from '../lib/i18n.js';
import { AUTH_CARD, AuthFrame } from '../components/auth-frame.js';
import { Button } from '../components/ui/primitives.js';

export const Route = createFileRoute('/unsubscribe/$token')({ component: UnsubscribeScreen });

/** 링크 모양의 단추 — 끈 뒤의 다음 걸음은 모두 다른 화면이다 */
const NEXT_STEP = 'rounded-nerv border px-3 py-2 text-center text-sm font-medium';

function UnsubscribeScreen(): React.JSX.Element {
  const t = useT();
  const { token } = Route.useParams();
  const off = useMutation({
    mutationFn: () => apiFetch(`/mail/unsubscribe/${token}`, { method: 'POST' }),
    // 실패는 이 화면이 말한다 — 전역 처리기(토스트)로 보내지 않는다
    onError: () => undefined,
  });
  const expired =
    off.error instanceof NervApiError &&
    off.error.code === NERV_ERROR.PRECONDITION &&
    off.error.body.details['kind'] === 'not_found';

  return (
    <AuthFrame lead={t('unsubscribe.lead')}>
      {off.isSuccess ? (
        <div data-testid="unsubscribe-done" className={AUTH_CARD}>
          <p className="text-base font-semibold">✓ {t('unsubscribe.done')}</p>
          <p className="text-sm leading-relaxed text-text-mute">{t('unsubscribe.done_body')}</p>
          <Link
            to="/settings/account"
            search={{ tab: 'notifications' }}
            data-testid="unsubscribe-to-account"
            className={`${NEXT_STEP} border-border hover:bg-bg-hover`}
          >
            {t('unsubscribe.to_account')}
          </Link>
        </div>
      ) : expired ? (
        <div data-testid="unsubscribe-expired" role="alert" className={AUTH_CARD}>
          <p className="text-base font-semibold">{t('unsubscribe.expired')}</p>
          <p className="text-sm leading-relaxed text-text-mute">
            {t('unsubscribe.expired_body', { days: SENT_MAIL_RETENTION_DAYS })}
          </p>
          <Link
            to="/settings/account"
            search={{ tab: 'notifications' }}
            data-testid="unsubscribe-to-account"
            className={`${NEXT_STEP} border-transparent bg-status-action text-on-status hover:opacity-90`}
          >
            {t('unsubscribe.to_account')}
          </Link>
        </div>
      ) : (
        <div data-testid="unsubscribe-confirm" className={AUTH_CARD}>
          <p className="text-base font-semibold">{t('unsubscribe.title')}</p>
          <p className="text-sm leading-relaxed text-text-mute">{t('unsubscribe.body')}</p>
          {off.isError && (
            <p
              data-testid="unsubscribe-error"
              role="alert"
              className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
            >
              ⚠ {describeApiError(t, off.error).message}
            </p>
          )}
          <Button
            variant="primary"
            data-testid="unsubscribe-submit"
            disabled={off.isPending}
            onClick={() => off.mutate()}
            className="mt-1 h-9 w-full"
          >
            {off.isPending ? t('unsubscribe.submitting') : t('unsubscribe.submit')}
          </Button>
        </div>
      )}
    </AuthFrame>
  );
}
