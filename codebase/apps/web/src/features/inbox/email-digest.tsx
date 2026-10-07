// 알림 메일 요약 — 내 계정 (2026-09-28 · 사람 결정 EM1~EM9 · screens.md REQ-WEB-269 · api.md EP-NTF-07·08)
//
// **켤 때 브라우저의 시간대와 지금 화면 언어를 보낸다**(EM5) — 사람이 따로 입력하지 않고 빈 값이 없다. 이사 ·
// 출장으로 브라우저의 시간대가 달라지면 한 번 눌러 맞출 수 있게 둘을 나란히 보인다. 기본은 꺼짐이다(EM3).
// 메일을 보내지 않는 서버에서는 칸을 잠그고 그 까닭을 말한다 — 켜 두고 기다리게 하지 않는다.

import { LOCALES } from '@nerv/schema';
import type { Locale } from '@nerv/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { LOCALE_LABEL, useLocale, useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import {
  Button,
  Card,
  Field,
  SectionTitle,
  Select,
  Skeleton,
} from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';

interface DigestSetting {
  enabled: boolean;
  hour: number;
  timezone: string | null;
  locale: Locale | null;
  last_sent_at: string | null;
  mail_enabled: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 이 브라우저의 시간대 — 알 수 없으면 UTC */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function EmailDigestSection(): React.JSX.Element | null {
  const t = useT();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const key = [...queryKeys.myNotifications(), 'digest'];
  const setting = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<DigestSetting>('/me/notifications/digest'),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<DigestSetting>('/me/notifications/digest', { method: 'PUT', body }),
    onSuccess: (next, body) => {
      queryClient.setQueryData(key, next);
      pushToast({
        tone: 'ok',
        message:
          body['enabled'] === false
            ? t('account.digest_off_toast')
            : t('account.digest_saved', {
                hour: t('account.digest_hour', { hour: next.hour }),
                timezone: next.timezone ?? '',
              }),
      });
    },
    onError: onApiError,
  });

  const data = setting.data;
  // 늘 보이는 절이다 — 받기 전에 비워 두면 탭이 통째로 빈 채로 열렸다(REQ-WEB-296). 실패는 이유와 [다시 시도]
  if (failedWithoutData(setting)) {
    return <ErrorState error={setting.error} onRetry={() => void setting.refetch()} />;
  }
  if (data === undefined) return <Skeleton rows={3} />;
  const here = browserTimezone();
  const change = (patch: Record<string, unknown>): void => save.mutate({ enabled: true, ...patch });

  return (
    <div data-testid="account-digest">
      <SectionTitle>{t('account.digest')}</SectionTitle>
      <p className="mb-2 text-xs text-text-mute">{t('account.digest_hint')}</p>
      <Card className="flex flex-col gap-3">
        {!data.mail_enabled ? (
          <p data-testid="digest-mail-off" className="text-sm text-text-mute">
            {t('account.digest_off_server')}
          </p>
        ) : !data.enabled ? (
          <div>
            <Button
              data-testid="digest-enable"
              disabled={save.isPending}
              onClick={() => save.mutate({ enabled: true, timezone: here, locale })}
            >
              {t('account.digest_enable')}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('account.digest_time')}>
                <Select
                  data-testid="digest-hour"
                  value={data.hour}
                  disabled={save.isPending}
                  onChange={(e) => change({ hour: Number(e.target.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {t('account.digest_hour', { hour: h })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('account.digest_locale')}>
                <Select
                  data-testid="digest-locale"
                  value={data.locale ?? locale}
                  disabled={save.isPending}
                  onChange={(e) => change({ locale: e.target.value })}
                >
                  {LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {LOCALE_LABEL[code]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p data-testid="digest-timezone" className="text-xs text-text-mute">
              {t('account.digest_timezone', { timezone: data.timezone ?? '' })}
              {data.timezone !== here && (
                <>
                  {' '}
                  {/* 설정을 저장하는 명령이다 — 이동 링크의 모양이 아니라 단추다(사람 결정 A3 · REQ-WEB-272) */}
                  <Button
                    size="xs"
                    variant="subtle"
                    data-testid="digest-use-browser"
                    onClick={() => change({ timezone: here })}
                  >
                    {t('account.digest_use_browser', { timezone: here })}
                  </Button>
                </>
              )}
            </p>
            <div>
              <Button
                variant="subtle"
                data-testid="digest-disable"
                disabled={save.isPending}
                onClick={() => save.mutate({ enabled: false })}
              >
                {t('account.digest_disable')}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
