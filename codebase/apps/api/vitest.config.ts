// Vitest 설정 — L1 단위(소스 옆 *.spec.ts). 배치 정본: docs/04-mvp/codebase.md §4.3
//
// esbuild 는 emitDecoratorMetadata 를 방출하지 않는다. NestJS 의 생성자 타입 기반 DI 가
// 그 메타데이터에 의존하므로, 테스트 변환기를 swc 로 바꾼다 — 러너는 Vitest 그대로다(§4.3).
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['test/integration/**', 'test/e2e/**'],
  },
});
