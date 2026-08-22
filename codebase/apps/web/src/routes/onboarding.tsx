// /onboarding — 인증 필요, 소속 조직 0개일 때만 진입(screens.md §1.2)
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/placeholder-screen.js';

export const Route = createFileRoute('/onboarding')({
  component: () => <PlaceholderScreen title="온보딩" story="E08-S01" spec="screens.md §2.1" />,
});
