// L3 웹 E2E — Playwright (codebase.md §4.3 · backlog.md §5.4)
//
// 브라우저가 필요한 것은 시나리오 D 의 절반뿐이다: "웹 에디터에서 리스를 잡고 있는 동안
// 터미널이 이어쓰면 화면이 read-only 로 바뀐다". 나머지 판정은 API·Event 로그가 한다 —
// 브라우저로 확인할 수 있는 것을 브라우저로만 확인하는 것이 이 계층의 경계다.

import { defineConfig, devices } from '@playwright/test';

// 대상은 **E2E 전용 compose 스택**이다(codebase.md §4.3). 개발 스택과 분리한 이유는 하나다:
// 테스트가 개발 DB 를 고치고 실행 간 상태가 쌓인다. 브라우저가 보는 것이 운영과 같은
// 조립이어야 프록시·SPA 폴백·쿠키 경로까지 함께 검증된다.
//
// 포트는 **세션마다 다르다** — `pnpm e2e:up` 이 잡아서 `NERV_E2E_BASE_URL` 로 넘긴다.
// 아래 기본값은 그 스크립트를 거치지 않고 playwright 를 직접 부를 때의 값이다.
const BASE_URL = process.env['NERV_E2E_BASE_URL'] ?? 'http://localhost:19000';

export default defineConfig({
  testDir: './test/e2e',
  // 로그인은 전역 준비에서 한 번만 한다 — 스위트가 자기 쿼터를 먹지 않게(§1.8)
  globalSetup: './test/e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    // 실패했을 때 무엇을 봤는지 남긴다 — 재현되지 않는 실패가 가장 비싸다
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // webServer 를 두지 않는다 — 스택은 `pnpm compose:up` 이 띄운다. Playwright 가 vite preview 를
  // 대신 띄우면 API 없는 반쪽 화면을 검증하게 되고, 그건 L3 이 아니라 L1 의 확장이다.
});
