// /p/:proj/tasks/:task — 작업 상세(보드 위 오버레이 패널). URL 공유 가능(screens.md §1.2).
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/p/$proj/tasks/$task')({
  component: () => (
    <PlaceholderScreen title="작업 상세 패널" story="E08-S05" spec="screens.md §2.5" />
  ),
});
