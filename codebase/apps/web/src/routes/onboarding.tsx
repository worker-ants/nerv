// /onboarding — 소속 조직 0개일 때만 (screens.md §2.1)
//
// 마지막 단계가 "역할 확인 + 다음 행동"인 것이 이 화면의 요점이다. 가입시켜 놓고 어디로
// 가야 하는지 말해주지 않으면 사람은 첫 화면에서 멈춘다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMe } from '../lib/queries.js';
import { landingFor, primaryMembership } from '../lib/session.js';

export const Route = createFileRoute('/onboarding')({ component: OnboardingScreen });

const ROLE_NOTE: Record<string, string> = {
  admin: '설정·게이트 정책·토큰 관리가 열립니다.',
  planner: '스펙 승인·플랜 검토 요청이 승인함으로 옵니다.',
  designer: '디자인 스펙 초안과 리뷰가 옵니다.',
  developer: '작업 보드에서 ready 작업을 잡아 시작합니다.',
  qa: '작업 보드에서 검증 대상 작업을 봅니다.',
  viewer: '읽기와 코멘트가 가능합니다.',
};

function OnboardingScreen(): React.JSX.Element {
  const me = useMe();
  const membership = me.data === undefined ? null : primaryMembership(me.data);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">시작하기</h1>

      {membership === null ? (
        <section className="rounded-md border border-border bg-bg-elev p-4">
          <h2 className="mb-2 font-medium">① 조직에 참여하기</h2>
          <p className="text-sm text-text-mute">
            아직 소속된 조직이 없습니다. MVP 에서 조직 참여는 기존 사용자 배정이라, 관리자가 당신을
            멤버로 추가하면 이 화면이 다음 단계로 넘어갑니다.
          </p>
          <p className="mt-2 text-sm text-text-mute">
            관리자에게 이 이메일을 알려주세요: <code>{me.data?.email ?? ''}</code>
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-3">
          <section className="rounded-md border border-border bg-bg-elev p-4">
            <h2 className="mb-1 font-medium">② 당신의 역할: {membership.role}</h2>
            <p className="text-sm text-text-mute">
              {ROLE_NOTE[membership.role] ?? '프로젝트를 둘러보세요.'}
            </p>
          </section>
          <section className="rounded-md border border-border bg-bg-elev p-4">
            <h2 className="mb-2 font-medium">③ 다음 행동</h2>
            <Link
              to={landingFor(membership.role, membership.project_slug)}
              className="text-link underline"
            >
              {membership.role === 'developer' || membership.role === 'qa'
                ? '작업 보드로 이동 ▸'
                : '승인함으로 이동 ▸'}
            </Link>
            <div className="mt-2 text-sm text-text-mute">
              에이전트를 연결하려면{' '}
              <Link to="/settings/tokens" className="text-link underline">
                설정 › 에이전트 토큰 ▸
              </Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
