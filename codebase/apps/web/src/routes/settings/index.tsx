// /settings → 멤버·역할 탭으로 리다이렉트(screens.md §1.2)
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/members' });
  },
});
