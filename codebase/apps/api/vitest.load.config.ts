// 부하 시험 — 대상 서버를 따로 두고 부른다 (codebase.md §4.3a · 백로그 E21-S04)
//
// L1 · L2 · L3 어느 레인에도 들지 않는다. 30분 동안 한 번 도는 시험이라 시간 상한을 두지 않는다 —
// 길이는 NERV_LOAD_MINUTES 가 정한다.
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/load/**/*.load.ts'],
    testTimeout: 0,
    hookTimeout: 0,
    pool: 'forks',
  },
});
