// /login — 비인증 전용. 인증 상태면 / 로 보낸다(screens.md §1.2 가드 열).
// 폼 검증은 react-hook-form + zod, 실제 인증은 better-auth 핸들러(/api/auth/*) — E08-S01.
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../components/placeholder-screen.js';

export const Route = createFileRoute('/login')({
  component: () => <PlaceholderScreen title="로그인" story="E08-S01" spec="screens.md §2.1" />,
});
