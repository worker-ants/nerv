// /settings/members — 역할 6종(admin·planner·designer·developer·qa·viewer). admin 외 읽기 전용.
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/settings/members')({
  component: () => (
    <PlaceholderScreen title="S8 멤버·역할" story="E08-S08" spec="ui-wireframes §2.8" />
  ),
});
