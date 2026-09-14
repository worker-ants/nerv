// Vite 설정 — docs/04-mvp/codebase.md §1.1 · §5.1
//
// dev 프록시가 개발 루프(pnpm dev)의 전제다: 웹과 API 가 다른 포트에서 따로 도는데
// 브라우저에는 같은 오리진으로 보여야 세션 쿠키와 /mcp Origin 검증이 성립한다.
// 프록시 대상 5종은 API 의 표면 5종과 1:1 이다(REST · MCP · ingest · WS · SSE).
//
// **두 포트는 env 가 정한다**(REQ-CB-038 · 전표 §5.2). 전에는 여기 숫자가 박혀 있어서
// `NERV_API_PORT` 를 바꾸면 API 만 옮겨 가고 프록시는 옛 포트를 계속 찔렀다 — 손잡이가
// 있는데 듣지 않는 상태였다. 기본값은 **개발 루프의 값**이다(화면 5173 · API 8080):
// compose 경로의 값(둘 다 8080)을 그대로 쓰면 Vite 가 api 와 같은 포트를 잡으므로,
// `pnpm dev` 가 그 충돌을 먼저 막는다.
//
// `codebase/.env` 는 **Vite 가 스스로 읽지 않는다** — `scripts/dev.mjs` 가 읽어 이 프로세스에
// 얹어 준다. 그래서 `pnpm --filter @nerv/web dev` 로 직접 띄우면 기본값으로 돈다.

import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** 양의 정수만 받는다 — compose 의 `${VAR:-}` 가 빈 문자열을 넘기는 자리가 있다. */
function port(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  const value = Number(raw);
  return raw === '' || !Number.isInteger(value) || value <= 0 ? fallback : value;
}

const WEB_PORT = port('NERV_WEB_PORT', 5173);
const API = `http://localhost:${port('NERV_API_PORT', 8080)}`;

export default defineConfig({
  plugins: [
    // 파일 기반 라우팅 — 라우트 트리는 src/routes/ 에서 생성된다(screens.md §1.2)
    //
    // **테스트는 라우트가 아니다.** 화면 테스트는 그 화면 옆에 두는 것이 이 저장소의 관례라
    // `src/routes/` 안에 `*.spec.tsx` 가 함께 사는데, 플러그인은 그것을 "Route 를 export
    // 하지 않는 라우트 파일"로 보고 파일마다 12줄짜리 경고를 찍는다(기동 로그 실측: 7개
    // 파일 84줄). 경고가 기동 로그의 대부분이 되면 진짜 경고가 그 속에 묻힌다.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.spec\\.tsx?$',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: WEB_PORT,
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
