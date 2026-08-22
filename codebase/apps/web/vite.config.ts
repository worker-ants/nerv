// Vite 설정 — docs/04-mvp/codebase.md §1.1 · §5.1
//
// dev 프록시가 개발 루프(pnpm dev)의 전제다: 웹은 :5173, API 는 :8080 에서 따로 도는데
// 브라우저에는 같은 오리진으로 보여야 세션 쿠키와 /mcp Origin 검증이 성립한다.
// 프록시 대상 5종은 API 의 표면 5종과 1:1 이다(REST · MCP · ingest · WS · SSE).

import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = 'http://localhost:8080';

export default defineConfig({
  plugins: [
    // 파일 기반 라우팅 — 라우트 트리는 src/routes/ 에서 생성된다(screens.md §1.2)
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/mcp': API,
      '/ingest': API,
      '/sse': { target: API, changeOrigin: false },
      // WebSocket 은 /ws 다 — socket.io 어댑터의 path 설정값(api.md §3.1)
      '/ws': { target: API, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
