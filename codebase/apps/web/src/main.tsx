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
import { loadRuntimeConfig } from './lib/config.js';
import { RealtimeProvider } from './lib/realtime.js';
import { createQueryClient } from './lib/query-client.js';
import { routeTree } from './routeTree.gen';
import { RouteErrorPage } from './components/route-states.js';
import './styles/tokens.css';

const queryClient = createQueryClient();
// 그리다 멈춘 화면은 **그 라우트 자리에만** 선다 — 셸과 다른 화면으로 가는 길은 남는다(REQ-WEB-199)
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultErrorComponent: RouteErrorPage,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
  /**
   * 주소에 싣지 않고 다음 화면에 넘기는 것 — 로그인에서 친 이메일을 비밀번호 찾기로(2026-09-25 · REQ-WEB-231).
   * `?email=` 로 실으면 방문 기록·접근 로그·공유한 주소에 남는다.
   */
  interface HistoryState {
    email?: string;
  }
}

// 테마를 **그리기 전에** 문서에 적는다 — 첫 페인트가 옳아야 다크 사용자에게 흰 화면이
// 번쩍이지 않는다(§1.7a).
startTheme();

// **설정을 읽고 나서 그린다**(4.1 §2.3 3단계 · lib/config.ts). 그리기 시작하면 첫 화면이
// 곧바로 요청을 보내는데, 그때 API 주소가 아직 기본값이면 그 요청만 다른 곳으로 간다 —
// 같은 오리진 배치에서는 우연히 맞고 호스트를 가른 배치에서만 틀리는, 가장 늦게 발견되는
// 종류의 어긋남이다. 파일이 없으면 폴백이 같은 오리진이므로 개발 루프는 그대로다.
await loadRuntimeConfig();

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
