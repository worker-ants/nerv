// L2 통합 — 실제 Postgres 상대. 배치·무게중심 정본: docs/04-mvp/codebase.md §4.3
//
// "L2 가 이 코드베이스의 무게중심이다. NERV 의 핵심 리스크(동시 클레임·게이트 판정)는
//  mock 으로 검증되지 않는다 — 트랜잭션·행 잠금·부분 인덱스가 실제로 동작하는 DB 를
//  상대로만 의미가 있다."
//
// 접속은 DATABASE_URL 하나로 결정된다(로컬 compose 의 postgres · CI 의 서비스 컨테이너).
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
    include: ['test/integration/**/*.spec.ts'],
    // 스키마를 만들고 지우는 테스트라 파일 간 병렬 실행을 막는다.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
