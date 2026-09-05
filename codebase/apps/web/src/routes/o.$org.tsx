// /o/:org — 조직 전환. 화면 없이 컨텍스트만 바꾸고 홈으로 보낸다(screens.md §1.6).
import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/o/$org')({ component: OrgSwitch });

function OrgSwitch(): React.JSX.Element {
  // MVP 는 사용자 1인당 조직이 사실상 하나라 전환은 즉시 리다이렉트다.
  // 조직 소속을 로컬에 기억시키는 것은 다중 조직 요구가 실제로 생길 때 넣는다.
  return <Navigate to="/" />;
}
