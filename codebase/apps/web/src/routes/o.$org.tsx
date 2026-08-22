// /o/:org — 조직 전환. 화면 없이 컨텍스트만 바꾸고 / 로 리다이렉트한다(screens.md §1.6).
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/o/$org')({
  // 컨텍스트 저장은 E08-S01 이 붙인다. 지금은 리다이렉트 규약만 세운다.
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
