// /settings/account — 내 계정: 표시 이름 · 이메일(보기만) · 비밀번호 (2026-09-25 — 사람 결정 D10 · UI/UX 검토 SET-13 ·
// REQ-WEB-229 · REQ-API-186)
//
// 가입할 때 적은 이름은 멤버 표·카드·활동에 그대로 박히는데 고칠 길이 없었고, 사용자 메뉴에도 설정 네 탭에도
// "내 계정" 이 없었다 — 비밀번호를 바꾸려면 서버에 직접 요청을 보낼 줄 알아야 했다. 서버의 문은 둘이다:
// 이름은 `PATCH /api/v1/me`(길이·공백 검사 · 사람만), 비밀번호는 인증 스택의 `/change-password`(지금 비밀번호를
// 맞혀야 한다). 이메일은 로그인 아이디라 바꾸지 않는다 — 그 사실을 칸 옆에서 말한다.

import { DISPLAY_NAME_MAX, PASSWORD_MIN_LENGTH } from '@nerv/schema';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { useMe } from '../../lib/queries.js';
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

export const Route = createFileRoute('/settings/account')({ component: AccountTab });

function AccountTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
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
      <PageHeader title={t('settings.tab.account')} />
      {/* 받아 온 이름이 바뀌면 칸을 새로 만든다 — `useState(name)` 은 첫 렌더의 값을 붙잡는다 */}
      <NameSection key={me.data.display_name} current={me.data.display_name} />
      <div>
        <SectionTitle>{t('account.email')}</SectionTitle>
        <p data-testid="account-email" className="text-sm">
          {me.data.email}
        </p>
        <p className="mt-1 text-xs text-text-mute">{t('account.email_hint')}</p>
      </div>
      <PasswordSection />
    </section>
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
