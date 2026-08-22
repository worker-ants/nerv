// Vitest — L1 단위(소스 옆 *.spec.ts / *.spec.tsx). 배치 정본: docs/04-mvp/codebase.md §4.3
// 웹 L3 E2E 는 Playwright 소관이다(apps/web/test/e2e/) — 이 설정의 대상이 아니다.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    exclude: ['test/e2e/**'],
  },
});
