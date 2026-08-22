// /p/:proj/specs — 스펙 트리(목록). 스펙 0건이면 빈 상태 + [+ 새 스펙](screens.md §1.2).
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/p/$proj/specs/')({
  component: () => <PlaceholderScreen title="스펙 목록" story="E08-S10" spec="screens.md §2.4" />,
});
