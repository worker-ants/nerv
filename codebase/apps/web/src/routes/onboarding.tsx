// /onboarding — 소속 조직 0개일 때만 (screens.md §2.1)
//
// 마지막 단계가 "역할 확인 + 다음 행동"인 것이 이 화면의 요점이다. 가입시켜 놓고 어디로
// 가야 하는지 말해주지 않으면 사람은 첫 화면에서 멈춘다.

import { useT } from '../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { MessageKey } from '@nerv/schema';
import { useMe } from '../lib/queries.js';
import { canManageScope, landingFor, primaryMembership, rolesInProject } from '../lib/session.js';
import { Card, PageBody, PageHeader } from '../components/ui/primitives.js';
import { InvitationCards } from '../components/invitation-cards.js';
import { StartChecklist } from '../components/start-checklist.js';
import { CreateOrgForm } from '../features/org/create-org-form.js';

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
  /**
   * 그 범위에서의 역할 **전부** — 한 멤버십 행이 아니라 조직 전체 역할까지 합친 것(REQ-WEB-075).
   * 한 행만 보이면 조직 전체 planner 이면서 프로젝트 viewer 인 사람이 viewer 로만 읽힌다.
   */
  const roles =
    membership === null
      ? []
      : rolesInProject(me.data, membership.org_slug, membership.project_slug);
  // 조직을 막 만든 사람(조직 admin)에게는 ③ 이 **시작 체크리스트**다(REQ-WEB-205) — 프로젝트·사람·
  // 에이전트의 세 걸음. 초대로 들어온 사람에게는 그 셋이 자기 일이 아니다
  const isOrgAdmin = membership !== null && canManageScope(me.data, membership.org_slug, null);

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
              {/* **어느 범위의 역할인지** 함께 말한다(REQ-WEB-191) — 역할만 보이면 그것이 조직
                  전체의 것인지 한 프로젝트의 것인지 알 수 없다 */}
              {t('onboarding.step2', {
                role: roles.join(' · '),
                org: membership.org_name,
                scope: membership.project_name ?? t('settings.members.org_wide'),
              })}
            </h2>
            <p className="text-sm text-text-mute">
              {/* 겸직이면 **앞선 역할**의 안내를 보인다 — 여러 문단을 한꺼번에 읽히지 않는다 */}
              {t(ROLE_NOTE_KEY[roles[0] ?? ''] ?? 'onboarding.role.unknown')}
            </p>
          </Card>
          {isOrgAdmin && <StartChecklist orgSlug={membership.org_slug} dismissible={false} />}
          <Card>
            <h2 className="mb-1.5 font-medium">{t('onboarding.step3')}</h2>
            <Link
              to={landingFor(roles, membership.project_slug)}
              className="text-sm text-link hover:underline"
            >
              {/* `membership.role` 은 **없는 필드**였다(멤버십이 나르는 것은 `roles` 배열이다) —
                  문구는 늘 "받은 요청으로" 였는데 링크는 developer 면 작업 보드로 갔다 */}
              {landingFor(roles, membership.project_slug).endsWith('/tasks')
                ? t('onboarding.goto_tasks')
                : t('onboarding.goto_inbox')}
            </Link>
            {/* 조직 admin 은 위 체크리스트가 같은 길을 말한다 — 한 화면에 두 번 적지 않는다 */}
            {!isOrgAdmin && (
              <p className="mt-2 text-sm text-text-mute">
                {t('onboarding.connect_agent')}{' '}
                <Link to="/settings/tokens" className="text-link hover:underline">
                  {t('onboarding.token_link')}
                </Link>
              </p>
            )}
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
  return (
    <Card>
      <h2 className="mb-1.5 font-medium">{t('onboarding.step1')}</h2>
      <p className="text-sm text-text-mute">{t('onboarding.step1_body')}</p>
      {/* **만든 뒤 떠나지 않는다**(2026-09-24 · REQ-WEB-205). 예전에는 `/` 로 보내 ②역할·③다음 행동을
          아무도 보지 못했다 — 정상 흐름에서 그 카드에 닿는 사람이 없었다. me 가 새로 읽히면 이 화면이
          스스로 ②③ 으로 바뀐다 */}
      <CreateOrgForm onCreated={() => undefined} />
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
