// 웹 SPA 엔트리 — Vite + React. 화면 명세 정본: docs/04-mvp/screens.md
//
// 라우터는 파일 기반(src/routes/)이고 라우트 트리는 @tanstack/router-plugin 이 생성한다(§1.2).
// 서버 상태는 TanStack Query 가 쥐고, WS 이벤트는 그 캐시를 무효화하는 신호로만 쓴다(§1.4).

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient } from './lib/query-client.js';
import { routeTree } from './routeTree.gen';
import './styles/tokens.css';

const queryClient = createQueryClient();
const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('#root 를 찾지 못했습니다.');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
