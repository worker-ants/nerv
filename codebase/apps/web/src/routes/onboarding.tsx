// /onboarding — 소속 조직 0개일 때만 (screens.md §2.1)
//
// 마지막 단계가 "역할 확인 + 다음 행동"인 것이 이 화면의 요점이다. 가입시켜 놓고 어디로
// 가야 하는지 말해주지 않으면 사람은 첫 화면에서 멈춘다.

import { useT } from '../lib/i18n.js';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { MessageKey } from '@nerv/schema';
import { useMe } from '../lib/queries.js';
import { fetchMe, landingFor, primaryMembership } from '../lib/session.js';
import { apiFetch } from '../lib/api.js';
import { queryKeys } from '../lib/query-keys.js';
import { Button, Card, Field, Input, PageBody, PageHeader } from '../components/ui/primitives.js';
import { InvitationCards } from '../components/invitation-cards.js';

export const Route = createFileRoute('/onboarding')({ component: OnboardingScreen });

const ROLE_NOTE_KEY: Record<string, MessageKey & `onboarding.role.${string}`> = {
  admin: 'onboarding.role.admin',
  planner: 'onboarding.role.planner',
  designer: 'onboarding.role.designer',
  developer: 'onboarding.role.developer',
  qa: 'onboarding.role.qa',
  viewer: 'onboarding.role.viewer',
};

function OnboardingScreen(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const membership = me.data === undefined ? null : primaryMembership(me.data);

  return (
    <PageBody>
      <PageHeader title={t('onboarding.title')} description={t('onboarding.lead')} />

      {/* 소속이 없는 사람에게 초대가 와 있으면 **조직을 만들기 전에** 그것을 보인다 —
          부른 조직이 있는데 새로 만드는 것은 조직을 가르는 일이다 */}
      <InvitationCards />

      {membership === null ? (
        <CreateOrgCard email={me.data?.email ?? ''} />
      ) : (
        <div className="flex flex-col gap-3">
          <Card>
            <h2 className="mb-1 font-medium">
              {t('onboarding.step2', { role: membership.roles.join(' · ') })}
            </h2>
            <p className="text-sm text-text-mute">
              {/* 겸직이면 **앞선 역할**의 안내를 보인다 — 여러 문단을 한꺼번에 읽히지 않는다 */}
              {t(ROLE_NOTE_KEY[membership.roles[0] ?? ''] ?? 'onboarding.role.unknown')}
            </p>
          </Card>
          <Card>
            <h2 className="mb-1.5 font-medium">{t('onboarding.step3')}</h2>
            <Link
              to={landingFor(membership.roles, membership.project_slug)}
              className="text-sm text-link hover:underline"
            >
              {membership.role === 'developer' || membership.role === 'qa'
                ? t('onboarding.goto_tasks')
                : t('onboarding.goto_inbox')}
            </Link>
            <p className="mt-2 text-sm text-text-mute">
              {t('onboarding.connect_agent')}{' '}
              <Link to="/settings/tokens" className="text-link hover:underline">
                {t('onboarding.token_link')}
              </Link>
            </p>
          </Card>
        </div>
      )}
    </PageBody>
  );
}

/**
 * 소속이 없는 사람의 첫 카드 — **조직을 만든다**.
 *
 * 예전에는 "관리자가 추가해 줄 때까지 기다리세요"만 적혀 있었다. 그런데 처음 켠 서버에는
 * 그 관리자가 없다 — 가입한 첫 사람이 이 화면에서 멈췄다(사람 보고 2026-08-27).
 * 조직을 만든 사람이 그 조직의 admin 이 된다(EP-ORG-03).
 *
 * 기다리는 길도 남긴다: 이미 누군가 조직을 쓰고 있다면 **새로 만드는 것이 답이 아니다** —
 * 조직이 갈라지면 스펙도 갈라진다.
 */
function CreateOrgCard({ email }: { email: string }): React.JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  // **이름에서 slug 를 만들어 주되 고칠 수 있게 둔다** — 설정 탭의 프로젝트 폼과 같은
  // 규칙이다. 한글만 적으면 ASCII 규칙에서 빈 값이 나오는데, slug 는 주소와 API 경로의
  // 축(D-09)이라 기계가 뭉갠 값을 조용히 확정해 버리면 나중에 되돌릴 수 없다.
  const onName = (value: string): void => {
    setName(value);
    setSlug(
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
  };

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/orgs', { method: 'POST', body: { slug: slug.trim(), name: name.trim() } }),
    onSuccess: async () => {
      // me 를 다시 읽어야 헤더의 조직 select 가 방금 만든 조직을 안다
      queryClient.setQueryData(queryKeys.me(), await fetchMe());
      void navigate({ to: '/' });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Card>
      <h2 className="mb-1.5 font-medium">{t('onboarding.step1')}</h2>
      <p className="text-sm text-text-mute">{t('onboarding.step1_body')}</p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
      >
        <div className="min-w-56 flex-1">
          <Field label={t('onboarding.step1_org_name')}>
            <Input
              required
              data-testid="org-name"
              value={name}
              onChange={(e) => onName(e.target.value)}
              className="h-9"
            />
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field
            label={t('settings.workspace.project_slug')}
            hint={t('onboarding.step1_slug_hint')}
          >
            <Input
              required
              data-testid="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 font-mono"
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={create.isPending} className="h-9">
          {create.isPending ? t('onboarding.step1_creating') : t('onboarding.step1_create')}
        </Button>
      </form>
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-status-danger">
          ⚠ {error}
        </p>
      )}
      <p className="mt-3 text-xs text-text-faint">{t('onboarding.step1_wait')}</p>
      <p className="mt-1 text-xs text-text-faint">
        {t('onboarding.step1_email')}{' '}
        <code className="rounded-nerv-sm bg-code-bg px-1.5 py-0.5 font-mono text-code-text">
          {email}
        </code>
      </p>
    </Card>
  );
}
