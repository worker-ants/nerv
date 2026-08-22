// /notifications — 알림 센터(인앱 피드). MVP 는 인앱만(Slack·메일은 Phase 2).
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/placeholder-screen.js';

export const Route = createFileRoute('/notifications')({
  component: () => <PlaceholderScreen title="알림 센터" story="E13-S03" spec="screens.md §2.9" />,
});
