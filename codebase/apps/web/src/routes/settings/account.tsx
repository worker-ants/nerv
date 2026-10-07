// /settings/account — 내 계정: 표시 이름 · 이메일(보기만) · 비밀번호 (2026-09-25 — 사람 결정 D10 · UI/UX 검토 SET-13 ·
// REQ-WEB-229 · REQ-API-186)
//
// 가입할 때 적은 이름은 멤버 표·카드·활동에 그대로 박히는데 고칠 길이 없었고, 사용자 메뉴에도 설정 네 탭에도
// "내 계정" 이 없었다 — 비밀번호를 바꾸려면 서버에 직접 요청을 보낼 줄 알아야 했다. 서버의 문은 둘이다:
// 이름은 `PATCH /api/v1/me`(길이·공백 검사 · 사람만), 비밀번호는 인증 스택의 `/change-password`(지금 비밀번호를
// 맞혀야 한다). 이메일은 로그인 아이디라 바꾸지 않는다 — 그 사실을 칸 옆에서 말한다.

import { DISPLAY_NAME_MAX, PASSWORD_MIN_LENGTH } from '@nerv/schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { describeUserAgent } from '../../lib/user-agent.js';
import { cn } from '../../lib/utils.js';
import { StatusBadge } from '../../components/status-badge.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { useMe, useNotificationScopes } from '../../lib/queries.js';
import { EmailDigestSection } from '../../features/inbox/email-digest.js';
import { levelOf, NotificationLevelControl } from '../../features/inbox/notification-level.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { authFailureText, changePassword, updateDisplayName } from '../../lib/session.js';
import type { AuthFailure } from '../../lib/session.js';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Skeleton,
} from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';

/**
 * **항목을 탭으로 나눈다**(2026-09-28 · 사람 요청 · REQ-WEB-283). 한 화면에 이름 · 비밀번호 · 메일 요약 ·
 * 프로젝트별 알림이 이어져 원하는 칸을 찾으려면 내려야 했다. 탭은 주소에 남는다(`?tab=devices`) — 링크로
 * 바로 연다. 계정이 기본 탭이라 주소에 적지 않는다.
 */
const ACCOUNT_TABS = ['notifications', 'password', 'devices'] as const;
type AccountTabKey = 'account' | (typeof ACCOUNT_TABS)[number];

export const Route = createFileRoute('/settings/account')({
  validateSearch: (search: Record<string, unknown>): { tab?: (typeof ACCOUNT_TABS)[number] } =>
    (ACCOUNT_TABS as readonly unknown[]).includes(search['tab'])
      ? { tab: search['tab'] as (typeof ACCOUNT_TABS)[number] }
      : {},
  component: AccountTab,
});

function AccountTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { tab } = Route.useSearch();
  const active: AccountTabKey = tab ?? 'account';
  if (me.data === undefined) {
    return (
      <section className="flex max-w-xl flex-col gap-5">
        <PageHeader title={t('settings.tab.account')} />
        <Skeleton rows={4} />
      </section>
    );
  }
  return (
    <section className="flex max-w-xl flex-col gap-8">
      <div>
        <PageHeader title={t('settings.tab.account')} />
        <AccountTabs active={active} />
      </div>
      {active === 'account' && (
        <>
          {/* 받아 온 이름이 바뀌면 칸을 새로 만든다 — `useState(name)` 은 첫 렌더의 값을 붙잡는다 */}
          <NameSection key={me.data.display_name} current={me.data.display_name} />
          <div>
            <SectionTitle>{t('account.email')}</SectionTitle>
            <p data-testid="account-email" className="text-sm">
              {me.data.email}
            </p>
            <p className="mt-1 text-xs text-text-mute">{t('account.email_hint')}</p>
          </div>
        </>
      )}
      {active === 'notifications' && (
        <>
          <EmailDigestSection />
          <NotificationLevelsSection />
        </>
      )}
      {active === 'password' && <PasswordSection />}
      {active === 'devices' && <DevicesSection />}
    </section>
  );
}

/** 탭 줄의 링크 — 멤버 · 초대 탭과 같은 모양이다(REQ-WEB-242) */
const TAB =
  'flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2 text-sm whitespace-nowrap transition-colors';

/**
 * 내 계정 탭(REQ-WEB-283). **주소가 바뀌는 탭이라 링크다** — 지금 탭은 `aria-current` 로 알린다. 계정 탭은
 * 빈 쿼리라 `exact` 로 쿼리까지 비교한다(그러지 않으면 다른 탭에서도 계정이 켜진다).
 */
