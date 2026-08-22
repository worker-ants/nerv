// /inbox → S7 승인함. 조직 전역 — 승인함은 하나다(FR-14).
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/placeholder-screen.js';

export const Route = createFileRoute('/inbox')({
  component: () => (
    <PlaceholderScreen title="S7 승인함" story="E08-S07" spec="ui-wireframes §2.7" />
  ),
});
