#!/usr/bin/env node
// 개발 루프 런처 — 정본: docs/04-mvp/codebase.md §5.1
//
// `pnpm dev` 하나로 세 가지가 함께 돌아야 한다:
//   ① TypeScript 빌드 감시 — 저장소 루트 tsconfig 의 참조(schema → api → cli)를 전부 본다
//   ② API — 빌드 산출물을 감시하며 재시작. `.env` 를 **자기가 읽는다**
//   ③ 웹 — Vite (:5173, /api·/ws 를 API 로 프록시)
//
// 셋을 `pnpm --parallel -r dev` 로 묶을 수 없었던 이유가 이 파일의 존재 이유다:
//   - 워크스페이스별 dev 스크립트는 **자기 패키지만** 빌드한다. `tsc -b --watch` 는 의존을
//     따라 올라가지 소비자를 따라 내려가지 않아서, schema 감시로는 api 가 다시 빌드되지 않는다.
//     소스를 고쳐도 dist 가 그대로라 `node --watch` 가 아무것도 못 본다(실측).
//   - API 는 dist 가 **생긴 뒤에** 떠야 한다. 빈 체크아웃에서 순서가 없으면 첫 실행이 실패한다.
//
// compose 스택과 달리 여기서는 env 를 넣어 주는 오케스트레이터가 없다 —
// `.env` 를 읽는 책임이 프로세스 자신에게 있다.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const API_ENTRY = join(ROOT, 'apps/api/dist/main.js');

const WITH_WORKER = process.argv.includes('--worker');

if (!existsSync(ENV_FILE)) {
  // 여기서 멈추는 편이 낫다 — 그냥 띄우면 API 가 DATABASE_URL 없다고 죽고,
  // 그 메시지만 보면 원인이 "설정이 없다"인지 "설정을 안 읽었다"인지 알 수 없다
  process.stderr.write(
    `.env 가 없습니다: ${ENV_FILE}\n` +
      '  cp .env.example .env  후 필수 3개(POSTGRES_PASSWORD · MINIO_ROOT_PASSWORD · NERV_AUTH_SECRET)를 채우세요.\n' +
      '  전표 정본: docs/04-mvp/codebase.md §5.2\n',
  );
  process.exit(1);
}

const children = [];

/** 한 줄씩 접두사를 붙인다 — 세 프로세스의 출력이 섞이면 어느 것이 죽었는지 못 읽는다 */
function run(label, command, args, options = {}) {
  const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${label} ${line}\n`);
    });
  }
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(`${label} 종료 (code=${code ?? 'null'} signal=${signal ?? 'null'})\n`);
    // 하나가 죽으면 전부 내린다 — 반쯤 살아 있는 루프가 가장 헷갈린다
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));

/** dist/main.js 가 생길 때까지 기다린다 — 첫 빌드는 수 초 걸린다 */
async function waitForBuild(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(API_ENTRY)) return true;
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

// ① 빌드 감시 — 루트에서 돌아야 참조 전체(schema·api·cli)를 본다
run('[build]', 'node', [
  join(ROOT, 'node_modules/typescript/bin/tsc'),
  '-b',
  '--watch',
  '--preserveWatchOutput',
]);

// ③ 웹은 빌드를 기다릴 이유가 없다 — Vite 가 소스를 직접 읽는다.
//    `.bin` 항목은 JS 가 아니라 **셔뱅 달린 셸 shim** 이라 node 로 열면 안 된다(실측:
//    `SyntaxError: missing ) after argument list`) — 실행 파일로 그대로 띄운다.
run('[web]  ', join(ROOT, 'node_modules/.bin/vite'), [], { cwd: join(ROOT, 'apps/web') });

if (!(await waitForBuild())) {
  process.stderr.write('[dev] 첫 빌드가 끝나지 않았습니다 — 위의 [build] 오류를 보세요.\n');
  shutdown(1);
} else {
  // ② `--env-file-if-exists` 인 이유: 파일이 없으면 위에서 이미 멈춘다. 여기서 하드 실패하면
  //    노드의 ENOENT 가 앱 자신의 안내 메시지를 덮어쓴다
  run('[api]  ', 'node', ['--env-file-if-exists=.env', '--watch', 'apps/api/dist/main.js']);
  if (WITH_WORKER) {
    run('[worker]', 'node', ['--env-file-if-exists=.env', '--watch', 'apps/api/dist/worker.js']);
  }
}
