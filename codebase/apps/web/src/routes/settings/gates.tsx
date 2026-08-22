// /settings/gates — 스펙 게이트 정책(T0~T3 티어 매핑). policy:edit 은 admin 전용.
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/settings/gates')({
  component: () => (
    <PlaceholderScreen
      title="S8 게이트 정책"
      story="E08-S08"
      spec="api.md §2.1a · ui-wireframes §2.8"
    />
  ),
});
