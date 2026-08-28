// 웹 SPA 엔트리 — Vite + React. 화면 명세 정본: docs/04-mvp/screens.md
//
// 라우터는 파일 기반(src/routes/)이고 라우트 트리는 @tanstack/router-plugin 이 생성한다(§1.2).
// 서버 상태는 TanStack Query 가 쥐고, WS 이벤트는 그 캐시를 무효화하는 신호로만 쓴다(§1.4).

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from './lib/i18n.js';
import { startTheme } from './lib/theme.js';
import { RealtimeProvider } from './lib/realtime.js';
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

// 테마를 **그리기 전에** 문서에 적는다 — 첫 페인트가 옳아야 다크 사용자에게 흰 화면이
// 번쩍이지 않는다(§1.7a).
startTheme();

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    {/* 로케일이 가장 바깥이다 — 실시간 토스트도 번역된 문구를 쓴다 */}
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        {/* 실시간은 쿼리 캐시 위에 얹힌다 — 이벤트는 무효화 신호일 뿐이다(§1.4) */}
        <RealtimeProvider>
          <RouterProvider router={router} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>
  </StrictMode>,
);
