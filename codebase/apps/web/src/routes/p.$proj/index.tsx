// /p/:proj → S2 프로젝트 개요 (ui-wireframes §2.2)
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/p/$proj/')({
  component: () => (
    <PlaceholderScreen title="S2 프로젝트 개요" story="E08-S03" spec="ui-wireframes §2.2" />
  ),
});
