// /settings/tokens — PAT 발급·폐기. 원문은 발급 응답에서 한 번만 보인다(api.md §1.3).
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/settings/tokens')({
  component: () => (
    <PlaceholderScreen title="S8 에이전트 토큰" story="E08-S08" spec="ui-wireframes §2.8" />
  ),
});
