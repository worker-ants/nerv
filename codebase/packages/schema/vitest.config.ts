// Vitest — L1 단위(소스 옆 *.spec.ts). 배치 정본: docs/04-mvp/codebase.md §4.3
// include 를 src 로 못박는다 — 그러지 않으면 dist 의 컴파일본까지 집어 같은 테스트를 두 번 돈다.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
