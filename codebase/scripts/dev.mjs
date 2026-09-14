#!/usr/bin/env node
// 개발 루프 런처 — 정본: docs/04-mvp/codebase.md §5.1
//
// `pnpm dev` 하나로 세 가지가 함께 돌아야 한다:
//   ① TypeScript 빌드 감시 — 저장소 루트 tsconfig 의 참조(schema → api → cli)를 전부 본다
//   ② API — 빌드 산출물을 감시하며 재시작. `.env` 를 **자기가 읽는다**
//   ③ 웹 — Vite (:5173, /api·/ws 를 API 로 프록시)
//
// **구성요소를 따로 띄울 수도 있다**(`--only api,web,worker` · `pnpm dev:api` 등).
// 별칭이 아니라 여기를 거치게 한 이유가 ①이다: 워크스페이스의 `dev` 를 직접 부르면
// (`pnpm --filter @nerv/api dev`) 빌드 감시 없이 `dist` 만 보므로 소스를 고쳐도
// 아무 일이 일어나지 않는다 — 이 파일이 존재하는 바로 그 함정에 다시 걸린다.
//
// 셋을 `pnpm --parallel -r dev` 로 묶을 수 없었던 이유가 이 파일의 존재 이유다:
//   - 워크스페이스별 dev 스크립트는 **자기 패키지만** 빌드한다. `tsc -b --watch` 는 의존을
//     따라 올라가지 소비자를 따라 내려가지 않아서, schema 감시로는 api 가 다시 빌드되지 않는다.
//     소스를 고쳐도 dist 가 그대로라 `node --watch` 가 아무것도 못 본다(실측).
//   - API 는 dist 가 **생긴 뒤에** 떠야 한다. 빈 체크아웃에서 순서가 없으면 첫 실행이 실패한다.
//
// compose 스택과 달리 여기서는 env 를 넣어 주는 오케스트레이터가 없다 —
// `.env` 를 읽는 책임이 프로세스 자신에게 있다. 노드 엔트리는 `--env-file-if-exists` 로
// 스스로 읽지만 **Vite 는 `codebase/.env` 를 읽지 않는다**(자기 앱 폴더의 `VITE_*` 만 본다).
// 그래서 이 런처가 `.env` 를 읽어 자식에게 넘긴다 — 넘기지 않으면 `NERV_WEB_PORT`·
// `NERV_API_PORT` 가 전표에 있는데 개발 루프에서만 듣지 않는 손잡이가 된다(REQ-CB-038).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const API_ENTRY = join(ROOT, 'apps/api/dist/main.js');

/**
 * 무엇을 띄울지 고른다. `--only api,web` · `--only worker` · (없으면) api + web.
 * `--worker` 는 기본 묶음에 워커를 더하는 예전 플래그다.
 */
const ONLY = (() => {
  const flag = process.argv.indexOf('--only');
  const picked =
    flag === -1
      ? ['api', 'web']
      : (process.argv[flag + 1] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
  if (flag !== -1 && picked.length === 0) {
    process.stderr.write('--only 에 무엇을 띄울지 적으세요: api · web · worker\n');
    process.exit(1);
  }
  const unknown = picked.filter((s) => !['api', 'web', 'worker'].includes(s));
  if (unknown.length > 0) {
    process.stderr.write(`모르는 구성요소: ${unknown.join(', ')} (api · web · worker)\n`);
    process.exit(1);
  }
  if (process.argv.includes('--worker') && !picked.includes('worker')) picked.push('worker');
  return new Set(picked);
})();

const WITH_WORKER = ONLY.has('worker');
// 웹은 Vite 가 소스를 직접 읽으므로 빌드 감시가 필요 없다 — 노드 프로세스만 dist 를 본다.
const NEEDS_BUILD = ONLY.has('api') || ONLY.has('worker');

// 웹만 띄울 때는 `.env` 가 필요 없다 — Vite 는 자기 설정을 읽고, API 는 프록시 건너편에 있다
// (컨테이너로 돌든 다른 터미널에서 돌든). 여기서 막으면 되는 일을 못 하게 막는 것이다.
if (NEEDS_BUILD && !existsSync(ENV_FILE)) {
  // 여기서 멈추는 편이 낫다 — 그냥 띄우면 API 가 DATABASE_URL 없다고 죽고,
  // 그 메시지만 보면 원인이 "설정이 없다"인지 "설정을 안 읽었다"인지 알 수 없다
  process.stderr.write(
    `.env 가 없습니다: ${ENV_FILE}\n` +
      '  cp .env.example .env  후 필수 3개(POSTGRES_PASSWORD · MINIO_ROOT_PASSWORD · NERV_AUTH_SECRET)를 채우세요.\n' +
      '  전표 정본: docs/04-mvp/codebase.md §5.2\n',
  );
  process.exit(1);
}

/**
 * `.env` 를 읽어 **비어 있는 자리에만** 얹는다 — 셸에 이미 있는 값이 이긴다.
 * `node --env-file-if-exists` 와 같은 우선순위여서 자식 둘이 같은 값을 본다.
 */
function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m === null) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnvFile();

