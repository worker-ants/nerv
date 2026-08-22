// /p/:proj/sessions → S5 세션 모니터. Phase 0 은 읽기 전용 축소판(E05-S03) → Phase 1 에 steer/stop(E08-S06).
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/p/$proj/sessions/')({
  component: () => (
    <PlaceholderScreen title="S5 세션 모니터" story="E05-S03" spec="ui-wireframes §2.5" />
  ),
});
