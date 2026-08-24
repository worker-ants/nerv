// /help → 첫 장으로 (screens.md §1.2)
import { createFileRoute, redirect } from '@tanstack/react-router';
import { FIRST_CHAPTER } from '../../lib/manual.js';

export const Route = createFileRoute('/help/')({
  beforeLoad: () => {
    throw redirect({ to: '/help/$chapter', params: { chapter: FIRST_CHAPTER } });
  },
});