/** 양의 정수만 받는다 — compose 의 `${VAR:-}` 가 빈 문자열을 넘기는 자리가 있다. */
function port(name, fallback) {
  const raw = (process.env[name] ?? '').trim();
  const value = Number(raw);
  return raw === '' || !Number.isInteger(value) || value <= 0 ? fallback : value;
}

// 개발 루프의 기본값이다 — compose 경로는 둘 다 8080 이고, 그 값을 그대로 쓰면 아래가 막는다.
const WEB_PORT = port('NERV_WEB_PORT', 5173);
const API_PORT = port('NERV_API_PORT', 8080);

// **같은 포트면 먼저 멈춘다.** `.env` 하나가 compose 와 개발 루프를 함께 섬기므로, compose
// 값(NERV_WEB_PORT=8080)이 든 `.env` 로 `pnpm dev` 를 돌리면 Vite 가 api 와 부딪힌다.
// 그냥 띄우면 사람이 받는 것은 원인을 가리키지 않는 EADDRINUSE 이거나, 먼저 뜬 쪽만
// 살아 있는 반쪽 루프다(이 파일이 막으려는 바로 그 상태다 — 위 ④).
if (ONLY.has('api') && ONLY.has('web') && WEB_PORT === API_PORT) {
  process.stderr.write(
    `화면과 API 가 같은 포트(:${WEB_PORT})를 잡으려 합니다 — 개발 루프에서는 둘이 달라야 합니다.\n` +
      `  NERV_WEB_PORT=${WEB_PORT} · NERV_API_PORT=${API_PORT}\n` +
      '  .env 의 NERV_WEB_PORT 를 개발 루프 값(5173)으로 두거나 지우세요.\n' +
      '  compose 경로의 값(둘 다 8080)은 앞문이 화면과 API 를 함께 서빙하기 때문입니다.\n' +
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
if (NEEDS_BUILD) {
  run('[build]', 'node', [
    join(ROOT, 'node_modules/typescript/bin/tsc'),
    '-b',
    '--watch',
    '--preserveWatchOutput',
  ]);
}

// ③ 웹은 빌드를 기다릴 이유가 없다 — Vite 가 소스를 직접 읽는다.
//    `.bin` 항목은 JS 가 아니라 **셔뱅 달린 셸 shim** 이라 node 로 열면 안 된다(실측:
//    `SyntaxError: missing ) after argument list`) — 실행 파일로 그대로 띄운다.
//
//    **shim 은 `apps/web` 의 것을 쓴다**(2026-09-14 정정). `vite` 는 `apps/web` 의 의존이고
//    이 저장소에는 호이스팅 설정이 없으므로 pnpm 은 **루트 `.bin` 에 `vite` 를 만들지 않는다** —
//    전에 여기 있던 루트 경로는 옛 레이아웃이 남긴 고아 파일을 가리키고 있었고, `pnpm install`
//    은 그 파일을 관리하지도 지우지도 않는다. 그래서 두 가지가 조용히 성립했다: 새로 클론한
//    장비에서는 처음부터 없고, 있던 장비에서도 **store 의 peer 해시가 바뀌는 순간 죽는다**
//    (루트 devDependency 를 하나 더한 날 `vite@8.2.2_…_tsx@4.23.12` → `…_yaml@2.9.1` 로 바뀌어
//    낡은 shim 이 없는 경로를 열었다 — `Cannot find module …/vite/bin/vite.js`).
if (ONLY.has('web')) {
  const vite = join(ROOT, 'apps/web/node_modules/.bin/vite');
  if (!existsSync(vite)) {
    // 없는 것과 깨진 것은 다른 문제다 — 그 둘의 메시지가 같으면 사람이 원인을 못 읽는다.
    process.stderr.write(
      `Vite 실행 파일이 없습니다: ${vite}\n  codebase/ 에서 pnpm install 을 먼저 돌리세요.\n`,
    );
    shutdown(1);
  }
  run('[web]  ', vite, [], { cwd: join(ROOT, 'apps/web') });
}

if (NEEDS_BUILD) {
  if (!(await waitForBuild())) {
    process.stderr.write('[dev] 첫 빌드가 끝나지 않았습니다 — 위의 [build] 오류를 보세요.\n');
    shutdown(1);
  } else {
    // ② `--env-file-if-exists` 인 이유: 파일이 없으면 위에서 이미 멈춘다. 여기서 하드 실패하면
    //    노드의 ENOENT 가 앱 자신의 안내 메시지를 덮어쓴다
    if (ONLY.has('api')) {
      run('[api]  ', 'node', ['--env-file-if-exists=.env', '--watch', 'apps/api/dist/main.js']);
    }
    if (WITH_WORKER) {
      run('[worker]', 'node', ['--env-file-if-exists=.env', '--watch', 'apps/api/dist/worker.js']);
    }
  }
}

// 실제로 잡은 포트를 적는다 — 손잡이가 듣는지를 사람이 로그 한 줄로 확인할 수 있어야 한다.
const where = [
  ONLY.has('web') ? `web :${WEB_PORT}` : null,
  ONLY.has('api') ? `api :${API_PORT}` : null,
  ONLY.has('worker') ? 'worker' : null,
].filter((part) => part !== null);
process.stdout.write(`[dev] 띄웁니다: ${where.join(' · ')}\n`);
