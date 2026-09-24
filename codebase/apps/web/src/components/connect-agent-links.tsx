// 에이전트를 붙이는 길 — 빈 상태가 같이 쓴다 (screens.md §1.5 · REQ-WEB-208)
//
// 세션이 없는 보드와 개요, 스펙이 없는 프로젝트가 "에이전트가 /nerv:next 로 잡으면 여기 나타납니다"
// 만 적고 **붙이는 법으로 잇지 않았다**(2026-09-24 UI/UX 검토 — SET-05 · WORK-06). 설치 장이 절차를,
// 토큰 탭이 발급과 연결 3단계를 갖고 있다 — 두 곳으로 가는 길을 한 모양으로 둔다.

import { Link } from '@tanstack/react-router';
import { useT } from '../lib/i18n.js';

export function ConnectAgentLinks(): React.JSX.Element {
  const t = useT();
  return (
    <span
      data-testid="connect-agent"
      className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm"
    >
      <Link
        to="/help/$chapter"
        params={{ chapter: 'install' }}
        className="text-link hover:underline"
      >
        {t('connect.install_guide')} ▸
      </Link>
      <Link to="/settings/tokens" className="text-link hover:underline">
        {t('connect.issue_token')} ▸
      </Link>
    </span>
  );
}
