// Vitest — L1 단위(소스 옆 *.spec.ts). 배치 정본: docs/04-mvp/codebase.md §4.3
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
