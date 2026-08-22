// L3 E2E — compose 스택 상대 (codebase.md §4.3)
//
// L2 와 갈라놓는 이유: L2 는 도메인 서비스를 직접 부르고, L3 은 **실제 HTTP 서버**를 세워
// 여러 세션이 동시에 부딪히게 한다. 백로그 §5 의 시나리오가 그 형태를 요구한다 —
// "호스트 2대·세션 3개"는 함수 호출로 재현되지 않는다.
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/e2e/**/*.spec.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // 시나리오는 같은 DB 를 쓰므로 순차 실행이다 — 병렬로 돌리면 서로의 클레임을 본다
    fileParallelism: false,
    pool: 'forks',
  },
});
