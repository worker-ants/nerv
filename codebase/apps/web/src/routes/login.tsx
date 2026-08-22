// /login — 로그인 (screens.md §2.1 · REQ-WEB-005·006)
//
// 실패 사유는 **폼 안**에 있고 비밀번호만 초기화한다. 전역 토스트로 알리면 사용자는 방금 친
// 값과 오류를 동시에 볼 수 없고, 이메일까지 지우면 다시 타이핑하게 만든다.

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { landingFor, primaryMembership, signIn } from '../lib/session.js';
import { fetchMe } from '../lib/session.js';
import { queryKeys } from '../lib/query-keys.js';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    ...(typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {}),
  }),
  component: LoginScreen,
});

function LoginScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/login' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const failure = await signIn({ email, password });
    if (failure !== null) {
      setError(failure.message);
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
            primaryMembership(me)?.role ?? 'viewer',
            primaryMembership(me)?.project_slug ?? null,
          ));
    void navigate({ to: target });
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center">
      <div className="mb-6 text-center">
        <div className="text-2xl font-semibold">⬢ NERV</div>
        <p className="text-sm text-text-mute">스펙 단일 진실 · 에이전트 협업</p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          이메일
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-border bg-bg-elev px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          비밀번호
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-border bg-bg-elev px-2 py-1"
          />
        </label>
        {error !== null && (
          <p data-testid="login-error" role="alert" className="text-sm text-status-danger">
            ⚠ {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-status-action px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
      <p className="mt-4 text-sm text-text-mute">
        초대 링크로 오셨나요? 로그인하면 초대가 자동으로 수락됩니다.
      </p>
    </div>
  );
}
