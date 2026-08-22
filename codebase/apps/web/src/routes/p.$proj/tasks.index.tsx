// /p/:proj/tasks → S4 작업 보드. 쿼리: ?spec= ?assignee= ?ai=1
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/p/$proj/tasks/')({
  component: () => (
    <PlaceholderScreen title="S4 작업 보드" story="E08-S05" spec="ui-wireframes §2.4" />
  ),
});