function AccountTabs({ active }: { active: AccountTabKey }): React.JSX.Element {
  const t = useT();
  const items: { key: AccountTabKey; label: string }[] = [
    { key: 'account', label: t('account.tab.account') },
    { key: 'notifications', label: t('account.tab.notifications') },
    { key: 'password', label: t('account.tab.password') },
    { key: 'devices', label: t('account.tab.devices') },
  ];
  return (
    <nav aria-label={t('account.tabs_label')} className="flex gap-5 border-b border-border">
      {items.map((item) => (
        <Link
          key={item.key}
          to="/settings/account"
          search={item.key === 'account' ? {} : { tab: item.key }}
          activeOptions={{ exact: true }}
          aria-current={item.key === active ? 'page' : undefined}
          data-testid={`account-tab-${item.key}`}
          className={cn(
            TAB,
            item.key === active
              ? 'border-status-action font-medium text-text'
              : 'border-transparent text-text-mute hover:text-text',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

interface AuthSessionRow {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string;
  current: boolean;
}

/**
 * **로그인된 기기**(2026-09-28 · 사람 요청 · REQ-WEB-284 · EP-AUTH-03~05). 로그인마다 한 줄 — 브라우저 · 운영체제 ·
 * 접속 주소 · 로그인 시각 · 마지막 사용. 지금 쓰는 기기는 표시하고 끊는 단추를 두지 않는다(로그아웃이 그 일을
 * 한다). 잃어버린 기기 하나만 끊을 수 있게 줄마다 [끊기]를, 맨 위에 [다른 기기 로그인 모두 끊기]를 둔다.
 */
function DevicesSection(): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const sessions = useQuery({
    queryKey: queryKeys.mySessions(),
    queryFn: () => apiFetch<{ items: AuthSessionRow[] }>('/me/sessions'),
  });
  const refresh = (): void =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.mySessions() });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      pushToast({ tone: 'ok', message: t('account.devices.revoked') });
    },
    onError: onApiError,
  });
  const revokeOthers = useMutation({
    mutationFn: () =>
      apiFetch<{ revoked: number }>('/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: (result) => {
      refresh();
      pushToast({
        tone: 'ok',
        message: t('account.devices.revoked_others', { n: result.revoked }),
      });
    },
    onError: onApiError,
  });
  const items = sessions.data?.items ?? [];
  const others = items.filter((s) => !s.current).length;
  const deviceName = (ua: string | null): string => {
    const { browser, os } = describeUserAgent(ua);
    if (browser === null && os === null) return t('account.devices.unknown');
    return [browser, os].filter((v): v is string => v !== null).join(' · ');
  };

  return (
    <div data-testid="account-devices" className="flex flex-col gap-3">
      <div>
        <SectionTitle>{t('account.devices')}</SectionTitle>
        <p className="text-xs text-text-mute">{t('account.devices_hint')}</p>
      </div>
      <div>
        <ConfirmAction
          label={t('account.devices.revoke_others')}
          variant="danger"
          testId="account-devices-revoke-others"
          disabled={sessions.data === undefined || others === 0 || revokeOthers.isPending}
          // 받기 전에는 "끊을 다른 기기가 없다" 가 아니다(REQ-WEB-293)
          title={
            sessions.data === undefined
              ? t('common.loading')
              : others === 0
                ? t('account.devices.none_other')
                : undefined
          }
          message={t('account.devices.revoke_others_confirm', { n: others })}
          detail={t('account.devices.revoke_others_detail')}
          confirmLabel={t('account.devices.revoke_others_run')}
          pending={revokeOthers.isPending}
          onConfirm={() => revokeOthers.mutate()}
        />
      </div>
      {failedWithoutData(sessions) ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.data === undefined ? (
        <Skeleton rows={3} />
      ) : (
        <Card className="flex flex-col divide-y divide-border p-0">
          {items.map((s) => (
            <div
              key={s.id}
              data-testid="account-device"
              data-current={s.current || undefined}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {deviceName(s.user_agent)}
                  {s.current && (
                    <StatusBadge token="ok" size="sm" label={t('account.devices.this_device')} />
                  )}
                </p>
                <p className="text-xs text-text-mute">
                  {t('account.devices.meta', {
                    ip: s.ip_address ?? t('account.devices.ip_unknown'),
                    signed_in: relativeTime(t, s.created_at),
                    last_used: relativeTime(t, s.last_active_at),
                  })}
                </p>
              </div>
              {!s.current && (
                <ConfirmAction
                  label={t('account.devices.revoke')}
                  variant="danger"
                  size="sm"
                  testId="account-device-revoke"
                  testIdBase={`account-device-revoke-${s.id}`}
                  message={t('account.devices.revoke_confirm', {
                    device: deviceName(s.user_agent),
                  })}
                  confirmLabel={t('account.devices.revoke_run')}
                  pending={revoke.isPending}
                  onConfirm={() => revoke.mutate(s.id)}
                />
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/**
 * **프로젝트별 알림**(2026-09-27 · 사람 결정 N3 · REQ-WEB-260). 알림 센터에서 한 프로젝트로 좁혔을 때도
 * 고를 수 있지만, 여러 프로젝트를 한 번에 보고 고르는 자리는 여기다. 내가 속한 프로젝트가 없으면 그리지
 * 않는다(초대만 받은 사람).
 */
function NotificationLevelsSection(): React.JSX.Element | null {
  const t = useT();
  const scopes = useNotificationScopes();
  const rows = scopes.data?.items ?? [];
  // 받기 전에는 자리를 잡는다 — 프로젝트가 있는 사람에게는 늘 보이는 절이다(REQ-WEB-296)
  if (scopes.isPending) return <Skeleton rows={3} />;
  if (failedWithoutData(scopes)) {
    return <ErrorState error={scopes.error} onRetry={() => void scopes.refetch()} />;
  }
  if (rows.length === 0) return null;
  const multiOrg = new Set(rows.map((r) => r.org_slug)).size > 1;
  return (
    <div data-testid="account-notifications">
      <SectionTitle>{t('account.notifications')}</SectionTitle>
      <p className="mb-2 text-xs text-text-mute">{t('account.notifications_hint')}</p>
      <Card className="flex flex-col divide-y divide-border p-0">
        {rows.map((r) => {
          const name = multiOrg ? `${r.org_name} / ${r.project_name}` : r.project_name;
          return (
            <div
              key={`${r.org_slug}/${r.project_slug}`}
              data-testid={`account-notification-${r.org_slug}-${r.project_slug}`}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
            >
              <span className="min-w-0 truncate text-sm">{name}</span>
              <NotificationLevelControl
                org={r.org_slug}
                project={r.project_slug}
                scope={name}
                level={levelOf(r.level)}
                testIdPrefix={`account-level-${r.org_slug}-${r.project_slug}`}
              />
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function NameSection({ current }: { current: string }): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const [name, setName] = useState(current);
  const trimmed = name.trim();
  const save = useMutation({
    mutationFn: () => updateDisplayName(trimmed),
    onSuccess: (next) => {
      // 셸의 사용자 메뉴·멤버 표가 같은 캐시를 읽는다 — 새로 받아 올 것 없이 바로 바뀐다
      queryClient.setQueryData(queryKeys.me(), next);
      pushToast({ tone: 'ok', message: t('account.name_saved') });
    },
    onError: onApiError,
  });
  const unchanged = trimmed === current;
  return (
    <form
      data-testid="account-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!unchanged && trimmed !== '') save.mutate();
      }}
    >
      {/* 구역 제목을 따로 두지 않는다 — 칸의 이름이 곧 그 구역의 이름이라 같은 글자가 두 번 선다 */}
      <Field label={t('account.name')} hint={t('account.name_hint')}>
        <div className="flex gap-2">
          <Input
            data-testid="account-name"
            value={name}
            maxLength={DISPLAY_NAME_MAX}
            required
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          {/* 바뀐 것이 없거나 비었으면 **숨기지 않고 끈다** — 무엇이 막는지는 칸이 보인다(REQ-WEB-003) */}
          <Button
            type="submit"
            data-testid="account-name-save"
            disabled={unchanged || trimmed === '' || save.isPending}
          >
            {t('common.save')}
          </Button>
        </div>
      </Field>
    </form>
  );
}

function PasswordSection(): React.JSX.Element {
  const t = useT();
  const { pushToast } = useRealtime();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  // 두 칸이 다르면 **보내기 전에** 말한다 — 서버는 확인 칸을 모른다
  const mismatch = confirm !== '' && next !== confirm;
  const ready = current !== '' && next.length >= PASSWORD_MIN_LENGTH && next === confirm && !busy;

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    const result = await changePassword({ current, next, revokeOthers });
    setBusy(false);
    if (result !== null) {
      setFailure(result);
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    pushToast({
      tone: 'ok',
      message: t(revokeOthers ? 'account.password_changed_revoked' : 'account.password_changed'),
    });
  };

  return (
    <form data-testid="account-password-form" onSubmit={(e) => void submit(e)}>
      <SectionTitle>{t('account.password')}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <Field label={t('account.password_current')}>
          <Input
            type="password"
            data-testid="account-password-current"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="max-w-xs"
          />
        </Field>
        <Field
          label={t('account.password_new')}
          hint={t('account.password_hint', { n: PASSWORD_MIN_LENGTH })}
        >
          <Input
            type="password"
            data-testid="account-password-new"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="max-w-xs"
          />
        </Field>
        <Field label={t('account.password_confirm')}>
          <Input
            type="password"
            data-testid="account-password-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="max-w-xs"
            aria-invalid={mismatch}
          />
        </Field>
        {mismatch && (
          <p data-testid="account-password-mismatch" className="text-sm text-status-danger">
            {t('account.password_mismatch')}
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="account-revoke-others"
            checked={revokeOthers}
            onChange={(e) => setRevokeOthers(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t('account.revoke_others')}
            <span className="block text-xs text-text-mute">{t('account.revoke_others_hint')}</span>
          </span>
        </label>
        {failure !== null && (
          <p
            data-testid="account-password-error"
            role="alert"
            className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
          >
            ⚠ {authFailureText(t, failure)}
          </p>
        )}
        <div>
          <Button
            type="submit"
            variant="primary"
            data-testid="account-password-submit"
            disabled={!ready}
          >
            {t('account.password_submit')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
