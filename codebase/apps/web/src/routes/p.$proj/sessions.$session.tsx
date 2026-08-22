// /p/:proj/sessions/:session — 세션 상세(Activity 타임라인)
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/p/$proj/sessions/$session')({
  component: () => (
    <PlaceholderScreen title="세션 상세" story="E05-S03" spec="ui-wireframes §2.5 둘째 그림" />
  ),
});
