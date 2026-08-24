// /onboarding — 소속 조직 0개일 때만 (screens.md §2.1)
//
// 마지막 단계가 "역할 확인 + 다음 행동"인 것이 이 화면의 요점이다. 가입시켜 놓고 어디로
// 가야 하는지 말해주지 않으면 사람은 첫 화면에서 멈춘다.

import { useT } from '../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { MessageKey } from '@nerv/schema';
import { useMe } from '../lib/queries.js';
import { landingFor, primaryMembership } from '../lib/session.js';
import { Card, PageBody, PageHeader } from '../components/ui/primitives.js';

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

      {membership === null ? (
        <Card>
          <h2 className="mb-1.5 font-medium">{t('onboarding.step1')}</h2>
          <p className="text-sm text-text-mute">{t('onboarding.step1_body')}</p>
          <p className="mt-2 text-sm text-text-mute">
            {t('onboarding.step1_email')}{' '}
            <code className="rounded-nerv-sm bg-code-bg px-1.5 py-0.5 font-mono text-code-text">
              {me.data?.email ?? ''}
            </code>
          </p>
        </Card>
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
