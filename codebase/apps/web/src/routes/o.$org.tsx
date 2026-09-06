// /o/:org — 조직 전환. 화면 없이 컨텍스트만 바꾸고 홈으로 보낸다(screens.md §1.6 · :151).
//
// **바꾸는 일이 실제로 있어야 한다.** 2026-09-06 까지 이 라우트는 `<Navigate to="/" />`
// 하나였고 `useScope` 는 `orgs[0]` 고정이었다 — 조직이 둘인 사용자가 헤더에서 두 번째를
// 고르면 홈으로 갔다가 **원래 조직을 다시 보게 됐다.** 아무 일도 없던 것처럼 보이는 전환은
// 고장난 전환보다 나쁘다: 사람은 자기가 잘못 눌렀다고 생각한다.
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { rememberOrg } from '../lib/scope.js';

export const Route = createFileRoute('/o/$org')({ component: OrgSwitch });

function OrgSwitch(): React.JSX.Element {
  const { org } = Route.useParams();
  // 렌더 중에 적는다 — 리다이렉트가 먼저 일어나면 effect 는 돌지 않는다.
  // 쓰기는 멱등이고 부작용이 localStorage 하나뿐이라 안전하다.
  rememberOrg(org);
  return <Navigate to="/" />;
}
