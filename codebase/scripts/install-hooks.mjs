#!/usr/bin/env node
// pre-push 훅 설치 — **옵트인이다**
//
// `pnpm install` 이 알아서 걸게 하지 않는다. 훅은 사람의 git 동작을 바꾸는 것이라
// 저장소가 몰래 정할 일이 아니고, 무엇보다 **훅은 우회된다**(`--no-verify`).
// 우회되는 것을 게이트라 부르면 그때부터 진짜 게이트가 어디인지 흐려진다 —
// 진짜 게이트는 CI 이고, 이 훅은 **CI 를 기다리기 전에 알려 주는 편의**다.
//
//   pnpm hooks:install     걸기
//   pnpm hooks:install -u  풀기
//
// 훅이 하는 일은 `pnpm preflight` 하나다. 느리면(전수 L1 포함) 그 자리에서
// `git push --no-verify` 로 건너뛸 수 있고, 그래도 CI 가 본다.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const remove = process.argv.includes('-u') || process.argv.includes('--uninstall');

const gitDir = spawnSync('git', ['rev-parse', '--git-dir'], {
  cwd: ROOT,
  encoding: 'utf8',
});
if (gitDir.status !== 0) {
  console.error('git 저장소가 아니다.');
  process.exit(1);
}
const HOOKS = resolve(ROOT, gitDir.stdout.trim(), 'hooks');
const HOOK = join(HOOKS, 'pre-push');

const MARK = '# nerv preflight hook';
const BODY = `#!/bin/sh
${MARK}
# 설치: codebase 에서 \`pnpm hooks:install\` · 제거: \`pnpm hooks:install -u\`
# 건너뛰기: git push --no-verify   (CI 가 어차피 본다)
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0
[ -d codebase ] && cd codebase || exit 0
exec pnpm preflight
`;

if (remove) {
  if (existsSync(HOOK) && readFileSync(HOOK, 'utf8').includes(MARK)) {
    rmSync(HOOK);
    console.log('pre-push 훅을 풀었다.');
  } else {
    console.log('걸린 훅이 없다(또는 이 스크립트가 건 것이 아니다).');
  }
  process.exit(0);
}

if (existsSync(HOOK) && !readFileSync(HOOK, 'utf8').includes(MARK)) {
  console.error(`이미 다른 pre-push 훅이 있다: ${HOOK}`);
  console.error('덮어쓰지 않는다 — 직접 확인하고 합친다.');
  process.exit(1);
}

mkdirSync(HOOKS, { recursive: true });
writeFileSync(HOOK, BODY, 'utf8');
chmodSync(HOOK, 0o755);
console.log(`pre-push 훅을 걸었다: ${HOOK}`);
console.log('push 할 때 pnpm preflight 가 돈다. 건너뛰려면 git push --no-verify.');
