// / → S1 홈 대시보드 (ui-wireframes §2.1)
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/placeholder-screen.js';

export const Route = createFileRoute('/')({
  component: () => (
    <PlaceholderScreen title="S1 홈 대시보드" story="E08-S02" spec="ui-wireframes §2.1" />
  ),
});
