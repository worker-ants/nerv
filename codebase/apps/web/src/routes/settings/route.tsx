// /settings — S8 설정 셸. 항목은 범위로 묶인다: 조직(조직 정보 · 멤버·역할 · 조직 전체 토큰) · 프로젝트(프로젝트
// 목록 · 게이트 정책 · 연동 Phase 2) · 나(내 계정 · 에이전트 토큰) — `features/settings/settings-nav.tsx` 가 그 목록의
// 정본이다. git 연동·리뷰 게이트 정책은 Phase 2 다(scope.md §4.1).
//
// **어느 항목에 있는지, 어느 조직의 설정인지 화면에 보여야 한다**(2026-09-25 — 사람 결정 D1 · SET-06 · REQ-WEB-227).
// 상단에 "설정" 한 낱말만 있어서 어느 조직의 것인지 탭마다 제목을 읽어야 알았다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { PageBody } from '../../components/ui/primitives.js';
import { SettingsNav } from '../../features/settings/settings-nav.js';
import { useScope } from '../../lib/scope.js';

export const Route = createFileRoute('/settings')({
  component: SettingsShell,
});

function SettingsShell(): React.JSX.Element {
  const t = useT();
  const { orgName, orgSlug } = useScope();
  const org = orgName ?? orgSlug;
  return (
    <PageBody>
      {/* 제목(h1)은 각 항목이 갖는다 — 여기서 "설정"을 h1 으로 쓰면 화면마다 h1 이 둘이 된다 */}
      <p
        data-testid="settings-heading"
        // 대문자로 바꾸지 않는다 — 이제 조직 **이름**이 들어간다(고유명사의 모양을 화면이 바꾸지 않는다)
        className="mb-2 text-xs font-medium text-text-faint"
      >
        {org === null ? t('settings.title') : t('settings.heading', { org })}
      </p>
      {/* 사이드바가 보이는 폭에서는 셸 사이드바의 [설정] 아래가 이 목록이다(REQ-WEB-225) — 여기서는 좁은 폭의 것만 */}
      <SettingsNav variant="tabs" className="md:hidden" />
      <Outlet />
    </PageBody>
  );
}
